import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { media } from "../src/db/schema";
import { authed, createUser, j, sha } from "./helpers";

async function seedTestMedia(userId: string): Promise<string[]> {
  const db = getDb(env.DB);
  const ids: string[] = [];
  const base = Date.now();

  // Foto 1: 500 KB, 2026-08-15
  const id1 = crypto.randomUUID();
  ids.push(id1);
  const s1 = sha(`${userId}-1`);
  await db.insert(media).values({
    id: id1,
    userId,
    sha256: s1,
    mediaType: "photo",
    mimeType: "image/jpeg",
    ext: "jpg",
    takenAt: base,
    dateGroup: "2026-08-15",
    width: 1920,
    height: 1080,
    thumbhash: "AQAAAA==",
    r2KeyOriginal: `users/${userId}/originals/${s1}.jpg`,
    r2KeyThumb: `users/${userId}/thumbs/${s1}.webp`,
    fileSize: 500_000,
    thumbSize: 10_000,
    status: "ready",
    caption: "Tarde soleada en la playa de Cancún",
    tags: JSON.stringify(["playa", "vacaciones", "familia"]),
    createdAt: base,
    updatedAt: base,
  });

  // Foto 2: 2 MB, 2026-01-10
  const id2 = crypto.randomUUID();
  ids.push(id2);
  const s2 = sha(`${userId}-2`);
  await db.insert(media).values({
    id: id2,
    userId,
    sha256: s2,
    mediaType: "photo",
    mimeType: "image/jpeg",
    ext: "jpg",
    takenAt: base + 1000,
    dateGroup: "2026-01-10",
    width: 3840,
    height: 2160,
    thumbhash: "AQAAAA==",
    r2KeyOriginal: `users/${userId}/originals/${s2}.jpg`,
    r2KeyThumb: `users/${userId}/thumbs/${s2}.webp`,
    fileSize: 2_000_000,
    thumbSize: 15_000,
    status: "ready",
    caption: "Cumpleaños en el parque de la ciudad",
    tags: JSON.stringify(["familia", "fiesta"]),
    createdAt: base + 1000,
    updatedAt: base + 1000,
  });

  // Video: 25 MB, 2025-12-31
  const id3 = crypto.randomUUID();
  ids.push(id3);
  const s3 = sha(`${userId}-3`);
  await db.insert(media).values({
    id: id3,
    userId,
    sha256: s3,
    mediaType: "video",
    mimeType: "video/mp4",
    ext: "mp4",
    takenAt: base + 2000,
    dateGroup: "2025-12-31",
    width: 1920,
    height: 1080,
    durationMs: 45_000,
    thumbhash: "AQAAAA==",
    r2KeyOriginal: `users/${userId}/originals/${s3}.mp4`,
    r2KeyThumb: `users/${userId}/thumbs/${s3}.webp`,
    fileSize: 25_000_000,
    thumbSize: 12_000,
    status: "ready",
    caption: "Fuegos artificiales de año nuevo",
    tags: JSON.stringify(["fiesta", "año nuevo"]),
    createdAt: base + 2000,
    updatedAt: base + 2000,
  });

  return ids;
}

