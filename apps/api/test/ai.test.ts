import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "../src/db/client";
import { media } from "../src/db/schema";
import { generateImageTags, tagMediaItem } from "../src/lib/ai";
import { createUser, sha } from "./helpers";

describe("ai tagging", () => {
  it("generateImageTags devuelve [] si env.AI no está configurado", async () => {
    const fakeEnv = { ...env, AI: undefined };
    const tags = await generateImageTags(fakeEnv, "non-existent-thumb");
    expect(tags).toEqual([]);
  });

  it("generateImageTags procesa respuesta de modelo multimodal", async () => {
    const s = sha("ai-thumb-test");
    const thumbKey = `test/thumbs/${s}.webp`;
    await env.BUCKET.put(thumbKey, new Uint8Array([1, 2, 3, 4]));

    const mockRun = vi.fn().mockResolvedValue({
      description: "perro, césped, parque, mascota",
    });

    const fakeEnv = {
      ...env,
      AI: { run: mockRun },
    };

    const tags = await generateImageTags(fakeEnv, thumbKey);
    expect(tags).toEqual(["perro", "césped", "parque", "mascota"]);
    expect(mockRun).toHaveBeenCalledWith(
      "@cf/llava-hf/llava-1.5-7b-hf",
      expect.objectContaining({ max_tokens: 60 }),
    );
  });

  it("generateImageTags recurre a ResNet-50 si el multimodal falla", async () => {
    const s = sha("ai-resnet-test");
    const thumbKey = `test/thumbs/${s}.webp`;
    await env.BUCKET.put(thumbKey, new Uint8Array([5, 6, 7, 8]));

    const mockRun = vi
      .fn()
      .mockRejectedValueOnce(new Error("LLaVA timeout"))
      .mockResolvedValueOnce([
        { label: "golden retriever, dog", score: 0.85 },
        { label: "tennis ball", score: 0.22 },
        { label: "grass", score: 0.05 }, // score < 0.15 omitido
      ]);

    const fakeEnv = {
      ...env,
      AI: { run: mockRun },
    };

    const tags = await generateImageTags(fakeEnv, thumbKey);
    expect(tags).toEqual(["golden retriever", "tennis ball"]);
  });

  it("tagMediaItem fusiona etiquetas existentes y actualiza la fila", async () => {
    const { userId } = await createUser();
    const db = getDb(env.DB);
    const id = crypto.randomUUID();
    const s = sha("ai-media-tag-test");
    const thumbKey = `users/${userId}/thumbs/${s}.webp`;
    await env.BUCKET.put(thumbKey, new Uint8Array([1, 2, 3]));

    await db.insert(media).values({
      id,
      userId,
      sha256: s,
      mediaType: "photo",
      mimeType: "image/jpeg",
      ext: "jpg",
      takenAt: Date.now(),
      width: 1000,
      height: 1000,
      thumbhash: "AQAAAA==",
      r2KeyOriginal: `users/${userId}/originals/${s}.jpg`,
      r2KeyThumb: thumbKey,
      fileSize: 100_000,
      thumbSize: 5_000,
      status: "ready",
      tags: JSON.stringify(["vacaciones", "familia"]),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const mockRun = vi.fn().mockResolvedValue({
      description: "playa, atardecer, vacaciones", // "vacaciones" ya existía
    });

    const fakeEnv = {
      ...env,
      AI: { run: mockRun },
    };

    const merged = await tagMediaItem(fakeEnv, id, userId);
    expect(merged).toEqual(["vacaciones", "familia", "playa", "atardecer"]);

    const updatedRow = await db.select().from(media).get();
    expect(JSON.parse(updatedRow?.tags ?? "[]")).toContain("playa");
  });
});
