import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadBlob } from "./upload";

type ProgressPayload = { lengthComputable: boolean; loaded: number; total: number };

/** XHR falso: registra las llamadas y permite disparar los callbacks a mano. */
class FakeXHR {
  static instances: FakeXHR[] = [];

  upload: { onprogress: ((e: ProgressPayload) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  method = "";
  url = "";
  headers = new Map<string, string>();
  body: unknown;
  aborted = false;

  constructor() {
    FakeXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers.set(key, value);
  }

  send(body?: unknown) {
    this.body = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

beforeEach(() => {
  FakeXHR.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadBlob", () => {
  it("hace PUT a la url prefirmada, aplica headers y omite content-length", async () => {
    const target = {
      url: "https://r2.example.com/objeto?sig=abc",
      headers: {
        "content-type": "image/png",
        "Content-Length": "9999",
        "x-amz-meta-sha": "abc",
      },
    };
    const blob = new Blob(["datos"]);

    const promise = uploadBlob(target, blob);

    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe(target.url);
    expect(xhr.body).toBe(blob);
    expect(xhr.headers.get("content-type")).toBe("image/png");
    expect(xhr.headers.get("x-amz-meta-sha")).toBe("abc");
    const contentLengthKeys = [...xhr.headers.keys()].filter(
      (k) => k.toLowerCase() === "content-length",
    );
    expect(contentLengthKeys).toHaveLength(0);

    xhr.status = 200;
    xhr.onload?.();
    await promise;
  });

  it.each([200, 204])("resuelve cuando el status es %i", async (status) => {
    const promise = uploadBlob({ url: "https://r2.example.com/x", headers: {} }, new Blob(["x"]));
    const xhr = FakeXHR.instances[0];
    xhr.status = status;
    xhr.onload?.();
    await expect(promise).resolves.toBeUndefined();
  });

  it("rechaza con el status en el mensaje cuando no es 200/204", async () => {
    const promise = uploadBlob({ url: "https://r2.example.com/x", headers: {} }, new Blob(["x"]));
    const xhr = FakeXHR.instances[0];
    xhr.status = 403;
    xhr.onload?.();
    // H-009 (resuelto): el mensaje llega en español y se muestra al usuario.
    await expect(promise).rejects.toThrow(/^La subida falló \(HTTP 403\)\.$/);
  });

  it("rechaza con 'Error de red al subir el archivo.' ante onerror", async () => {
    const promise = uploadBlob({ url: "https://r2.example.com/x", headers: {} }, new Blob(["x"]));
    FakeXHR.instances[0].onerror?.();
    await expect(promise).rejects.toThrow("Error de red al subir el archivo.");
  });

  it("rechaza con 'La subida tardó demasiado.' ante ontimeout", async () => {
    const promise = uploadBlob({ url: "https://r2.example.com/x", headers: {} }, new Blob(["x"]));
    FakeXHR.instances[0].ontimeout?.();
    await expect(promise).rejects.toThrow("La subida tardó demasiado.");
  });

  it("rechaza de inmediato si la señal ya venía abortada (sin crear el XHR)", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadBlob(
        { url: "https://r2.example.com/x", headers: {} },
        new Blob(["x"]),
        undefined,
        controller.signal,
      ),
    ).rejects.toThrow("Subida cancelada.");
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it("rechaza 'Subida cancelada.' cuando se aborta a mitad de la subida", async () => {
    const controller = new AbortController();
    const promise = uploadBlob(
      { url: "https://r2.example.com/x", headers: {} },
      new Blob(["x"]),
      undefined,
      controller.signal,
    );
    const xhr = FakeXHR.instances[0];
    controller.abort();
    expect(xhr.aborted).toBe(true);
    await expect(promise).rejects.toThrow("Subida cancelada.");
  });

  it("deja de escuchar la señal tras resolver (abort posterior no llega al XHR)", async () => {
    const controller = new AbortController();
    const promise = uploadBlob(
      { url: "https://r2.example.com/x", headers: {} },
      new Blob(["x"]),
      undefined,
      controller.signal,
    );
    const xhr = FakeXHR.instances[0];
    xhr.status = 200;
    xhr.onload?.();
    await promise;
    controller.abort();
    expect(xhr.aborted).toBe(false);
  });

  it("notifica el progreso con (loaded, total) cuando lengthComputable", async () => {
    const onProgress = vi.fn();
    const promise = uploadBlob(
      { url: "https://r2.example.com/x", headers: {} },
      new Blob(["x"]),
      onProgress,
    );
    const xhr = FakeXHR.instances[0];
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    expect(onProgress).toHaveBeenCalledWith(5, 10);
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 6, total: 10 });
    expect(onProgress).toHaveBeenCalledTimes(1);
    xhr.status = 204;
    xhr.onload?.();
    await promise;
  });
});
