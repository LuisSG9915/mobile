import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@jsquash/webp/encode.js", () => ({
  init: vi.fn().mockResolvedValue(undefined),
  default: vi.fn().mockResolvedValue(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]).buffer),
}));

import { makeThumb } from "./thumb";

describe("makeThumb (web)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("genera miniatura WebP de forma nativa cuando canvas.toBlob soporta image/webp", async () => {
    // Mock createImageBitmap
    const mockBitmap = { width: 800, height: 600, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(mockBitmap));

    // Mock Canvas & Context2D
    const mockCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({
        width: 100,
        height: 75,
        data: new Uint8ClampedArray(100 * 75 * 4),
      }),
    };

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      mockCtx as unknown as CanvasRenderingContext2D,
    );

    // Simula soporte nativo de WebP en canvas
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      callback,
      _type,
      _quality,
    ) {
      const dummyWebp = new Blob([new Uint8Array(1024)], { type: "image/webp" });
      callback(dummyWebp);
    });

    const testFile = new File(["fake-image-bytes"], "test.jpg", { type: "image/jpeg" });
    const result = await makeThumb("photo", testFile);

    expect(result.blob.type).toBe("image/webp");
    expect(result.bytes).toBe(1024);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.thumbhash).toBeDefined();
    expect(result.thumbhash.length).toBeGreaterThan(0);
  });

  it("activa fallback WASM y genera WebP cuando canvas.toBlob devuelve PNG (comportamiento Safari)", async () => {
    const mockBitmap = { width: 400, height: 300, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(mockBitmap));

    const mockCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({
        width: 100,
        height: 75,
        data: new Uint8ClampedArray(100 * 75 * 4),
      }),
    };

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      mockCtx as unknown as CanvasRenderingContext2D,
    );

    // Simula Safari: cuando se pide 'image/webp', toBlob devuelve 'image/png'
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      callback,
      _type,
      _quality,
    ) {
      const pngFallback = new Blob([new Uint8Array(2048)], { type: "image/png" });
      callback(pngFallback);
    });

    // Mock fetch para devolver el módulo wasm simulado
    const dummyWasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d]); // WASM magic header
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(dummyWasmBytes.buffer),
      }),
    );

    const testFile = new File(["fake-image-bytes"], "safari.jpg", { type: "image/jpeg" });
    const result = await makeThumb("photo", testFile);

    expect(result.blob.type).toBe("image/webp");
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
    expect(result.thumbhash).toBeDefined();
  });
});
