import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { media } from "../src/db/schema";
import { authed, createUser, j, sha } from "./helpers";

async function seedOne(userId: string, deleted = false, n = 0) {
  const db = getDb(env.DB);
  const s = sha(`${userId.slice(0, 6)}m${n}`);
  const id = crypto.randomUUID();
  await db.insert(media).values({
    id,
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
    fileSize: 2_000_000,
    thumbSize: 9_000,
    status: "ready",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: deleted ? Date.now() : null,
  });
  return id;
}

describe("media", () => {
  it("detalle incluye originalUrl prefirmada", async () => {
    const { cookie, userId } = await createUser();
    const id = await seedOne(userId);
    const res = await SELF.fetch(`http://localhost/v1/media/${id}`, authed(cookie));
    expect(res.status).toBe(200);
    const json = await j(res);
    expect(json.originalUrl).toContain("X-Amz-Signature");
    expect(json.fileSize).toBe(2_000_000);
  });

  it("delete → papelera; ya no sale en timeline; sí en /trash; restore lo recupera", async () => {
    const { cookie, userId } = await createUser();
    const id = await seedOne(userId);

    const del = await SELF.fetch(`http://localhost/v1/media/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(200);

    const tl = await SELF.fetch("http://localhost/v1/timeline", authed(cookie));
    expect((await j(tl)).items.length).toBe(0);

    const trash = await SELF.fetch("http://localhost/v1/trash", authed(cookie));
    const trashJson = await j(trash);
    expect(trashJson.items.length).toBe(1);
    expect(trashJson.items[0].id).toBe(id);
    // La papelera expone deletedAt para que la UI calcule los días restantes.
    expect(trashJson.items[0].deletedAt).toBeGreaterThan(0);

    const restore = await SELF.fetch(`http://localhost/v1/media/${id}/restore`, {
      method: "POST",
      headers: { cookie },
    });
    expect(restore.status).toBe(200);

    const tl2 = await SELF.fetch("http://localhost/v1/timeline", authed(cookie));
    expect((await j(tl2)).items.length).toBe(1);
  });

  it("download devuelve URL prefirmada con attachment y caché inmutable", async () => {
    const { cookie, userId } = await createUser();
    const id = await seedOne(userId);
    const res = await SELF.fetch(`http://localhost/v1/media/${id}/download`, authed(cookie));
    expect(res.status).toBe(200);
    const json = await j(res);
    expect(json.filename).toMatch(/^IMG-.{16}\.jpg$/);
    const url = decodeURIComponent(json.url);
    expect(url).toContain("response-content-disposition=attachment");
    expect(url).toContain(`filename="${json.filename}"`);
    expect(url).toContain("response-cache-control=public, max-age=31536000, immutable");
    expect(json.url).toContain("X-Amz-Signature");
  });

  it("download de elemento ajeno o en papelera → 404; sin sesión → 401", async () => {
    const a = await createUser();
    const b = await createUser();
    const foreign = await seedOne(a.userId);
    const trashed = await seedOne(a.userId, true, 1);

    const anon = await SELF.fetch(`http://localhost/v1/media/${foreign}/download`);
    expect(anon.status).toBe(401);

    const res = await SELF.fetch(`http://localhost/v1/media/${foreign}/download`, authed(b.cookie));
    expect(res.status).toBe(404);
    const res2 = await SELF.fetch(
      `http://localhost/v1/media/${trashed}/download`,
      authed(a.cookie),
    );
    expect(res2.status).toBe(404);
  });

  it("detalle/borrado de elemento ajeno → 404", async () => {
    const a = await createUser();
    const b = await createUser();
    const id = await seedOne(a.userId);
    const res = await SELF.fetch(`http://localhost/v1/media/${id}`, authed(b.cookie));
    expect(res.status).toBe(404);
    const del = await SELF.fetch(`http://localhost/v1/media/${id}`, {
      method: "DELETE",
      headers: { cookie: b.cookie },
    });
    expect(del.status).toBe(404);
  });

  it("favorite alterna is_favorite y se refleja en detalle y timeline", async () => {
    const { cookie, userId } = await createUser();
    const id = await seedOne(userId);

    const res = await SELF.fetch(`http://localhost/v1/media/${id}/favorite`, {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect((await j(res)).isFavorite).toBe(true);

    const det = await SELF.fetch(`http://localhost/v1/media/${id}`, authed(cookie));
    expect((await j(det)).isFavorite).toBe(true);

    const res2 = await SELF.fetch(`http://localhost/v1/media/${id}/favorite`, {
      method: "POST",
      headers: { cookie },
    });
    expect((await j(res2)).isFavorite).toBe(false);

    const tl = await SELF.fetch("http://localhost/v1/timeline", authed(cookie));
    expect((await j(tl)).items[0].isFavorite).toBe(false);
  });

  it("favorite de elemento ajeno o en papelera → 404; sin sesión → 401", async () => {
    const a = await createUser();
    const b = await createUser();
    const foreign = await seedOne(a.userId);
    const trashed = await seedOne(a.userId, true, 1);

    const anon = await SELF.fetch(`http://localhost/v1/media/${foreign}/favorite`, {
      method: "POST",
    });
    expect(anon.status).toBe(401);

    const res = await SELF.fetch(`http://localhost/v1/media/${foreign}/favorite`, {
      method: "POST",
      headers: { cookie: b.cookie },
    });
    expect(res.status).toBe(404);
    const res2 = await SELF.fetch(`http://localhost/v1/media/${trashed}/favorite`, {
      method: "POST",
      headers: { cookie: a.cookie },
    });
    expect(res2.status).toBe(404);
  });

  it("stats refleja count y bytes", async () => {
    const { cookie, userId } = await createUser();
    await seedOne(userId, false, 0);
    await seedOne(userId, false, 1);
    const res = await SELF.fetch("http://localhost/v1/stats", authed(cookie));
    const json = await j(res);
    expect(json.count).toBe(2);
    expect(json.totalBytes).toBe(4_000_000);
    expect(json.lastUploadAt).toBeTruthy();
    expect(json.quotaBytes).toBeGreaterThan(0);
  });
});
