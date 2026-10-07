import { describe, expect, it } from "vitest";
import type { GalleryRow, HybridPhoto } from "./gallery";
import {
  buildGridGeometry,
  HEADER_HEIGHT,
  hitTestPhoto,
  lineAtY,
  scrubLabel,
} from "./grid-geometry";

function photoRow(key: string, takenAt = 1_700_000_000_000): GalleryRow {
  const photo = { key, takenAt } as HybridPhoto;
  return { type: "photo", key: `p-${key}`, photo };
}

function headerRow(key: string): GalleryRow {
  return { type: "header", key: `h-${key}`, label: `Sección ${key}` };
}

// 2 secciones: 3 fotos + header + 4 fotos (grid de 3 columnas, celda 100)
const ROWS: GalleryRow[] = [
  headerRow("a"),
  photoRow("p1"),
  photoRow("p2"),
  photoRow("p3"),
  headerRow("b"),
  photoRow("p4"),
  photoRow("p5"),
  photoRow("p6"),
  photoRow("p7"),
];

const COLS = 3;
const CELL = 100;

describe("buildGridGeometry", () => {
  it("mapea encabezados y líneas de fotos con la altura total correcta", () => {
    const g = buildGridGeometry(ROWS, COLS, CELL);
    // header(40) + 1 línea + header(40) + 2 líneas = 380
    expect(g.height).toBe(HEADER_HEIGHT + CELL + HEADER_HEIGHT + 2 * CELL);
    expect(g.lines).toHaveLength(5);
    expect(g.lines[0]).toMatchObject({ kind: "header", top: 0, rowIndex: 0 });
    expect(g.lines[1]).toMatchObject({ kind: "photos", top: HEADER_HEIGHT, firstRow: 1 });
    expect(g.lines[2]).toMatchObject({
      kind: "header",
      top: HEADER_HEIGHT + CELL,
      rowIndex: 4,
    });
    expect(g.lines[3]).toMatchObject({
      kind: "photos",
      top: 2 * HEADER_HEIGHT + CELL,
      firstRow: 5,
    });
    expect(g.lines[4]).toMatchObject({ kind: "photos", firstRow: 8 });
  });
});

describe("hitTestPhoto", () => {
  const g = buildGridGeometry(ROWS, COLS, CELL);

  it("devuelve el índice en rows de la foto bajo el punto", () => {
    // Línea 1 (top 40): columnas 0..2 → rows 1..3
    expect(hitTestPhoto(g, ROWS, 10, HEADER_HEIGHT + 10, COLS, CELL)).toBe(1);
    expect(hitTestPhoto(g, ROWS, 150, HEADER_HEIGHT + 10, COLS, CELL)).toBe(2);
    expect(hitTestPhoto(g, ROWS, 250, HEADER_HEIGHT + 10, COLS, CELL)).toBe(3);
    // Línea parcial de la sección b (solo 1 foto en la última línea)
    const yLast = HEADER_HEIGHT + CELL + HEADER_HEIGHT + CELL + 10;
    expect(hitTestPhoto(g, ROWS, 10, yLast, COLS, CELL)).toBe(8);
  });

  it("devuelve null sobre encabezados y fuera de la cuadrícula", () => {
    expect(hitTestPhoto(g, ROWS, 50, 10, COLS, CELL)).toBeNull(); // header a
    expect(hitTestPhoto(g, ROWS, 50, HEADER_HEIGHT + CELL + 5, COLS, CELL)).toBeNull(); // header b
    expect(hitTestPhoto(g, ROWS, -5, 100, COLS, CELL)).toBeNull(); // x negativa
    expect(hitTestPhoto(g, ROWS, 350, 100, COLS, CELL)).toBeNull(); // x fuera
    // Hueco: la última línea tiene 1 foto, la columna 2 está vacía
    const yLast = HEADER_HEIGHT + CELL + HEADER_HEIGHT + CELL + 10;
    expect(hitTestPhoto(g, ROWS, 250, yLast, COLS, CELL)).toBeNull();
    expect(hitTestPhoto(g, ROWS, 50, 9999, COLS, CELL)).toBeNull();
  });
});

describe("lineAtY / scrubLabel", () => {
  const g = buildGridGeometry(ROWS, COLS, CELL);

  it("ubica la línea correcta para el fast-scrubber", () => {
    expect(lineAtY(g, 0)).toMatchObject({ kind: "header", rowIndex: 0 });
    expect(lineAtY(g, HEADER_HEIGHT + CELL / 2)).toMatchObject({ firstRow: 1 });
    expect(lineAtY(g, g.height - 1)).toMatchObject({ firstRow: 8 });
    expect(lineAtY(g, g.height + 1)).toBeNull();
    expect(lineAtY(g, -1)).toBeNull();
  });

  it("etiqueta con mes-año para fotos y con el label del encabezado", () => {
    const photoLine = lineAtY(g, HEADER_HEIGHT + 10);
    expect(scrubLabel(photoLine, ROWS)).toMatch(/2023/); // Noviembre 2023
    expect(scrubLabel(lineAtY(g, 5), ROWS)).toBe("Sección a");
    expect(scrubLabel(null, ROWS)).toBe("");
  });
});
