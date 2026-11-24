import { monthLabel } from "./format";
import type { GalleryRow } from "./gallery";

/**
 * Geometría pura de la cuadrícula de la galería: traduce la lista plana de
 * GalleryRow (encabezados a ancho completo + fotos en N columnas) a líneas
 * visuales con su posición vertical, para hacer hit-test de gestos
 * (drag-to-select, fast-scrubber) sin depender de React Native. La altura
 * del encabezado es FIJA (HEADER_HEIGHT) para que el cálculo sea exacto —
 * la vista debe renderizarlo con esa misma altura.
 */
export const HEADER_HEIGHT = 40;
/** Separación visual entre celdas; no altera el slot lógico del hit-test. */
export const GRID_GAP = 1.5;

export type GridLine =
  | { kind: "header"; top: number; height: number; rowIndex: number }
  | { kind: "photos"; top: number; height: number; firstRow: number };

export type GridGeometry = {
  lines: GridLine[];
  height: number;
  totalHeight: number;
};

let cachedGeometry: {
  fingerprint: string;
  columns: number;
  cellSize: number;
  headerHeight: number;
  geometry: GridGeometry;
} | null = null;

export function clearGridGeometryCacheForTests(): void {
  cachedGeometry = null;
}

export function buildGridGeometry(
  rows: GalleryRow[],
  columns: number,
  cellSize: number,
  headerHeight: number = HEADER_HEIGHT,
): GridGeometry {
  let headerIndicesStr = "";
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === "header") {
      headerIndicesStr += `${i},`;
    }
  }
  const fingerprint = `${rows.length}:${headerIndicesStr}`;

  if (
    cachedGeometry &&
    cachedGeometry.columns === columns &&
    cachedGeometry.cellSize === cellSize &&
    cachedGeometry.headerHeight === headerHeight &&
    cachedGeometry.fingerprint === fingerprint
  ) {
    return cachedGeometry.geometry;
  }

  const lines: GridLine[] = [];
  let y = 0;
  let inLine = 0; // fotos colocadas en la línea actual
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === "header") {
      lines.push({ kind: "header", top: y, height: headerHeight, rowIndex: i });
      y += headerHeight;
      inLine = 0;
      continue;
    }
    if (inLine === 0) {
      lines.push({ kind: "photos", top: y, height: cellSize, firstRow: i });
      y += cellSize;
    }
    inLine = (inLine + 1) % columns;
  }
  const geometry: GridGeometry = { lines, height: y, totalHeight: y };
  cachedGeometry = {
    fingerprint,
    columns,
    cellSize,
    headerHeight,
    geometry,
  };
  return geometry;
}

/** Línea que contiene la coordenada y (búsqueda binaria). */
export function lineAtY(geom: GridGeometry, y: number): GridLine | null {
  const { lines } = geom;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].top <= y) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans < 0) return null;
  const line = lines[ans];
  return y < line.top + line.height ? line : null;
}

/**
 * Índice en `rows` de la foto bajo el punto (x, y) del contenido de la
 * lista; null si cae en un encabezado, hueco de línea o fuera de la lista.
 */
export function hitTestPhoto(
  geom: GridGeometry,
  rows: GalleryRow[],
  x: number,
  y: number,
  columns: number,
  cellSize: number,
): number | null {
  const line = lineAtY(geom, y);
  if (line?.kind !== "photos") return null;
  const col = Math.floor(x / cellSize);
  if (col < 0 || col >= columns) return null;
  const idx = line.firstRow + col;
  const row = rows[idx];
  return row && row.type === "photo" ? idx : null;
}

/** Etiqueta mes-año que muestra el fast-scrubber al saltar a una línea. */
export function scrubLabel(line: GridLine | null, rows: GalleryRow[]): string {
  if (!line) return "";
  const idx = line.kind === "header" ? line.rowIndex : line.firstRow;
  const row = rows[idx];
  if (!row) return "";
  return row.type === "photo" ? monthLabel(row.photo.takenAt) : row.label;
}

// ---------- Bloque 2: TimelineLayoutIndex + pinch + binary search ----------

import type { HybridGalleryItem } from "./gallery";

