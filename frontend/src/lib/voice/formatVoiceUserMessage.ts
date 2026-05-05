/**
 * Turn unknown HA / pipeline / JS errors into a single user-visible string.
 * Avoids React rendering "[object Object]" when `error` was an object.
 */
export function formatVoiceUserMessage(value: unknown): string {
  if (value == null || value === "") return "Unknown error";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message || "Unknown error";
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
    if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
    if (typeof o.code === "string" && typeof o.message === "string") {
      return `${o.code}: ${o.message}`.trim();
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "Unknown error";
    }
  }
  return String(value);
}
