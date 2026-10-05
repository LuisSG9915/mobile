import { env, SELF } from "cloudflare:test";
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
});
