import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runCleanup } from "../src/cron/cleanup";
import { getDb } from "../src/db/client";
import { media, session, userStorageStats } from "../src/db/schema";
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
  it("purga pending inactivos >24h (por updated_at) y respeta los activos", async () => {
    const { userId } = await createUser();
    const oldSha = await seed(userId, {
      seed: "oldp",
      status: "pending",
      createdAt: Date.now() - 25 * 3600 * 1000,
      updatedAt: Date.now() - 25 * 3600 * 1000,
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

  it("NO purga pending con created_at viejo pero updated_at fresco (re-init reciente)", async () => {
    const { userId } = await createUser();
    // La subida se inició hace 2 días pero el cliente re-inició hace 1 h:
    // purgarla borraría los objetos de una subida aún en curso.
    const reinitSha = await seed(userId, {
      seed: "reinit",
      status: "pending",
      createdAt: Date.now() - 2 * DAY,
      updatedAt: Date.now() - 3600 * 1000,
    });
    await env.BUCKET.put(`users/${userId}/originals/${reinitSha}.jpg`, "x");

    await runCleanup(env);

    const db = getDb(env.DB);
    const rows = await db.select().from(media).where(eq(media.userId, userId)).all();
    expect(rows.length).toBe(1);
    expect(await env.BUCKET.head(`users/${userId}/originals/${reinitSha}.jpg`)).not.toBeNull();
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

  it("la purga de papelera descuenta la cuota (solo medios 'ready')", async () => {
    const { userId } = await createUser();
    const db = getDb(env.DB);
    // 'ready' purgado: fileSize 1_000 + thumbSize 500 = 1_500 contados
    await seed(userId, { seed: "rq", status: "ready", deletedAt: Date.now() - 31 * DAY });
    // 'pending' borrado suave: nunca sumó cuota
    await seed(userId, { seed: "pq", status: "pending", deletedAt: Date.now() - 31 * DAY });
    await db.insert(userStorageStats).values({
      userId,
      usedBytes: 1_500,
      mediaCount: 1,
      updatedAt: Date.now(),
    });

    await runCleanup(env);

    const stats = await db
      .select()
      .from(userStorageStats)
      .where(eq(userStorageStats.userId, userId))
      .get();
    expect(stats?.usedBytes).toBe(0);
    expect(stats?.mediaCount).toBe(0);
  });

  it("purga las sesiones caducadas y conserva las activas", async () => {
    const { userId } = await createUser();
    const db = getDb(env.DB);
    const expiredId = crypto.randomUUID();
    const activeId = crypto.randomUUID();
    await db.insert(session).values([
      {
        id: expiredId,
        userId,
        token: `expired-${expiredId}`,
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: activeId,
        userId,
        token: `active-${activeId}`,
        expiresAt: new Date(Date.now() + DAY),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await runCleanup(env);

    const rows = await db.select().from(session).where(eq(session.userId, userId)).all();
    expect(rows.map((r) => r.id)).not.toContain(expiredId);
    expect(rows.map((r) => r.id)).toContain(activeId);
  });

  it("reconcilia user_storage_stats con la suma real de media (corrige drift)", async () => {
    const { userId } = await createUser();
    const db = getDb(env.DB);
    // Contador inflado/erróneo respecto a los 1_500 B reales.
    await seed(userId, { seed: "real1" });
    await db.insert(userStorageStats).values({
      userId,
      usedBytes: 999_999,
      mediaCount: 99,
      updatedAt: Date.now(),
    });

    await runCleanup(env);

    const stats = await db
      .select()
      .from(userStorageStats)
      .where(eq(userStorageStats.userId, userId))
      .get();
    expect(stats?.usedBytes).toBe(1_500);
    expect(stats?.mediaCount).toBe(1);
  });

  it("no borra objetos R2 huérfanos con menos de 24h (subida en vuelo)", async () => {
    const { userId } = await createUser();
    // Objeto sin fila en media: un PUT que acaba de llegar. El barrido solo
    // elimina huérfanos con >24 h para no romper subidas en curso.
    await env.BUCKET.put(`users/${userId}/originals/${sha("huefano")}.jpg`, "x");

    await runCleanup(env);

    expect(await env.BUCKET.head(`users/${userId}/originals/${sha("huefano")}.jpg`)).not.toBeNull();
  });
});
