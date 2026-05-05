import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { routerFutureFlags } from "./lib/routerFutureFlags";
import { AppProvider } from "./contexts/AppContext";
import { SkydarkDataContext } from "./contexts/SkydarkDataContext";
import { ViewportSimulatorProvider } from "./contexts/ViewportSimulatorContext";
import { VoiceProvider } from "./contexts/VoiceContext";
import AppBootstrapGate from "./components/AppBootstrapGate";
import { buildDemoSkydarkState } from "./dev/demoSkydarkData";
import App from "./App";

const OPEN_METEO_FIXTURE = {
  current: {
    temperature_2m: 70,
    weather_code: 0,
    relative_humidity_2m: 50,
    wind_speed_10m: 5,
    wind_direction_10m: 180,
    apparent_temperature: 68,
    visibility: 16093.4,
  },
  daily: {
    time: ["2026-04-22", "2026-04-23"],
    temperature_2m_max: [75, 76],
    temperature_2m_min: [60, 61],
    precipitation_probability_max: [10, 5],
    precipitation_sum: [0, 0],
    wind_speed_10m_max: [8, 7],
    wind_direction_10m_dominant: [200, 190],
    weather_code: [1, 2],
    sunrise: ["2026-04-22T06:42:00", "2026-04-23T06:43:00"],
    sunset: ["2026-04-22T19:18:00", "2026-04-23T19:19:00"],
  },
};

const demoSkydarkValue = {
  data: buildDemoSkydarkState(),
  refetch: async () => {},
  refetchEvents: async () => {},
  refetchLists: async () => {},
};

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter future={routerFutureFlags} initialEntries={["/calendar"]}>
      <SkydarkDataContext.Provider value={demoSkydarkValue}>
        <AppProvider>
          <VoiceProvider>
            <AppBootstrapGate>
              <ViewportSimulatorProvider>{children}</ViewportSimulatorProvider>
            </AppBootstrapGate>
          </VoiceProvider>
        </AppProvider>
      </SkydarkDataContext.Provider>
    </MemoryRouter>
  );
}

describe("App", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => OPEN_METEO_FIXTURE,
    } as Response);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders main layout and navigation", async () => {
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );
    await waitFor(() => {
      expect(screen.getByRole("main")).toBeDefined();
    });
  });
});
