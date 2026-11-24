import { describe, expect, it } from "vitest";
import { canDecodeWithoutAlpha } from "./image-alpha";

describe("canDecodeWithoutAlpha", () => {
  it("JPEG locales sí", () => {
    expect(canDecodeWithoutAlpha("file:///storage/emulated/0/DCIM/a.JPG")).toBe(true);
    expect(canDecodeWithoutAlpha("file:///x/b.jpeg?t=1")).toBe(true);
  });
  it("PNG, WebP, GIF, HEIC y desconocidos no", () => {
    for (const u of [
      "a.png",
      "a.webp",
      "a.gif",
      "a.heic",
      "content://media/external/images/media/5",
    ]) {
      expect(canDecodeWithoutAlpha(`file:///x/${u}`.replace("file:///x/content", "content"))).toBe(
        false,
      );
    }
  });
  it("miniaturas remotas sí; vacío no", () => {
    expect(canDecodeWithoutAlpha("https://r2/users/u/thumbs/a.webp")).toBe(true);
    expect(canDecodeWithoutAlpha(null)).toBe(false);
  });
});
