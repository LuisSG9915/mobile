import { t } from "../i18n/es";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return t.time.justNow;
  if (min < 60) return t.time.minutesAgo(min);
  const h = Math.floor(min / 60);
  if (h < 24) return t.time.hoursAgo(h);
  return t.time.daysAgo(Math.floor(h / 24));
}

export function monthLabel(ts: number): string {
  const s = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(new Date(ts));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatDateTime(ts: number): string {
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

export function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
