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

  it("stats refleja count y bytes", async () => {
    const { cookie, userId } = await createUser();
    await seedOne(userId, false, 0);
    await seedOne(userId, false, 1);
    const res = await SELF.fetch("http://localhost/v1/stats", authed(cookie));
    const json = await j(res);
    expect(json.count).toBe(2);
    expect(json.totalBytes).toBe(4_000_000);
    expect(json.lastUploadAt).toBeTruthy();
  });
});
