import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { CurrentWeather, WeeklyDay } from "../../hooks/useWeeklyWeather";
import { weatherCardBackgroundUrl } from "../../lib/branding";

type Condition = WeeklyDay["condition"];

/* -------------------------------------------------------------------------- */
/* Inline SVG glyphs                                                          */
/* -------------------------------------------------------------------------- */

function ConditionGlyph({ condition, size = 36 }: { condition: Condition; size?: number }) {
  const stroke = "rgba(255,255,255,0.92)";
  switch (condition) {
    case "sunny":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <circle cx="24" cy="24" r="9" fill="#FFC857" />
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i * Math.PI) / 4;
            const x1 = 24 + Math.cos(a) * 14;
            const y1 = 24 + Math.sin(a) * 14;
            const x2 = 24 + Math.cos(a) * 19;
            const y2 = 24 + Math.sin(a) * 19;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#FFC857"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            );
          })}
        </svg>
      );
    case "partly-cloudy":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <circle cx="18" cy="18" r="7" fill="#FFC857" />
          <path
            d="M14 30c0-5 4-8 8.5-8 3 0 5.5 1.6 6.7 4.1.5-.1 1-.1 1.4-.1 3.5 0 6.4 2.9 6.4 6.4S33.7 38 30.5 38H17.5C13.9 38 11 35.4 11 32c0-1.7.7-3.2 1.8-4.3"
            fill="#E2E8F0"
            stroke={stroke}
            strokeWidth="1.2"
          />
        </svg>
      );
    case "cloudy":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <path
            d="M14 32c0-5 4-8 8.5-8 3 0 5.5 1.6 6.7 4.1.5-.1 1-.1 1.4-.1 3.5 0 6.4 2.9 6.4 6.4S33.7 40 30.5 40H17.5C13.9 40 11 37.4 11 34c0-1.7.7-3.2 1.8-4.3"
            fill="#CBD5E1"
            stroke={stroke}
            strokeWidth="1.2"
          />
          <path
            d="M11 22c0-4 3-6.5 6.5-6.5 2.5 0 4.5 1.4 5.5 3.4.4-.1.8-.1 1.1-.1 2.8 0 5 2.4 5 5.2"
            fill="#E2E8F0"
            stroke={stroke}
            strokeWidth="1.2"
          />
        </svg>
      );
    case "rain":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <path
            d="M14 26c0-5 4-8 8.5-8 3 0 5.5 1.6 6.7 4.1.5-.1 1-.1 1.4-.1 3.5 0 6.4 2.9 6.4 6.4S33.7 34 30.5 34H17.5C13.9 34 11 31.4 11 28c0-1.7.7-3.2 1.8-4.3"
            fill="#94A3B8"
            stroke={stroke}
            strokeWidth="1.2"
          />
          {[
            [18, 38],
            [24, 41],
            [30, 38],
          ].map(([x, y], i) => (
            <line
              key={i}
              x1={x}
              y1={y - 4}
              x2={x - 2}
              y2={y}
              stroke="#60A5FA"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ))}
        </svg>
      );
    case "snow":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
          <path
            d="M14 26c0-5 4-8 8.5-8 3 0 5.5 1.6 6.7 4.1.5-.1 1-.1 1.4-.1 3.5 0 6.4 2.9 6.4 6.4S33.7 34 30.5 34H17.5C13.9 34 11 31.4 11 28c0-1.7.7-3.2 1.8-4.3"
            fill="#CBD5E1"
            stroke={stroke}
            strokeWidth="1.2"
          />
          {[
            [17, 40],
            [24, 42],
            [31, 40],
          ].map(([x, y], i) => (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              fill="#E0F2FE"
              fontSize="9"
              fontFamily="sans-serif"
            >
              ✶
            </text>
          ))}
        </svg>
      );
  }
}


function SunriseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 19h18M5 16a7 7 0 0 1 14 0M12 4v5M5.6 9.6l2.1 2.1M18.4 9.6l-2.1 2.1"
        stroke="#FBBF24"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SunsetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 19h18M5 16a7 7 0 0 1 14 0M12 9V4M5.6 9.6l2.1 2.1M18.4 9.6l-2.1 2.1"
        stroke="#A78BFA"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M9 21l3-3 3 3" stroke="#A78BFA" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function conditionLabel(c: Condition | undefined): string {
  switch (c) {
    case "sunny":
      return "Sunny";
    case "partly-cloudy":
      return "Partly cloudy";
    case "cloudy":
      return "Cloudy";
    case "rain":
      return "Rain";
    case "snow":
      return "Snow";
    default:
      return "—";
  }
}

