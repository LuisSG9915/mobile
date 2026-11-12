import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { media, systemState } from "../src/db/schema";
import { aiDailyLimit, aiUsageKey, consumeAiQuota } from "../src/lib/ai-quota";
import { authed, createUser, j, sha } from "./helpers";

async function insertReadyMedia(userId: string, seed: string): Promise<string> {
  const db = getDb(env.DB);
  const id = crypto.randomUUID();
  const s = sha(seed);
  const now = Date.now();
  await db.insert(media).values({
    id,
    userId,
    sha256: s,
    mediaType: "photo",
    mimeType: "image/jpeg",
    ext: "jpg",
    takenAt: now,
    dateGroup: "2026-11-11",
    width: 1000,
    height: 1000,
    thumbhash: "AQAAAA==",
    r2KeyOriginal: `users/${userId}/originals/${s}.jpg`,
    r2KeyThumb: `users/${userId}/thumbs/${s}.webp`,
    fileSize: 1000,
    thumbSize: 100,
    status: "ready",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("cuota diaria de IA", () => {
  it("consume hasta el límite y no concede más de lo que queda", async () => {
    const { userId } = await createUser();
    const db = getDb(env.DB);
    const limit = 3;

    expect(await consumeAiQuota(db, userId, 2, limit)).toMatchObject({
      granted: 2,
      used: 2,
      limit,
    });
    // Pide 5 con 1 restante: se autoriza solo 1, no se rechaza.
    expect(await consumeAiQuota(db, userId, 5, limit)).toMatchObject({
      granted: 1,
      used: 3,
      limit,
    });
    expect(await consumeAiQuota(db, userId, 1, limit)).toMatchObject({
      granted: 0,
      used: 3,
      limit,
    });
  });

  it("rechaza el lote con 429 cuando la cuota del día está agotada", async () => {
    const { cookie, userId } = await createUser();
    const db = getDb(env.DB);
    await insertReadyMedia(userId, "ai-quota-batch");
    await db.insert(systemState).values({
      key: aiUsageKey(userId),
      value: String(aiDailyLimit(env)),
      updatedAt: Date.now(),
    });

    const res = await SELF.fetch(
      "http://localhost/v1/media/auto-tag-batch",
      authed(cookie, { method: "POST" }),
    );
    expect(res.status).toBe(429);
    expect((await j(res)).code).toBe("ai_quota_exceeded");
  });

  it("rechaza el etiquetado individual con 429 cuando la cuota está agotada", async () => {
    const { cookie, userId } = await createUser();
    const id = await insertReadyMedia(userId, "ai-quota-single");
    const db = getDb(env.DB);
    await db.insert(systemState).values({
      key: aiUsageKey(userId),
      value: String(aiDailyLimit(env)),
      updatedAt: Date.now(),
    });

    const res = await SELF.fetch(
      `http://localhost/v1/media/${id}/auto-tag`,
      authed(cookie, { method: "POST" }),
    );
    expect(res.status).toBe(429);
    expect((await j(res)).code).toBe("ai_quota_exceeded");
  });
});
