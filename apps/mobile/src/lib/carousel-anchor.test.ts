import { describe, expect, it } from "vitest";
import { resolveActiveIndex } from "./carousel-anchor";

describe("resolveActiveIndex", () => {
  it("sin ancla usa el índice del id pedido", () => {
    expect(resolveActiveIndex(["a", "b", "c"], null, 2)).toBe(2);
  });
  it("sin ancla ni id usa 0", () => {
    expect(resolveActiveIndex(["a", "b"], null, -1)).toBe(0);
  });
  it("con ancla sigue al elemento aunque se inserten otros por delante", () => {
    expect(resolveActiveIndex(["a", "b", "c"], "c", 0)).toBe(2);
    expect(resolveActiveIndex(["x", "y", "a", "b", "c"], "c", 0)).toBe(4);
  });
  it("si el ancla desaparece vuelve al id pedido", () => {
    expect(resolveActiveIndex(["a", "b"], "zzz", 1)).toBe(1);
  });
});
