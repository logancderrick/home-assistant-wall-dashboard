import { useWeatherData } from "../../hooks/useWeeklyWeather";
import ImprovedWeatherCard from "./ImprovedWeatherCard";
import { useAppContext } from "../../contexts/AppContext";

/**
 * Weather header for the top of the calendar page only.
 * Renders a single full-width weather card (current conditions + scrollable forecast).
 */
export default function CalendarDashboardTopCards() {
  const weather = useWeatherData();
  const { settings } = useAppContext();

  return (
    <div className="mb-5 shrink-0">
      <ImprovedWeatherCard
        current={weather.current}
        weekly={weather.weekly}
        locationLabel={weather.locationLabel}
        backgroundImageUrl={settings.weatherBackgroundImageUrl}
      />
    </div>
  );
}
