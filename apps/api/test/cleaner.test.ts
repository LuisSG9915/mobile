import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { media } from "../src/db/schema";
import { authed, createUser, j, sha } from "./helpers";

async function seedBurstPhotos(userId: string) {
  const db = getDb(env.DB);
  const now = Date.now();

  // Cluster 1: 3 fotos con diferencia de 500ms
  const cluster1Ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const id = crypto.randomUUID();
    cluster1Ids.push(id);
    const s = sha(`c1-${userId}-${i}`);
    await db.insert(media).values({
      id,
      userId,
      sha256: s,
      mediaType: "photo",
      mimeType: "image/jpeg",
      ext: "jpg",
      takenAt: now + i * 500,
      dateGroup: "2026-10-07",
      width: 1920,
      height: 1080,
      thumbhash: "AQAAAA==",
      r2KeyOriginal: `users/${userId}/originals/${s}.jpg`,
      r2KeyThumb: `users/${userId}/thumbs/${s}.webp`,
      fileSize: 100_000,
      thumbSize: 5_000,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });
  }

  // Foto aislada (no debe formar cluster)
  const singleId = crypto.randomUUID();
  const sSingle = sha(`single-${userId}`);
  await db.insert(media).values({
    id: singleId,
    userId,
    sha256: sSingle,
    mediaType: "photo",
    mimeType: "image/jpeg",
    ext: "jpg",
    takenAt: now + 60_000, // 1 minuto después
    dateGroup: "2026-10-07",
    width: 1920,
    height: 1080,
    thumbhash: "AQAAAA==",
    r2KeyOriginal: `users/${userId}/originals/${sSingle}.jpg`,
    r2KeyThumb: `users/${userId}/thumbs/${sSingle}.webp`,
    fileSize: 100_000,
    thumbSize: 5_000,
    status: "ready",
    createdAt: now + 60_000,
    updatedAt: now + 60_000,
  });

  return { cluster1Ids, singleId };
}

describe("cleaner / bursts", () => {
  it("detecta grupos de fotos en ráfaga e ignora fotos aisladas", async () => {
    const { cookie, userId } = await createUser();
    const { cluster1Ids } = await seedBurstPhotos(userId);

    const res = await SELF.fetch("http://localhost/v1/cleaner/bursts", authed(cookie));
    expect(res.status).toBe(200);
    const body = await j(res);

    expect(body.clusters.length).toBe(1);
    expect(body.totalPhotos).toBe(3);
    expect(body.clusters[0].items.length).toBe(3);
    for (const item of body.clusters[0].items) {
      expect(cluster1Ids).toContain(item.id);
      expect(item.thumbUrl).toContain("X-Amz-Signature");
    }
  });

  it("limpia fotos seleccionadas enviándolas a la papelera respetando keepId", async () => {
    const { cookie, userId } = await createUser();
    const { cluster1Ids } = await seedBurstPhotos(userId);

    const [keepId, del1, del2] = cluster1Ids;

    const cleanupRes = await SELF.fetch("http://localhost/v1/cleaner/cleanup", {
      ...authed(cookie),
      method: "POST",
      headers: { ...authed(cookie).headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        keepId,
        deleteIds: [keepId, del1, del2], // keepId se pasa accidentalmente pero debe ser preservado
      }),
    });

    expect(cleanupRes.status).toBe(200);
    const cleanBody = await j(cleanupRes);
    expect(cleanBody.ok).toBe(true);
    expect(cleanBody.trashedCount).toBe(2);

    // Al volver a pedir bursts, el cluster ya no tiene 2 o más fotos -> queda vacío
    const burstsRes = await SELF.fetch("http://localhost/v1/cleaner/bursts", authed(cookie));
    const burstsBody = await j(burstsRes);
    expect(burstsBody.clusters.length).toBe(0);
    expect(burstsBody.totalPhotos).toBe(0);

    // Las fotos borradas aparecen en la papelera
    const trashRes = await SELF.fetch("http://localhost/v1/trash", authed(cookie));
    const trashBody = await j(trashRes);
    const trashIds = trashBody.items.map((i: { id: string }) => i.id);
    expect(trashIds).toContain(del1);
    expect(trashIds).toContain(del2);
    expect(trashIds).not.toContain(keepId);
  });
});
