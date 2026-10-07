import { env, SELF } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { media } from "../src/db/schema";
import { authed, createUser, j, sha } from "./helpers";

async function seedMedia(
  userId: string,
  n: number,
  opts: { status?: string; deleted?: boolean } = {},
) {
  const db = getDb(env.DB);
  const base = Date.now() - 1_000_000;
  for (let i = 0; i < n; i++) {
    const s = sha(
      `${userId.slice(0, 4)}${i.toString(16)}${opts.status ?? "ready"}${opts.deleted ? "d" : ""}`,
    );
    await db.insert(media).values({
      id: crypto.randomUUID(),
      userId,
      sha256: s,
      mediaType: i % 7 === 0 ? "video" : "photo",
      mimeType: i % 7 === 0 ? "video/mp4" : "image/jpeg",
      ext: i % 7 === 0 ? "mp4" : "jpg",
      takenAt: base + i * 1000,
      width: 4032,
      height: 3024,
      thumbhash: "AQAAAA==",
      r2KeyOriginal: `users/${userId}/originals/${s}.jpg`,
      r2KeyThumb: `users/${userId}/thumbs/${s}.webp`,
      fileSize: 1_000_000,
      thumbSize: 8_000,
      status: (opts.status ?? "ready") as "pending" | "ready",
      createdAt: base,
      updatedAt: base,
      deletedAt: opts.deleted ? base : null,
    });
  }
}

describe("timeline", () => {
  it("pagina 130 items con limit=60 → 60/60/10 sin duplicados y en orden", async () => {
    const { cookie, userId } = await createUser();
    await seedMedia(userId, 130);

    const seen = new Set<string>();
    let cursor: string | undefined;
    const counts: number[] = [];
    for (let page = 0; page < 3; page++) {
      const url = `http://localhost/v1/timeline?limit=60${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await SELF.fetch(url, authed(cookie));
      expect(res.status).toBe(200);
      const json = await j(res);
      counts.push(json.items.length);
      for (const item of json.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
        expect(item.thumbUrl).toContain("X-Amz-Signature");
      }
      // orden descendente por takenAt
      const ts = json.items.map((i: { takenAt: number }) => i.takenAt);
      expect([...ts].sort((a, b) => b - a)).toEqual(ts);
      cursor = json.nextCursor ?? undefined;
    }
    expect(counts).toEqual([60, 60, 10]);
    expect(cursor).toBeUndefined();
  });

  it("excluye pending y borrados; no mezcla usuarios", async () => {
    const { cookie, userId } = await createUser();
    const other = await createUser();
    await seedMedia(userId, 5, { status: "pending" });
    await seedMedia(userId, 5, { deleted: true });
    await seedMedia(userId, 3);
    await seedMedia(other.userId, 4);

    const res = await SELF.fetch("http://localhost/v1/timeline?limit=200", authed(cookie));
    const json = await j(res);
    expect(json.items.length).toBe(3);
    expect(json.nextCursor).toBeNull();
  });

  it("cursor inválido → 400", async () => {
    const { cookie } = await createUser();
    const res = await SELF.fetch("http://localhost/v1/timeline?cursor=%%%", authed(cookie));
    expect(res.status).toBe(400);
  });

  it("filter=photos/videos/favorites restringen el resultado", async () => {
    const { cookie, userId } = await createUser();
    await seedMedia(userId, 14); // i%7===0 → 2 videos, 12 fotos
    const db = getDb(env.DB);
    const rows = await db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.userId, userId), eq(media.mediaType, "photo")))
      .limit(3);
    for (const r of rows) {
      await db.update(media).set({ isFavorite: true }).where(eq(media.id, r.id));
    }

    const photos = await j(
      await SELF.fetch("http://localhost/v1/timeline?filter=photos", authed(cookie)),
    );
    expect(photos.items.length).toBe(12);
    for (const it of photos.items) expect(it.mediaType).toBe("photo");

    const videos = await j(
      await SELF.fetch("http://localhost/v1/timeline?filter=videos", authed(cookie)),
    );
    expect(videos.items.length).toBe(2);
    for (const it of videos.items) expect(it.mediaType).toBe("video");

    const favs = await j(
      await SELF.fetch("http://localhost/v1/timeline?filter=favorites", authed(cookie)),
    );
    expect(favs.items.length).toBe(3);
    for (const it of favs.items) expect(it.isFavorite).toBe(true);
  });

  it("months devuelve los meses con conteo en orden descendente", async () => {
    const { cookie, userId } = await createUser();
    const db = getDb(env.DB);
    const mk = async (takenAt: number) => {
      const s = sha(`m${takenAt}-${Math.random().toString(16).slice(2, 8)}`);
      await db.insert(media).values({
        id: crypto.randomUUID(),
        userId,
        sha256: s,
        mediaType: "photo",
        mimeType: "image/jpeg",
        ext: "jpg",
        takenAt,
        dateGroup: new Date(takenAt).toISOString().slice(0, 10),
        width: 1,
        height: 1,
        thumbhash: "AQAAAA==",
        r2KeyOriginal: `users/${userId}/originals/${s}.jpg`,
        r2KeyThumb: `users/${userId}/thumbs/${s}.webp`,
        fileSize: 1,
        thumbSize: 1,
        status: "ready",
        createdAt: takenAt,
        updatedAt: takenAt,
        deletedAt: null,
      });
    };
    await mk(Date.UTC(2026, 5, 10));
    await mk(Date.UTC(2026, 5, 11));
    await mk(Date.UTC(2026, 4, 5));

    const res = await SELF.fetch("http://localhost/v1/timeline/months", authed(cookie));
    expect(res.status).toBe(200);
    const json = await j(res);
    expect(json.months).toEqual([
      { month: "2026-06", count: 2 },
      { month: "2026-05", count: 1 },
    ]);
  });
});
