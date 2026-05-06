"""Bidirectional synchronisation between SkyDark lists and Home Assistant todo.* entities."""

from __future__ import annotations

import logging
from functools import partial
from typing import Any, Callable

from homeassistant.components.todo import TodoItemStatus, TodoListEntity
from homeassistant.components.todo.const import DATA_COMPONENT
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_call_later

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

_DEBOUNCE_SEC = 0.45


async def _todo_get_items(hass: HomeAssistant, entity_id: str) -> list[dict[str, Any]]:
    resp = await hass.services.async_call(
        "todo",
        "get_items",
        {"entity_id": entity_id},
        blocking=True,
        return_response=True,
    )
    if isinstance(resp, dict):
        raw = resp.get("items") or []
        return list(raw) if isinstance(raw, list) else []
    return []


class TodoListSyncManager:
    """Keeps SQLite list rows aligned with a linked HA todo entity."""

    def __init__(self, hass: HomeAssistant, db: Any) -> None:
        self.hass = hass
        self.db = db
        self._suppress_depth: dict[str, int] = {}
        self._debounce_handles: dict[str, Any] = {}
        self._listeners: dict[str, Callable[[], None]] = {}

    def begin_suppress(self, list_id: str) -> None:
        self._suppress_depth[list_id] = self._suppress_depth.get(list_id, 0) + 1

    def end_suppress(self, list_id: str) -> None:
        n = self._suppress_depth.get(list_id, 0) - 1
        if n <= 0:
            self._suppress_depth.pop(list_id, None)
        else:
            self._suppress_depth[list_id] = n

    def is_suppressed(self, list_id: str) -> bool:
        return self._suppress_depth.get(list_id, 0) > 0

    def detach_listener(self, list_id: str) -> None:
        unsub = self._listeners.pop(list_id, None)
        if unsub:
            unsub()
        handle = self._debounce_handles.pop(list_id, None)
        if handle:
            handle.cancel()

    async def refresh_bindings(self) -> None:
        """(Re)attach listeners from DB state."""
        for lid in list(self._listeners.keys()):
            self.detach_listener(lid)

        lists = await self.hass.async_add_executor_job(self.db.get_lists)
        for lst in lists or []:
            lid = str(lst.get("id") or "")
            eid_raw = lst.get("ha_todo_entity_id")
            if not lid:
                continue
            eid = (eid_raw or "").strip() if isinstance(eid_raw, str) else ""
            if eid.startswith("todo."):
                self.attach_listener(lid, eid)

    def attach_listener(self, list_id: str, entity_id: str) -> None:
        comp = self.hass.data.get(DATA_COMPONENT)
        if comp is None:
            _LOGGER.warning("Todo integration unavailable; skipping listen for %s", entity_id)
            return

        entity = comp.get_entity(entity_id)
        if entity is None or not isinstance(entity, TodoListEntity):
            _LOGGER.warning("Not a todo list entity: %s", entity_id)
            return

        self.detach_listener(list_id)

        @callback
        def on_items(_items: list[Any] | None) -> None:
            if self.is_suppressed(list_id):
                return
            self.schedule_pull(list_id, entity_id)

        try:
            unsub = entity.async_subscribe_updates(on_items)
        except Exception as err:
            _LOGGER.warning("Could not subscribe to %s: %s", entity_id, err)
            return

        self._listeners[list_id] = unsub
        self.hass.async_create_task(self.pull_from_ha(list_id, entity_id))

    def schedule_pull(self, list_id: str, entity_id: str) -> None:
        old = self._debounce_handles.pop(list_id, None)
        if old:
            old.cancel()

        async def _runner(_dt: Any) -> None:
            self._debounce_handles.pop(list_id, None)
            await self.pull_from_ha(list_id, entity_id)

        self._debounce_handles[list_id] = async_call_later(
            self.hass, _DEBOUNCE_SEC, lambda dt: self.hass.async_create_task(_runner(dt))
        )

    async def pull_from_ha(self, list_id: str, entity_id: str) -> None:
        if self.is_suppressed(list_id):
            return
        try:
            items = await _todo_get_items(self.hass, entity_id)
            await self.hass.async_add_executor_job(
                partial(self.db.merge_ha_items_into_list, list_id, items),
            )
        except Exception:
            _LOGGER.exception("Todo pull failed list=%s entity=%s", list_id, entity_id)

    async def after_skydark_add_item(
        self,
        list_id: str,
        item_id: str,
        content: str,
    ) -> None:
        lst = await self.hass.async_add_executor_job(self.db.get_list, list_id)
        eid = _entity_from_list(lst)
        if not eid:
            return
        self.begin_suppress(list_id)
        try:
            await self.hass.services.async_call(
                "todo",
                "add_item",
                {"entity_id": eid, "item": content},
                blocking=True,
            )
            uid = await self._find_uid_for_added(eid, list_id, content)
            if uid:
                await self.hass.async_add_executor_job(
                    self.db.set_list_item_ha_uid,
                    item_id,
                    uid,
                )
        except Exception:
            _LOGGER.exception("Todo push add failed list=%s", list_id)
        finally:
            self.end_suppress(list_id)

    async def after_skydark_delete_item(self, row: dict[str, Any]) -> None:
        list_id = str(row.get("list_id") or "")
        uid = row.get("ha_todo_uid")
        lst = await self.hass.async_add_executor_job(self.db.get_list, list_id)
        eid = _entity_from_list(lst)
        if not eid or not uid:
            return
        self.begin_suppress(list_id)
        try:
            await self.hass.services.async_call(
                "todo",
                "remove_item",
                {"entity_id": eid, "item": [str(uid)]},
                blocking=True,
            )
        except Exception:
            _LOGGER.warning("Todo remove failed uid=%s (may already be gone)", uid)
        finally:
            self.end_suppress(list_id)

    async def after_skydark_toggle_complete(self, item_id: str) -> None:
        """Call after SQLite toggle_list_item — mirrors completion to HA."""
        row = await self.hass.async_add_executor_job(self.db.get_list_item, item_id)
        if not row:
            return
        list_id = str(row.get("list_id") or "")
        lst = await self.hass.async_add_executor_job(self.db.get_list, list_id)
        eid = _entity_from_list(lst)
        uid = row.get("ha_todo_uid")
        if not eid or not uid:
            return
        completed = bool(int(row.get("completed") or 0))
        self.begin_suppress(list_id)
        try:
            status = TodoItemStatus.COMPLETED if completed else TodoItemStatus.NEEDS_ACTION
            await self.hass.services.async_call(
                "todo",
                "update_item",
                {"entity_id": eid, "item": str(uid), "status": status},
                blocking=True,
            )
        except Exception:
            _LOGGER.exception("Todo update_item failed uid=%s", uid)
        finally:
            self.end_suppress(list_id)

    async def async_shutdown(self) -> None:
        for lid in list(self._listeners.keys()):
            self.detach_listener(lid)

    async def _find_uid_for_added(
        self, entity_id: str, list_id: str, content: str
    ) -> str | None:
        def known_uids() -> set[str]:
            rows = self.db.get_list_items(list_id)
            return {
                str(r["ha_todo_uid"]) for r in rows if r.get("ha_todo_uid")
            }

        before = await self.hass.async_add_executor_job(known_uids)
        items = await _todo_get_items(self.hass, entity_id)
        content = content.strip()
        for hi in items:
            uid = hi.get("uid")
            summ = (hi.get("summary") or "").strip()
            if uid and summ == content and str(uid) not in before:
                return str(uid)
        return None


def _entity_from_list(lst: dict[str, Any] | None) -> str | None:
    if not lst:
        return None
    raw = lst.get("ha_todo_entity_id")
    eid = raw.strip() if isinstance(raw, str) else ""
    return eid if eid.startswith("todo.") else None


async def async_setup_todo_sync(hass: HomeAssistant, db: Any) -> TodoListSyncManager:
    """Create manager, register listeners for linked lists."""
    mgr = TodoListSyncManager(hass, db)
    await mgr.refresh_bindings()
    hass.data.setdefault(DOMAIN, {})["todo_sync"] = mgr
    return mgr


async def async_teardown_todo_sync(hass: HomeAssistant) -> None:
    mgr = hass.data.get(DOMAIN, {}).pop("todo_sync", None)
    if isinstance(mgr, TodoListSyncManager):
        await mgr.async_shutdown()
