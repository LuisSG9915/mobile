import { describe, expect, it } from "vitest";
import { aspectRatioValue } from "./image-editor-calc";

describe("aspectRatioValue", () => {
  it("original devuelve null", () => {
    expect(aspectRatioValue("original")).toBeNull();
  });

  it("1:1 devuelve 1", () => {
    expect(aspectRatioValue("1:1")).toBe(1);
  });

  it("4:3 devuelve 4 / 3", () => {
    expect(aspectRatioValue("4:3")).toBeCloseTo(4 / 3);
  });

  it("16:9 devuelve 16 / 9", () => {
    expect(aspectRatioValue("16:9")).toBeCloseTo(16 / 9);
  });

  it("9:16 devuelve 9 / 16", () => {
    expect(aspectRatioValue("9:16")).toBeCloseTo(9 / 16);
  });
});
