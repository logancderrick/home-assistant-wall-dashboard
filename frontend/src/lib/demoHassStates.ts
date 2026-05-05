import { getStates } from "home-assistant-js-websocket";
import type { Connection, HassEntity } from "home-assistant-js-websocket";
import { isSkydarkDemo } from "./demoMode";

/**
 * Minimal `camera.*` entities for demo mode so Cameras and calendar preview can resolve
 * friendly names and entity_picture without a live HA WebSocket.
 * Live video still requires a real connection.
 */
const DEMO_HASS_STATES = [
  {
    entity_id: "camera.demo_back_yard",
    state: "idle",
    attributes: { friendly_name: "Back Yard (demo)", entity_picture: null },
  },
  {
    entity_id: "camera.demo_garage",
    state: "idle",
    attributes: { friendly_name: "Garage (demo)", entity_picture: null },
  },
  {
    entity_id: "camera.demo_living_room",
    state: "idle",
    attributes: { friendly_name: "Living Room (demo)", entity_picture: null },
  },
  {
    entity_id: "calendar.demo_family",
    state: "on",
    attributes: { friendly_name: "Family (demo)" },
  },
  {
    entity_id: "calendar.demo_work",
    state: "on",
    attributes: { friendly_name: "Work (demo)" },
  },
  {
    entity_id: "assist_satellite.demo_wall_panel",
    state: "idle",
    attributes: { friendly_name: "Wall panel (demo)" },
  },
] as unknown as HassEntity[];

/** Use in place of `getStates(conn)` so demo mode can list sample entities without HA. */
export async function getStatesOrDemo(conn: Connection | null): Promise<HassEntity[]> {
  if (isSkydarkDemo) {
    return [...DEMO_HASS_STATES];
  }
  if (!conn) return [];
  return getStates(conn);
}