function shortDay(label: string, index: number): string {
  if (label === "Today") {
    const d = new Date();
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  }
  return label.slice(0, 3) || `D${index}`;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/* -------------------------------------------------------------------------- */
/* Drag-to-scroll wrapper for horizontal forecast lists                       */
/* -------------------------------------------------------------------------- */

function DragScroll({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ active: false, startX: 0, startScroll: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onPointerDown = (e: PointerEvent) => {
      // Only react to mouse / pen; let touch use native momentum scrolling.
      if (e.pointerType === "touch") return;
      drag.current.active = true;
      drag.current.startX = e.clientX;
      drag.current.startScroll = el.scrollLeft;
      el.setPointerCapture(e.pointerId);
      el.classList.add("cursor-grabbing");
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag.current.active) return;
      const dx = e.clientX - drag.current.startX;
      el.scrollLeft = drag.current.startScroll - dx;
    };
    const stop = (e: PointerEvent) => {
      drag.current.active = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // pointer capture may not be active; ignore
      }
      el.classList.remove("cursor-grabbing");
    };
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`overflow-x-auto cursor-grab select-none scrollbar-thin ${className}`}
      style={{ scrollbarWidth: "thin" }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Horizontal scrollable forecast                                             */
/* -------------------------------------------------------------------------- */

function SimpleForecastRow({ days }: { days: WeeklyDay[] }) {
  return (
    <DragScroll className="-mx-1">
      <ul className="flex items-stretch gap-2 px-1 pb-1">
        {days.map((d, i) => (
          <li
            key={`sf-${i}`}
            className="flex min-w-[84px] flex-col items-center gap-1.5 rounded-lg border border-white/10 bg-slate-950/35 px-2.5 py-2.5 text-white"
          >
            <span className="text-sm font-semibold uppercase tracking-wide text-white/85">
              {shortDay(d.dayLabel, i)}
            </span>
            <ConditionGlyph condition={d.condition} size={38} />
            <div className="flex flex-col items-center text-base tabular-nums leading-tight">
              <span className="text-white">{d.tempMax}°</span>
              <span className="text-white/55">{d.tempMin}°</span>
            </div>
            {d.precipitationIn ? (
              <div
                className="mt-0.5 rounded-md bg-sky-400/25 px-1.5 py-0.5 text-sm font-medium text-sky-100"
                title={`${d.precipitationIn} in precipitation`}
              >
                {d.precipitationIn.toFixed(2).replace(/\.?0+$/, "")} in
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </DragScroll>
  );
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

export interface ImprovedWeatherCardProps {
  current: CurrentWeather | null;
  weekly: WeeklyDay[];
  locationLabel?: string | null;
  /** Falls back to "Home" like the reference card. */
  locationFallback?: string;
  className?: string;
  /** Optional custom background image URL (data URL). */
  backgroundImageUrl?: string;
}

export default function ImprovedWeatherCard({
  current,
  weekly,
  locationLabel,
  locationFallback = "Home",
  className = "",
  backgroundImageUrl,
}: ImprovedWeatherCardProps) {
  const days = useMemo(() => weekly.slice(0, 9), [weekly]);
  const today = days[0];
  const cur = current;


  const condition = cur?.condition ?? "sunny";
  const bgImageUrl = backgroundImageUrl || weatherCardBackgroundUrl;


  return (
    <section
      aria-label="Weather forecast"
      className={`relative isolate overflow-hidden rounded-2xl border border-white/10 text-white shadow-skydark ${className}`}
      style={{ backgroundColor: "#0B1A33" }}
    >
      {/* Img layer avoids blank CSS background repaints after lazy calendar remount in Chromium/WebKit. */}
      <img
        src={bgImageUrl}
        alt=""
        aria-hidden
        decoding="async"
        className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover object-[center_55%]"
      />
      <div className="relative z-10 flex flex-col gap-2.5 p-4 sm:p-4">
        {/* header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <ConditionGlyph condition={condition} size={44} />
            <div className="leading-tight">
              <p className="text-xl font-semibold tracking-tight drop-shadow">
                {conditionLabel(condition)}
              </p>
              <p className="text-xs text-white/75">{locationLabel || locationFallback}</p>
            </div>
          </div>
          <div className="text-right leading-tight">
            <p className="text-5xl font-bold tabular-nums drop-shadow">
              {cur ? `${cur.temperature}°` : "—"}
            </p>
            {today && (
              <p className="mt-1 text-xl tabular-nums text-white/80">
                {today.tempMax}° / {today.tempMin}°
              </p>
            )}
            {cur?.humidity != null && (
              <p className="mt-1 flex items-center justify-end gap-1 text-base tabular-nums text-white/70">
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current opacity-80" aria-hidden>
                  <path d="M12 2C8.5 7 5 11.5 5 15a7 7 0 0 0 14 0c0-3.5-3.5-8-7-13z" />
                </svg>
                {cur.humidity}%
              </p>
            )}
            {(today?.sunriseIso || today?.sunsetIso) && (
              <p className="mt-1 flex flex-wrap items-center justify-end gap-2 text-base tabular-nums text-white/65">
                {today?.sunriseIso ? (
                  <span className="inline-flex items-center gap-1">
                    <SunriseIcon />
                    {formatTime(today.sunriseIso)}
                  </span>
                ) : null}
                {today?.sunriseIso && today?.sunsetIso ? (
                  <span className="text-white/30" aria-hidden>
                    ·
                  </span>
                ) : null}
                {today?.sunsetIso ? (
                  <span className="inline-flex items-center gap-1">
                    <SunsetIcon />
                    {formatTime(today.sunsetIso)}
                  </span>
                ) : null}
              </p>
            )}
          </div>
        </div>

        <SimpleForecastRow days={days} />
      </div>
    </section>
  );
}
