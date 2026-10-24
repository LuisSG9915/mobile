import * as Linking from "expo-linking";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verificationRedirectTarget } from "./verification";

vi.mock("expo-linking", () => ({
  createURL: vi.fn((path: string) => `photos:///${path.replace(/^\//, "")}`),
}));

describe("verificationRedirectTarget", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("web devuelve el origen actual con la ruta de welcome", () => {
    expect(verificationRedirectTarget()).toBe(`${window.location.origin}/welcome`);
  });

  it("sin window (nativo) devuelve el deep link photos:///welcome usando expo-linking", () => {
    vi.stubGlobal("window", undefined);
    const target = verificationRedirectTarget();
    expect(target).toBe("photos:///welcome");
    expect(Linking.createURL).toHaveBeenCalledWith("welcome");
  });
});
