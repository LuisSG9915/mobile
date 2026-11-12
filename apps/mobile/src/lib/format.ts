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

/**
 * Los formateadores Intl se comparten: construir `DateTimeFormat` es caro
 * (~100 µs) y `sectionLabel` se llama por cada foto al armar las filas de la
 * galería — con biblioteca grande eran varios segundos de hilo bloqueado.
 */
const monthFormatter = new Intl.DateTimeFormat("es", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dateTimeFormatter = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function monthLabel(ts: number): string {
  const s = monthFormatter.format(new Date(ts));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Etiqueta de un mes `YYYY-MM` en UTC (la `dateGroup` del API es UTC). El
 * formateador se comparte: el selector de meses y el globo del scrubber lo
 * llaman por cada fila y construir `Intl.DateTimeFormat` cada vez es caro.
 */
const monthUtcFormatter = new Intl.DateTimeFormat("es", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-10" → "Octubre de 2026". */
export function monthLabelUtc(ym: string): string {
  const s = monthUtcFormatter.format(new Date(`${ym}-01T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Sección de la galería: Hoy / Ayer / mes (estilo Google Fotos). */
export function sectionLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  if (sameDay(d, n)) return t.time.today;
  const y = new Date(n);
  y.setUTCDate(y.getUTCDate() - 1);
  if (sameDay(d, y)) return t.time.yesterday;
  return monthLabel(ts);
}

export function formatDateTime(ts: number): string {
  return dateTimeFormatter.format(new Date(ts));
}

export function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
