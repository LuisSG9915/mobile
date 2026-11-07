import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  native: null as null,
}));

vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => h.native,
}));

vi.mock("react-native", () => ({}));

import { getSystemVideoThumbnail, hasSystemVideoThumbnail } from "./video-thumbnail";

describe("video-thumbnail (sin módulo nativo)", () => {
  it("devuelve null cuando el módulo nativo no está disponible", async () => {
    expect(hasSystemVideoThumbnail()).toBe(false);
    const res = await getSystemVideoThumbnail("file:///tmp/video.mp4");
    expect(res).toBeNull();
  });

  it("devuelve null para uri vacía", async () => {
    const res = await getSystemVideoThumbnail("");
    expect(res).toBeNull();
  });
});