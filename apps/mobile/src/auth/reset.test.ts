import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRedirectTarget } from "./reset";

describe("resetRedirectTarget", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("web devuelve el origen actual con la ruta de reset", () => {
    expect(resetRedirectTarget()).toBe(`${window.location.origin}/reset-password`);
  });

  it("sin window (nativo) devuelve el deep link del scheme", () => {
    vi.stubGlobal("window", undefined);
    expect(resetRedirectTarget()).toBe("photos:///reset-password");
  });
});
