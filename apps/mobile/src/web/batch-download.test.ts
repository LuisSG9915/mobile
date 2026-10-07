import { afterEach, describe, expect, it, vi } from "vitest";
import { buildZip } from "./batch-download";

afterEach(() => vi.unstubAllGlobals());

describe("buildZip", () => {
  it("empaqueta 5 archivos en un ZIP con concurrencia ≤ 3", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn(async (url: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(`bytes-${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const entries = Array.from({ length: 5 }, (_, i) => ({
      url: `https://r2.dev/u${i}`,
      name: `f${i}.jpg`,
    }));
    const blob = await buildZip(entries);

    expect(blob.size).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    // Magic bytes de ZIP: PK\x03\x04
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    expect([...head]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("propaga el error si una descarga falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x", { status: 404, statusText: "Not Found" })),
    );
    await expect(buildZip([{ url: "u", name: "f.jpg" }])).rejects.toThrow("HTTP 404");
  });

  it("rechaza lotes vacíos", async () => {
    await expect(buildZip([])).rejects.toThrow("No hay elementos");
  });
});
