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

export type GridLine =
  | { kind: "header"; top: number; height: number; rowIndex: number }
  | { kind: "photos"; top: number; height: number; firstRow: number };

export type GridGeometry = { lines: GridLine[]; height: number };

export function buildGridGeometry(
  rows: GalleryRow[],
  columns: number,
  cellSize: number,
  headerHeight: number = HEADER_HEIGHT,
): GridGeometry {
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
  return { lines, height: y };
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
