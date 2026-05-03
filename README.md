# Skydark Family Calendar

A full-screen family command center for Home Assistant — calendar, tasks, lists, meals, rewards, photos, sleep mode, live cameras, and a rich weather dashboard all in one panel.

[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-Custom%20Integration-41BDF5?logo=home-assistant&logoColor=white)](https://www.home-assistant.io/)
[![HACS](https://img.shields.io/badge/HACS-Custom%20Repository-41BDF5)](https://hacs.xyz/)
[![Version](https://img.shields.io/badge/version-1.0.0-blue)](https://github.com/logancderrick/home-assistant-wall-dashboard/releases)

> Built for the Derrick household. Originally inspired by and forked from [SkyDark by HunterJacobs](https://github.com/HunterJacobs/SkyDark) — the integration ID (`skydark_calendar`) is preserved so existing SkyDark installs can migrate without data loss.

---

## Features

| Area | What it does |
|------|--------------|
| **Calendar** | Month / week / day views, HA calendar entity merging with per-source colors, independent scrolling grid |
| **Weather card** | Custom background image, animated ambient effects (rain, clouds, sun, snow, lightning), current temp, hi/lo, humidity, sunrise/sunset, 9-day scrollable forecast |
| **Camera preview** | Live camera strip on the calendar dashboard; up to 2 `camera.*` entities that rotate on a timer |
| **Tasks / Chores** | Per-person task columns, routine frequencies (daily/weekly/custom), completion tracking, points system |
| **Lists** | Grocery and custom lists; items persist through Home Assistant services |
| **Meals** | Weekly meal planner with ingredient generation |
| **Rewards** | Points and reward redemption per family member |
| **Photos** | Family photo upload, full-screen slideshow view |
| **Sleep mode** | Screensaver with rotating photo backgrounds (shuffles every 60 s), rotating live camera card, and live weather overlay |
| **Cameras** | Full camera tab — HLS streams with MJPEG fallback, WebRTC support, fullscreen tap |
| **Settings** | Family profiles, PIN lock, feature toggles, remote calendar config, camera entity config |

Data is stored locally in your HA config as SQLite. No cloud dependency.

---

## Install via HACS (recommended)

1. Open **HACS** → **Integrations** → **⋮ Custom repositories**
2. Add **`https://github.com/logancderrick/home-assistant-wall-dashboard`** — category **Integration**
3. Search for **Skydark Family Calendar** and install
4. **Restart Home Assistant**
5. Go to **Settings → Devices & Services → Add Integration → Skydark Family Calendar**
6. Open **Skydark Calendar** from the HA sidebar

> **Migrating from HunterJacobs/SkyDark?** Switch the HACS custom repository URL to this repo. The integration domain (`skydark_calendar`) is the same, so your existing data is preserved.

---

## Manual install

1. Download this repo as a ZIP from the [latest release](https://github.com/logancderrick/home-assistant-wall-dashboard/releases/latest)
2. Extract and copy `custom_components/skydark_calendar/` into your HA `config/custom_components/` directory
3. Restart Home Assistant
4. Add **Skydark Family Calendar** in **Settings → Devices & Services**

The panel is served at `/skydark`.

---

## Configuration

Skydark is configured entirely through the Home Assistant UI — **Settings → Devices & Services → Skydark Family Calendar**. There are no `configuration.yaml` options.

> **Do not** add a `skydark_calendar:` block to `configuration.yaml`. Any keys there are ignored and HA may show a repair warning. If you see that warning, remove the block and restart HA.

### Weather card background

The weather card supports a custom background image. Place a PNG or JPG in `frontend/public/` (named without spaces), then reference it in `ImprovedWeatherCard.tsx`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full dev setup.

---

## Services

Skydark registers HA services for automation:

| Service | Description |
|---------|-------------|
| `skydark_calendar.add_event` | Create a calendar event |
| `skydark_calendar.add_task` / `complete_task` / `update_task` / `delete_task` | Task management |
| `skydark_calendar.add_list_item` | Add an item to a list |
| `skydark_calendar.create_list` / `delete_list` / `delete_list_item` | List management |
| `skydark_calendar.add_meal` / `update_meal` / `delete_meal` | Meal planner |
| `skydark_calendar.add_points` / `add_reward` / `delete_reward` / `redeem_reward` | Rewards |
| `skydark_calendar.send_notification` | Push notification to the panel |
| `skydark_calendar.upload_photo` | Add a photo to the panel |

Full service schemas are available in **Settings → Devices & Services → Skydark Family Calendar → Services**.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **White screen / 403 on open** | Restart Home Assistant fully after installing or updating |
| **"Does not support configuration via YAML"** | Remove `skydark_calendar:` from `configuration.yaml`, then restart HA |
| **Camera streams 403** | Ensure you are logged into HA in the same browser; the panel sends Bearer tokens for HLS and camera tokens for MJPEG |
| **Old UI showing after update** | Unregister the HA service worker in browser DevTools → Application → Service Workers, then refresh |
| **Font or layout console warnings** | Usually from the HA browser sandbox — generally harmless |

---

## Repository structure

| Part | Path | Tech |
|------|------|------|
| Backend integration | `custom_components/skydark_calendar/` | Python, HA integration API |
| Frontend app | `frontend/` | React, TypeScript, Vite, Tailwind CSS |
| WebSocket API | `frontend/src/lib/skyDarkApi.ts` ↔ `websocket_api.py` | `skydark_calendar/*` WS commands |
| Local database | `custom_components/skydark_calendar/database.py` | SQLite via `config/skydark_calendar/` |
| Built frontend | `custom_components/skydark_calendar/www/` | Output of `npm run build` |

---

## Development

```bash
cd frontend
npm install
npm run dev:demo    # local demo with sample data, no HA needed
npm run build       # build → custom_components/skydark_calendar/www/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full architecture notes, environment setup, and PR guidelines.

---

## Attribution

This project grew out of [SkyDark by HunterJacobs](https://github.com/HunterJacobs/SkyDark), which provided the original foundation — backend architecture, HA integration structure, and core UI concepts. Significant portions of the codebase originate from that work. The integration domain (`skydark_calendar`) is intentionally unchanged to allow seamless migration for existing SkyDark users.

If this helps your household, a ⭐ on [HunterJacobs/SkyDark](https://github.com/HunterJacobs/SkyDark) helps credit the original work.