describe("búsqueda y filtros avanzados", () => {
  it("edita caption y tags con PATCH /media/:id", async () => {
    const { cookie, userId } = await createUser();
    const [mediaId] = await seedTestMedia(userId);

    const patchRes = await SELF.fetch(`http://localhost/v1/media/${mediaId}`, {
      ...authed(cookie),
      method: "PATCH",
      headers: { ...authed(cookie).headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        caption: "Nueva descripción editada",
        tags: ["viajes", "verano"],
      }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await j(patchRes);
    expect(patched.caption).toBe("Nueva descripción editada");
    expect(patched.tags).toEqual(["viajes", "verano"]);

    // Verificar con GET /media/:id
    const getRes = await SELF.fetch(`http://localhost/v1/media/${mediaId}`, authed(cookie));
    expect(getRes.status).toBe(200);
    const detail = await j(getRes);
    expect(detail.caption).toBe("Nueva descripción editada");
    expect(detail.tags).toEqual(["viajes", "verano"]);
  });

  it("lista etiquetas agrupadas y su conteo con GET /v1/tags", async () => {
    const { cookie, userId } = await createUser();
    await seedTestMedia(userId);

    const tagsRes = await SELF.fetch("http://localhost/v1/tags", authed(cookie));
    expect(tagsRes.status).toBe(200);
    const tagsJson = await j(tagsRes);
    expect(tagsJson.tags.length).toBeGreaterThan(0);

    // "familia" y "fiesta" aparecen 2 veces, "playa" 1 vez
    const familiaTag = tagsJson.tags.find(
      (t: { tag: string; count: number }) => t.tag === "familia",
    );
    expect(familiaTag).toBeDefined();
    expect(familiaTag.count).toBe(2);
  });

  it("busca por texto libre (q)", async () => {
    const { cookie, userId } = await createUser();
    await seedTestMedia(userId);

    // Buscar "cancún" (está en el caption de la foto 1)
    const res1 = await SELF.fetch("http://localhost/v1/search?q=cancún", authed(cookie));
    expect(res1.status).toBe(200);
    const json1 = await j(res1);
    expect(json1.totalMatches).toBe(1);
    expect(json1.items.length).toBe(1);

    // Buscar "fuegos" (caption del video)
    const res2 = await SELF.fetch("http://localhost/v1/search?q=fuegos", authed(cookie));
    expect(res2.status).toBe(200);
    const json2 = await j(res2);
    expect(json2.totalMatches).toBe(1);
    expect(json2.items[0].mediaType).toBe("video");

    // Buscar palabra inexistente
    const res3 = await SELF.fetch("http://localhost/v1/search?q=inexistente", authed(cookie));
    expect(res3.status).toBe(200);
    const json3 = await j(res3);
    expect(json3.totalMatches).toBe(0);
    expect(json3.items.length).toBe(0);
  });

  it("filtra por etiqueta (tag)", async () => {
    const { cookie, userId } = await createUser();
    await seedTestMedia(userId);

    // Tag "fiesta" (foto 2 y video)
    const res = await SELF.fetch("http://localhost/v1/search?tag=fiesta", authed(cookie));
    expect(res.status).toBe(200);
    const json = await j(res);
    expect(json.totalMatches).toBe(2);
  });

  it("filtra por tipo de medio y rango de fechas", async () => {
    const { cookie, userId } = await createUser();
    await seedTestMedia(userId);

    // Solo videos
    const videoRes = await SELF.fetch("http://localhost/v1/search?filter=videos", authed(cookie));
    expect(videoRes.status).toBe(200);
    const videoJson = await j(videoRes);
    expect(videoJson.totalMatches).toBe(1);
    expect(videoJson.items[0].mediaType).toBe("video");

    // Rango de fechas: 2026-01-01 a 2026-12-31 (debe excluir el video de 2025)
    const dateRes = await SELF.fetch(
      "http://localhost/v1/search?dateFrom=2026-01-01&dateTo=2026-12-31",
      authed(cookie),
    );
    expect(dateRes.status).toBe(200);
    const dateJson = await j(dateRes);
    expect(dateJson.totalMatches).toBe(2);
  });

  it("filtra por tamaño de archivo", async () => {
    const { cookie, userId } = await createUser();
    await seedTestMedia(userId);

    // Archivos > 10 MB (solo el video de 25 MB)
    const heavyRes = await SELF.fetch(
      "http://localhost/v1/search?minBytes=10000000",
      authed(cookie),
    );
    expect(heavyRes.status).toBe(200);
    const heavyJson = await j(heavyRes);
    expect(heavyJson.totalMatches).toBe(1);
    expect(heavyJson.items[0].mediaType).toBe("video");
  });

  it("filtra por capturas y documentos", async () => {
    const { cookie, userId } = await createUser();
    const [id1, id2] = await seedTestMedia(userId);
    const db = getDb(env.DB);
    await db.update(media).set({ isScreenshot: true }).where(eq(media.id, id1));
    await db.update(media).set({ isDocument: true }).where(eq(media.id, id2));

    const screenRes = await SELF.fetch(
      "http://localhost/v1/search?filter=screenshots",
      authed(cookie),
    );
    expect(screenRes.status).toBe(200);
    const screenJson = await j(screenRes);
    expect(screenJson.totalMatches).toBe(1);
    expect(screenJson.items[0].id).toBe(id1);
    expect(screenJson.items[0].isScreenshot).toBe(true);

    const docRes = await SELF.fetch("http://localhost/v1/search?filter=documents", authed(cookie));
    expect(docRes.status).toBe(200);
    const docJson = await j(docRes);
    expect(docJson.totalMatches).toBe(1);
    expect(docJson.items[0].id).toBe(id2);
    expect(docJson.items[0].isDocument).toBe(true);
  });
});
