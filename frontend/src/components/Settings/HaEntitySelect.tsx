import { useEffect, useState } from "react";
import type { Connection, HassEntity } from "home-assistant-js-websocket";
import { getStatesOrDemo } from "../../lib/demoHassStates";

export function formatHaEntityOptionLabel(e: HassEntity): string {
  const fn = String(e.attributes?.friendly_name ?? "").trim();
  return fn ? `${fn} (${e.entity_id})` : e.entity_id;
}

function sortByLabel(entities: HassEntity[]): HassEntity[] {
  return [...entities].sort((a, b) =>
    formatHaEntityOptionLabel(a).localeCompare(formatHaEntityOptionLabel(b), undefined, {
      sensitivity: "base",
    }),
  );
}

export interface HaEntitySelectProps {
  connection: Connection | null;
  /** Home Assistant domain prefix, e.g. `calendar` matches `calendar.*`. */
  domain: string;
  value: string;
  onChange: (entityId: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  /** Entity IDs to omit from the dropdown (stable key: pass a sorted copy). */
  excludeIds?: readonly string[];
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export default function HaEntitySelect({
  connection,
  domain,
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = "— None —",
  excludeIds,
  disabled = false,
  className = "input-skydark w-full max-w-lg text-sm",
  "aria-label": ariaLabel,
}: HaEntitySelectProps) {
  const [options, setOptions] = useState<HassEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const excludeKey = excludeIds?.length ? [...excludeIds].sort().join("|") : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const states = await getStatesOrDemo(connection);
        if (cancelled) return;
        const prefix = `${domain}.`;
        const ex = new Set(excludeIds ?? []);
        const filtered = states.filter((s) => s.entity_id.startsWith(prefix) && !ex.has(s.entity_id));
        setOptions(sortByLabel(filtered));
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Could not load entities");
          setOptions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, domain, excludeKey]);

  const valueInOptions = Boolean(value) && options.some((o) => o.entity_id === value);
  const showUnknownValue = Boolean(value) && !valueInOptions;

  return (
    <div className="space-y-1.5 max-w-lg">
      <select
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading}
        aria-label={ariaLabel}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {showUnknownValue && (
          <option value={value} title={value}>
            Current: {value}
          </option>
        )}
        {options.map((e) => (
          <option key={e.entity_id} value={e.entity_id} title={e.entity_id}>
            {formatHaEntityOptionLabel(e)}
          </option>
        ))}
      </select>
      {loading && <p className="text-xs text-skydark-text-secondary">Loading Home Assistant entities…</p>}
      {!loading && loadError && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">{loadError}</p>
      )}
      {!loading && !loadError && options.length === 0 && !value && (
        <p className="text-xs text-skydark-text-secondary">
          No <span className="font-mono">{domain}.*</span> entities found. Add the integration in Home Assistant or enter an ID
          manually below.
        </p>
      )}
    </div>
  );
}
