import { describe, expect, it } from "vitest";
import { monthJumpView } from "./month-jump";

describe("monthJumpView", () => {
  it("sin mes elegido: loading solo mientras la query inicial está pending", () => {
    expect(
      monthJumpView({ hasMonthScope: false, isPending: true, isError: false, rowCount: 0 }),
    ).toBe("loading");
    expect(
      monthJumpView({ hasMonthScope: false, isPending: false, isError: false, rowCount: 0 }),
    ).toBeNull();
  });

  it("sin mes elegido: con fotos locales en pantalla no se tapa la cuadrícula", () => {
    expect(
      monthJumpView({ hasMonthScope: false, isPending: true, isError: false, rowCount: 40 }),
    ).toBeNull();
  });

  it("con mes elegido: nunca monta la lista hasta que la query resuelve", () => {
    expect(
      monthJumpView({ hasMonthScope: true, isPending: true, isError: false, rowCount: 57 }),
    ).toBe("loading-month");
  });

  it("mes sin filas: empty-month, incluso con 0 o 1 filas", () => {
    for (const rowCount of [0, 1]) {
      expect(
        monthJumpView({ hasMonthScope: true, isPending: false, isError: false, rowCount }),
      ).toBe("empty-month");
    }
  });

  it("mes con fotos: sin overlay (la cuadrícula se pinta)", () => {
    expect(
      monthJumpView({ hasMonthScope: true, isPending: false, isError: false, rowCount: 2 }),
    ).toBeNull();
  });

  it("mes con error de red: error tiene prioridad sobre el empty state", () => {
    expect(
      monthJumpView({ hasMonthScope: true, isPending: false, isError: true, rowCount: 0 }),
    ).toBe("error");
  });

  it("error sin mes elegido no secuestra la galería (vacío genérico)", () => {
    expect(
      monthJumpView({ hasMonthScope: false, isPending: false, isError: true, rowCount: 0 }),
    ).toBeNull();
  });
});
