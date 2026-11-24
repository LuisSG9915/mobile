import { describe, expect, it } from "vitest";
import { fitResize } from "./thumb-fit";

describe("fitResize", () => {
  it("horizontal: fija el ancho", () => {
    expect(fitResize({ width: 4000, height: 3000 }, 400)).toEqual({ width: 400 });
  });
  it("vertical: fija el alto (antes se fijaba el ancho y el lado mayor pasaba de 400)", () => {
    expect(fitResize({ width: 3072, height: 4096 }, 400)).toEqual({ height: 400 });
  });
  it("no amplía imágenes que ya caben", () => {
    expect(fitResize({ width: 300, height: 200 }, 400)).toBeNull();
    expect(fitResize({ width: 1080, height: 1500 }, 1600)).toBeNull();
  });
  it("sin dimensiones usa el ancho", () => {
    expect(fitResize(undefined, 400)).toEqual({ width: 400 });
    expect(fitResize({ width: 0, height: 0 }, 400)).toEqual({ width: 400 });
  });
});