export interface GridMetrics {
  columns: number;
  gap: number;
  cellSize: number;
  headerHeight: number;
}

export type TimelineListRow =
  | {
      type: "header";
      key: string;
      title: string;
      monthKey: string;
      timestamp: number;
      count: number;
    }
  | { type: "media_row"; key: string; monthKey: string; items: HybridGalleryItem[] };

export interface TimelineLayoutIndex {
  rows: TimelineListRow[];
  rowOffsets: Float64Array;
  rowHeights: Float32Array;
  totalHeight: number;
  monthOffsetMap: Map<string, number>;
}

export function computeGridMetrics(
  screenWidth: number,
  columns: number = 3,
  gap = 2,
  headerHeight = 44,
): GridMetrics {
  const safeWidth = Math.max(screenWidth, 1);
  const totalGaps = Math.max(0, columns - 1) * gap;
  const cellSize = Math.floor((safeWidth - totalGaps) / columns);
  return { columns, gap, cellSize: Math.max(1, cellSize), headerHeight };
}

const MONTH_NAMES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function formatSectionHeader(timestamp: number) {
  const d = new Date(timestamp);
  const year = d.getUTCFullYear();
  const monthIdx = d.getUTCMonth();
  const monthKey = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
  const title = `${MONTH_NAMES_ES[monthIdx]} ${year}`;
  return { monthKey, title };
}

export function buildTimelineLayoutIndex(
  items: HybridGalleryItem[],
  metrics: GridMetrics,
): TimelineLayoutIndex {
  const rows: TimelineListRow[] = [];
  const monthOffsetMap = new Map<string, number>();

  let currentMonthKey = "";
  let currentBucket: HybridGalleryItem[] = [];
  let currentHeaderTitle = "";
  let currentHeaderTimestamp = 0;

  const flushBucket = () => {
    if (currentBucket.length === 0) return;
    rows.push({
      type: "header",
      key: `hdr:${currentMonthKey}`,
      title: currentHeaderTitle,
      monthKey: currentMonthKey,
      timestamp: currentHeaderTimestamp,
      count: currentBucket.length,
    });
    const cols = metrics.columns;
    for (let i = 0; i < currentBucket.length; i += cols) {
      const slice = currentBucket.slice(i, i + cols);
      rows.push({
        type: "media_row",
        key: `row:${currentMonthKey}:${slice[0]!.stableKey}`,
        monthKey: currentMonthKey,
        items: slice,
      });
    }
    currentBucket = [];
  };

  for (const item of items) {
    const { monthKey, title } = formatSectionHeader(item.timestamp);
    if (monthKey !== currentMonthKey) {
      flushBucket();
      currentMonthKey = monthKey;
      currentHeaderTitle = title;
      currentHeaderTimestamp = item.timestamp;
    }
    currentBucket.push(item);
  }
  flushBucket();

  const rowOffsets = new Float64Array(rows.length);
  const rowHeights = new Float32Array(rows.length);
  const mediaRowHeight = metrics.cellSize + metrics.gap;
  let runningOffset = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    rowOffsets[i] = runningOffset;
    if (!monthOffsetMap.has(row.monthKey)) monthOffsetMap.set(row.monthKey, runningOffset);
    const h = row.type === "header" ? metrics.headerHeight : mediaRowHeight;
    rowHeights[i] = h;
    runningOffset += h;
  }

  return { rows, rowOffsets, rowHeights, totalHeight: runningOffset, monthOffsetMap };
}

export function findRowIndexAtOffset(layout: TimelineLayoutIndex, scrollOffsetPx: number): number {
  const { rowOffsets, rows } = layout;
  if (rows.length === 0) return -1;
  if (scrollOffsetPx <= 0) return 0;
  if (scrollOffsetPx >= layout.totalHeight) return rows.length - 1;

  let low = 0;
  let high = rows.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const start = rowOffsets[mid]!;
    const end = start + layout.rowHeights[mid]!;
    if (scrollOffsetPx >= start && scrollOffsetPx < end) return mid;
    if (scrollOffsetPx < start) high = mid - 1;
    else low = mid + 1;
  }
  return Math.max(0, Math.min(low, rows.length - 1));
}
