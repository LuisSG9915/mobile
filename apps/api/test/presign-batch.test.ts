import { PRESIGN_BATCH_MAX_KEYS } from "@photos/shared";
import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/env";
import { clearPresignCacheForTests, presignGetBatch } from "../src/lib/s3";

/**
 * La firma de URLs es local (no toca la red): estos tests cubren el contrato
 * del lote sin D1 ni R2 reales.
 */
const env = {
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  R2_BUCKET_NAME: "photos-test",
  PRESIGN_GET_TTL_SECONDS: "43200",
} as unknown as Bindings;

describe("presignGetBatch", () => {
  it("firma cada clave y deduplica las repetidas", async () => {
    clearPresignCacheForTests();
    const keys = ["users/u1/thumbs/a.webp", "users/u1/thumbs/b.webp", "users/u1/thumbs/a.webp"];

    const urls = await presignGetBatch(env, keys);

    expect(Object.keys(urls).sort()).toEqual(["users/u1/thumbs/a.webp", "users/u1/thumbs/b.webp"]);
    for (const [key, url] of Object.entries(urls)) {
      expect(url).toContain(key);
      expect(url).toContain("X-Amz-Signature");
      expect(url).toContain("photos-test");
    }
  });

  it("acota el lote a PRESIGN_BATCH_MAX_KEYS", async () => {
    clearPresignCacheForTests();
    const keys = Array.from({ length: 150 }, (_, i) => `users/u1/thumbs/${i}.webp`);

    const urls = await presignGetBatch(env, keys);

    expect(Object.keys(urls)).toHaveLength(PRESIGN_BATCH_MAX_KEYS);
  });

  it("reutiliza la URL de la ventana de prefirma (misma clave → misma URL)", async () => {
    clearPresignCacheForTests();

    const first = await presignGetBatch(env, ["users/u1/thumbs/a.webp"]);
    const second = await presignGetBatch(env, ["users/u1/thumbs/a.webp"]);

    expect(second["users/u1/thumbs/a.webp"]).toBe(first["users/u1/thumbs/a.webp"]);
  });
});
