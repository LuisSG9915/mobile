import { describe, expect, it } from "vitest";
import { isThumbUrl, playableVideoUri, videoSources } from "./video-source";

describe("playableVideoUri", () => {
  it("usa el original válido", () => {
    expect(playableVideoUri("https://r2/users/u/originals/a.mp4", "https://r2/p.mp4")).toBe(
      "https://r2/users/u/originals/a.mp4",
    );
  });
  it("descarta una miniatura y cae al preview", () => {
    expect(playableVideoUri("https://r2/users/u/thumbs/a.webp", "https://r2/p.mp4")).toBe(
      "https://r2/p.mp4",
    );
  });
  it("sin nada reproducible devuelve vacío", () => {
    expect(playableVideoUri("", null)).toBe("");
    expect(
      playableVideoUri("https://r2/users/u/thumbs/a.webp", "https://r2/users/u/thumbs/b.webp"),
    ).toBe("");
  });
  it("detecta miniaturas", () => {
    expect(isThumbUrl("https://x/users/u/thumbs/a.webp")).toBe(true);
    expect(isThumbUrl(undefined)).toBe(false);
  });
});

describe("videoSources", () => {
  it("archivo local primero y preview como respaldo", () => {
    expect(videoSources("file:///a.mp4", "https://r2/p.mp4")).toEqual({
      primary: "file:///a.mp4",
      fallback: "https://r2/p.mp4",
    });
  });
  it("remoto: preview primero y original de respaldo", () => {
    expect(videoSources("https://r2/o.mp4", "https://r2/p.mp4")).toEqual({
      primary: "https://r2/p.mp4",
      fallback: "https://r2/o.mp4",
    });
  });
  it("remoto sin preview: solo original", () => {
    expect(videoSources("https://r2/o.mp4", null)).toEqual({
      primary: "https://r2/o.mp4",
      fallback: null,
    });
  });
});
