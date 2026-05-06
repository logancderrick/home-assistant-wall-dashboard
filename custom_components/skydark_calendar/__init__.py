"""Skydark Family Calendar integration for Home Assistant."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import homeassistant.helpers.config_validation as cv
from homeassistant.components.frontend import async_register_built_in_panel, async_remove_panel
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .const import DB_NAME, DOMAIN, PANEL_ICON, PANEL_TITLE, PANEL_URL
from .database import SkydarkDatabase
from .http_views import SkydarkPhotoView
from .photo_media import ensure_calendar_media_dir
from .websocket_api import async_register_websocket_handlers

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.CALENDAR, Platform.SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

# Headers that prevent any caching of index.html so that updated asset
# hashes in the file are always picked up — even by HA's service worker.
_NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
}


class SkyDarkRootView(HomeAssistantView):
    """Redirect /skydark and /skydark/ to /skydark/index.html.

    Without this, GET /skydark is handled by the static path as a directory
    request and returns 403 Forbidden, causing a white screen and broken
    refresh when the panel URL is /skydark.
    """

    url = PANEL_URL
    name = "skydark_root"
    requires_auth = False

    async def get(self, request):  # type: ignore[override]
        from aiohttp import web

        return web.Response(
            status=302,
            headers={"Location": f"{PANEL_URL}/index.html"},
        )


class SkyDarkRootSlashView(HomeAssistantView):
    """Redirect /skydark/ to /skydark/index.html."""

    url = f"{PANEL_URL}/"
    name = "skydark_root_slash"
    requires_auth = False

    async def get(self, request):  # type: ignore[override]
        from aiohttp import web

        return web.Response(
            status=302,
            headers={"Location": f"{PANEL_URL}/index.html"},
        )


class SkyDarkIndexView(HomeAssistantView):
    """Serve SkyDark index.html with strict no-cache headers.

    Using a dedicated view (rather than the static-path handler) lets us set
    response headers that HA's service worker will respect, ensuring the
    browser always fetches the latest index.html after an update.
    """

    url = f"{PANEL_URL}/index.html"
    name = "skydark_index"
    requires_auth = False

    def __init__(self, www_path: Path) -> None:
        self._index = www_path / "index.html"

    async def get(self, request):  # type: ignore[override]
        from aiohttp import web

        hass = request.app["hass"]
        exists = await hass.async_add_executor_job(self._index.exists)
        if not exists:
            raise web.HTTPNotFound()
        content = await hass.async_add_executor_job(self._index.read_bytes)
        return web.Response(
            body=content,
            content_type="text/html",
            charset="utf-8",
            headers=_NO_CACHE_HEADERS,
        )


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Set up the Skydark Calendar component."""
    hass.data.setdefault(DOMAIN, {})
    return True


# All Skydark services; unregistered on unload.
def _index_html_mtime_ns(www_path: Path) -> str:
    """Stable value for cache-busting the panel iframe URL after www updates."""
    try:
        return str((www_path / "index.html").stat().st_mtime_ns)
    except OSError:
        return "0"


_SERVICES = (
    "add_event",
    "add_task",
    "update_task",
    "complete_task",
    "add_reward",
    "delete_reward",
    "add_points",
    "redeem_reward",
    "add_list_item",
    "delete_list",
    "delete_list_item",
    "toggle_list_item",
    "set_list_todo_entity",
    "create_list",
    "add_meal_recipe",
    "add_meal",
    "update_meal",
    "delete_meal",
    "delete_task",
    "upload_photo",
    "send_notification",
)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Skydark Calendar from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    try:
        www_path = Path(__path__[0]) / "www"
        www_exists = await hass.async_add_executor_job(www_path.exists)
        panel_index_url = f"{PANEL_URL}/index.html"
        if www_exists:
            hass.http.register_view(SkyDarkRootView())
            hass.http.register_view(SkyDarkRootSlashView())
            hass.http.register_view(SkyDarkIndexView(www_path))
            await hass.http.async_register_static_paths(
                [StaticPathConfig(PANEL_URL, str(www_path), cache_headers=False)]
            )
            _LOGGER.debug("Registered static path %s -> %s", PANEL_URL, www_path)
            cache_bust = await hass.async_add_executor_job(_index_html_mtime_ns, www_path)
            panel_index_url = f"{PANEL_URL}/index.html?cb={cache_bust}"

        hass.http.register_view(SkydarkPhotoView())

        async_remove_panel(hass, "skydark")
        async_register_built_in_panel(
            hass,
            component_name="iframe",
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            frontend_url_path="skydark",
            config={"url": panel_index_url},
            require_admin=False,
        )

        db_path = Path(hass.config.config_dir) / DOMAIN / DB_NAME
        await hass.async_add_executor_job(
            lambda: db_path.parent.mkdir(parents=True, exist_ok=True)
        )
        db = SkydarkDatabase(db_path)
        await hass.async_add_executor_job(db.init)
        await hass.async_add_executor_job(ensure_calendar_media_dir, hass)
        hass.data[DOMAIN]["db"] = db
        hass.data[DOMAIN]["panel_url"] = PANEL_URL
        hass.data[DOMAIN]["entry_id"] = entry.entry_id
        hass.data[DOMAIN]["config"] = {**entry.data, **(entry.options or {})}

        await async_register_websocket_handlers(hass)

        from . import services as skydark_services

        await skydark_services.async_setup_services(hass)

        from .list_todo_sync import async_setup_todo_sync

        await async_setup_todo_sync(hass, db)

        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
        return True
    except Exception as err:
        _LOGGER.exception("Skydark Calendar setup failed: %s", err)
        async_remove_panel(hass, "skydark")
        if DOMAIN in hass.data:
            hass.data[DOMAIN].pop("db", None)
            hass.data[DOMAIN].pop("panel_url", None)
            hass.data[DOMAIN].pop("entry_id", None)
            hass.data[DOMAIN].pop("config", None)
        return False


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    from .list_todo_sync import async_teardown_todo_sync

    await async_teardown_todo_sync(hass)
    for name in _SERVICES:
        hass.services.async_remove(DOMAIN, name)
    if DOMAIN in hass.data:
        hass.data[DOMAIN].pop("db", None)
        hass.data[DOMAIN].pop("panel_url", None)
        hass.data[DOMAIN].pop("entry_id", None)
        hass.data[DOMAIN].pop("config", None)
    async_remove_panel(hass, "skydark")
    return unload_ok
