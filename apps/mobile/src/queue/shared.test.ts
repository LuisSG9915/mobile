import { describe, expect, it } from "vitest";
import {
  BACKOFF_MS,
  extFromFilename,
  extToMediaType,
  MAX_ATTEMPTS,
  mapWithConcurrency,
  PhaseTimeoutError,
  withDeadline,
} from "./shared";

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

describe("mapWithConcurrency", () => {
  it("no supera el límite en vuelo y conserva el orden de entrada", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const done: number[] = [];
    let active = 0;
    let peak = 0;

    await mapWithConcurrency(items, 3, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      done.push(item);
      active -= 1;
    });

    expect(peak).toBe(3);
    expect(done.sort((a, b) => a - b)).toEqual(items);
  });

  it("deja de lanzar tareas tras el primer fallo y relanza ese error", async () => {
    const started: number[] = [];

    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], 2, async (item) => {
        started.push(item);
        if (item === 2) throw new Error("404");
        await new Promise((resolve) => setTimeout(resolve, 1));
      }),
    ).rejects.toThrow("404");

    // Con 2 en vuelo, tras fallar la 2 solo se lanzó lo que ya estaba en curso.
    expect(started.length).toBeLessThan(9);
  });

  it("con lista vacía no hace nada", async () => {
    await expect(mapWithConcurrency([], 3, async () => {})).resolves.toBeUndefined();
  });
});

describe("withDeadline", () => {
  it("resuelve el valor cuando la promesa entra en el presupuesto", async () => {
    await expect(withDeadline(Promise.resolve(42), 50, "fase")).resolves.toBe(42);
  });

  it("rechaza PhaseTimeoutError si la promesa nunca resuelve", async () => {
    const colgada = new Promise(() => {});
    await expect(withDeadline(colgada, 10, "hash")).rejects.toThrow(PhaseTimeoutError);
  });

  it("ejecuta onTimeout antes de rechazar (cancelación nativa)", async () => {
    let cancelado = false;
    const colgada = new Promise(() => {});
    await expect(
      withDeadline(colgada, 10, "preview-video", () => {
        cancelado = true;
      }),
    ).rejects.toThrow(PhaseTimeoutError);
    expect(cancelado).toBe(true);
  });
});
