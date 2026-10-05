import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runCleanup } from "../src/cron/cleanup";
import { getDb } from "../src/db/client";
import { media } from "../src/db/schema";
import { createUser, sha } from "./helpers";

const DAY = 24 * 3600 * 1000;

async function seed(userId: string, over: Partial<typeof media.$inferInsert> & { seed: string }) {
  const db = getDb(env.DB);
  const { seed: seedStr, ...rest } = over;
  const s = sha(`${userId.slice(0, 6)}${seedStr}`);
  await db.insert(media).values({
    id: crypto.randomUUID(),
    userId,
    sha256: s,
    mediaType: "photo",
    mimeType: "image/jpeg",
    ext: "jpg",
    takenAt: Date.now(),
    width: 4000,
    height: 3000,
    thumbhash: "AQAAAA==",
    r2KeyOriginal: `users/${userId}/originals/${s}.jpg`,
    r2KeyThumb: `users/${userId}/thumbs/${s}.webp`,
    fileSize: 1_000,
    thumbSize: 500,
    status: "ready",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...rest,
  });
  return s;
}

describe("cron cleanup", () => {
  it("purga pending viejos (fila + objetos) y respeta los recientes", async () => {
    const { userId } = await createUser();
    const oldSha = await seed(userId, {
      seed: "oldp",
      status: "pending",
      createdAt: Date.now() - 25 * 3600 * 1000,
    });
    const newSha = await seed(userId, { seed: "newp", status: "pending" });
    await env.BUCKET.put(`users/${userId}/originals/${oldSha}.jpg`, "x");
    await env.BUCKET.put(`users/${userId}/thumbs/${oldSha}.webp`, "x");
    await env.BUCKET.put(`users/${userId}/originals/${newSha}.jpg`, "x");

    await runCleanup(env);

    const db = getDb(env.DB);
    const rows = await db.select().from(media).where(eq(media.userId, userId)).all();
    expect(rows.length).toBe(1);
    expect(rows[0].sha256).toBe(newSha);
    expect(await env.BUCKET.head(`users/${userId}/originals/${oldSha}.jpg`)).toBeNull();
    expect(await env.BUCKET.head(`users/${userId}/originals/${newSha}.jpg`)).not.toBeNull();
  });

  it("purga definitiva de papelera tras 30 días", async () => {
    const { userId } = await createUser();
    const oldSha = await seed(userId, { seed: "trash", deletedAt: Date.now() - 31 * DAY });
    const freshSha = await seed(userId, { seed: "fresh", deletedAt: Date.now() - 2 * DAY });
    await env.BUCKET.put(`users/${userId}/originals/${oldSha}.jpg`, "x");
    await env.BUCKET.put(`users/${userId}/originals/${freshSha}.jpg`, "x");

    await runCleanup(env);

    const db = getDb(env.DB);
    const rows = await db.select().from(media).where(eq(media.userId, userId)).all();
    expect(rows.length).toBe(1);
    expect(rows[0].sha256).toBe(freshSha);
    expect(await env.BUCKET.head(`users/${userId}/originals/${oldSha}.jpg`)).toBeNull();
    expect(await env.BUCKET.head(`users/${userId}/originals/${freshSha}.jpg`)).not.toBeNull();
  });
});
