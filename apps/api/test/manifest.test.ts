import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { album, albumMedia, media } from "../src/db/schema";
import { authed, createUser, j, sha } from "./helpers";

async function seed(userId: string, name: string, takenAt: number, over = {}) {
  const s = sha(`${name}-${userId}`);
  const id = crypto.randomUUID();
  const now = Date.now();
  await getDb(env.DB)
    .insert(media)
    .values({
      id,
      userId,
      sha256: s,
      mediaType: "photo",
      mimeType: "image/jpeg",
      ext: "jpg",
      takenAt,
      dateGroup: new Date(takenAt).toISOString().slice(0, 10),
      width: 10,
      height: 10,
      thumbhash: "AQAAAA==",
      r2KeyOriginal: `users/${userId}/originals/${s}.jpg`,
      r2KeyThumb: `users/${userId}/thumbs/${s}.webp`,
      fileSize: 123,
      thumbSize: 5,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      ...over,
    });
  return id;
}

const get = (cookie: string, qs = "") =>
  SELF.fetch(`http://localhost/v1/media/manifest${qs}`, authed(cookie));

describe("GET /v1/media/manifest", () => {
  it("lista lo mínimo, sin URLs, y excluye papelera y pendientes", async () => {
    const { cookie, userId } = await createUser();
    const ok = await seed(userId, "ok", Date.UTC(2026, 0, 5));
    await seed(userId, "trash", Date.UTC(2026, 0, 6), { deletedAt: Date.now() });
    await seed(userId, "pend", Date.UTC(2026, 0, 7), { status: "pending" });
    const body = await j(await get(cookie));
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual({
      id: ok,
      sha256: sha(`ok-${userId}`),
      fileSize: 123,
      ext: "jpg",
      mediaType: "photo",
      takenAt: Date.UTC(2026, 0, 5),
    });
    expect(JSON.stringify(body)).not.toContain("http");
  });

  it("pagina de forma estable con cursor", async () => {
    const { cookie, userId } = await createUser();
    for (let i = 0; i < 5; i++) await seed(userId, `p${i}`, Date.UTC(2026, 0, 1 + i));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const qs: string = `?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const body = await j(await get(cookie, qs));
      seen.push(...body.items.map((i: { id: string }) => i.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("filtra por año", async () => {
    const { cookie, userId } = await createUser();
    await seed(userId, "y25", Date.UTC(2025, 5, 1));
    const y26 = await seed(userId, "y26", Date.UTC(2026, 5, 1));
    const body = await j(await get(cookie, "?year=2026"));
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([y26]);
  });

  it("filtra por álbum propio y no filtra álbumes ajenos", async () => {
    const a = await createUser();
    const b = await createUser();
    const inAlbum = await seed(a.userId, "in", Date.UTC(2026, 1, 1));
    await seed(a.userId, "out", Date.UTC(2026, 1, 2));
    const albumId = crypto.randomUUID();
    const now = Date.now();
    await getDb(env.DB)
      .insert(album)
      .values({ id: albumId, userId: a.userId, title: "A", createdAt: now, updatedAt: now });
    await getDb(env.DB).insert(albumMedia).values({ albumId, mediaId: inAlbum, addedAt: now });

    const own = await j(await get(a.cookie, `?albumId=${albumId}`));
    expect(own.items.map((i: { id: string }) => i.id)).toEqual([inAlbum]);

    const foreign = await j(await get(b.cookie, `?albumId=${albumId}`));
    expect(foreign.items).toHaveLength(0);
  });

  it("no mezcla datos de otro usuario", async () => {
    const a = await createUser();
    const b = await createUser();
    await seed(a.userId, "mine", Date.UTC(2026, 2, 1));
    const body = await j(await get(b.cookie));
    expect(body.items).toHaveLength(0);
  });

  it("rechaza un cursor inválido", async () => {
    const { cookie } = await createUser();
    expect((await get(cookie, "?cursor=%%%")).status).toBe(400);
  });
});
