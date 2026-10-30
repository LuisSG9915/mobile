import { afterEach, describe, expect, it } from "vitest";
import { installFakeXhr } from "../test-support/fake-xhr";
import { PartUploadError, uploadPartBlob } from "./upload-part";

/** Blob mínimo: `uploadPartBlob` solo usa `arrayBuffer()`. */
function makeBlob(bytes: number): Blob {
  const buffer = new Uint8Array(bytes);
  return { arrayBuffer: async () => buffer.buffer } as unknown as Blob;
}

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

describe("uploadPartBlob (nativo)", () => {
  it("sube la parte como ArrayBuffer (sin base64) y devuelve el ETag de R2", async () => {
    const fake = installFakeXhr({ status: 200, etag: '"etag-1"' });
    restore = fake.restore;
    const progress: number[] = [];

    const res = await uploadPartBlob({
      url: "https://r2/part/2",
      blob: makeBlob(8),
      onProgress: (sent) => progress.push(sent),
    });

    expect(res.etag).toBe('"etag-1"');
    expect(progress.at(-1)).toBe(8);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].method).toBe("PUT");
    expect(fake.requests[0].body).toBeInstanceOf(ArrayBuffer);
  });

  it("un 404 se propaga con status para distinguir sesión muerta de fallo de red", async () => {
    const fake = installFakeXhr({ status: 404 });
    restore = fake.restore;

    const error = await uploadPartBlob({ url: "https://r2/part/1", blob: makeBlob(4) }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(PartUploadError);
    expect((error as PartUploadError).status).toBe(404);
  });

  it("sin ETag rechaza en vez de inventarlo", async () => {
    const fake = installFakeXhr({ status: 200, etag: null });
    restore = fake.restore;

    await expect(uploadPartBlob({ url: "https://r2/part/1", blob: makeBlob(4) })).rejects.toThrow(
      /ETag/,
    );
  });

  it("un signal ya abortado rechaza sin abrir la petición", async () => {
    const fake = installFakeXhr({ status: 200, etag: '"x"' });
    restore = fake.restore;
    const controller = new AbortController();
    controller.abort();

    await expect(
      uploadPartBlob({
        url: "https://r2/part/1",
        blob: makeBlob(4),
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelada/);
    expect(fake.requests).toHaveLength(0);
  });

  it("abortar mientras se materializa la parte rechaza sin llegar a la red", async () => {
    const fake = installFakeXhr({ status: 200, etag: '"x"' });
    restore = fake.restore;
    const controller = new AbortController();

    const pending = uploadPartBlob({
      url: "https://r2/part/1",
      blob: makeBlob(4),
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toThrow(/cancelada/);
    expect(fake.requests).toHaveLength(0);
  });

  it("abortar con la petición en vuelo la cancela", async () => {
    const fake = installFakeXhr({ status: 200, etag: '"x"', hold: true });
    restore = fake.restore;
    const controller = new AbortController();

    const pending = uploadPartBlob({
      url: "https://r2/part/1",
      blob: makeBlob(4),
      signal: controller.signal,
    });
    // Deja que `arrayBuffer()` se resuelva y que arranque el send.
    // (un macrotask vacía toda la cola de microtasks, incluido withDeadline)
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();

    await expect(pending).rejects.toThrow(/cancelada/);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].aborted).toBe(true);
  });
});
