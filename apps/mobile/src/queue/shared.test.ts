import { describe, expect, it } from "vitest";
import { BACKOFF_MS, extFromFilename, extToMediaType, MAX_ATTEMPTS } from "./shared";

describe("extFromFilename", () => {
  it("devuelve la extensión en minúsculas", () => {
    expect(extFromFilename("IMG.JPG", "photo")).toBe("jpg");
    expect(extFromFilename("clip.MOV", "video")).toBe("mov");
  });

  it("usa el fallback del mediaType cuando no hay filename", () => {
    expect(extFromFilename(null, "video")).toBe("mp4");
  });

  it("cae al fallback cuando la extensión no es permitida", () => {
    expect(extFromFilename("x.exe", "photo")).toBe("jpg");
  });

  it("cae al fallback cuando no hay extensión", () => {
    expect(extFromFilename("sin_ext", "photo")).toBe("jpg");
  });
});

describe("extToMediaType", () => {
  it("clasifica extensiones de video como video", () => {
    expect(extToMediaType("mp4")).toBe("video");
  });

  it("clasifica extensiones de imagen como photo", () => {
    expect(extToMediaType("png")).toBe("photo");
  });
});

describe("BACKOFF_MS", () => {
  it("tiene un tiempo de espera por intento", () => {
    expect(BACKOFF_MS.length).toBe(MAX_ATTEMPTS);
  });
});
