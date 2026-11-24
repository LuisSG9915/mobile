import { describe, expect, it } from "vitest";
import { toWallClockUtc } from "./wall-clock";

describe("toWallClockUtc", () => {
  it("devuelve la hora de pared local como si fuera UTC", () => {
    const local = new Date(2026, 10, 23, 20, 15, 0); // 23-nov-2026 20:15 hora local
    const wall = new Date(toWallClockUtc(local.getTime()));
    expect(wall.getUTCFullYear()).toBe(2026);
    expect(wall.getUTCMonth()).toBe(10);
    expect(wall.getUTCDate()).toBe(23);
    expect(wall.getUTCHours()).toBe(20);
    expect(wall.getUTCMinutes()).toBe(15);
  });

  it("no cambia el día calendario aunque la hora local sea tarde", () => {
    const late = new Date(2026, 5, 1, 23, 59, 0);
    expect(new Date(toWallClockUtc(late.getTime())).getUTCDate()).toBe(1);
  });
});
