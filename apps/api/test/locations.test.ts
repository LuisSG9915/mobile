import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { media } from "../src/db/schema";
import { authed, createUser, j, sha } from "./helpers";

async function seedLocationMedia(userId: string): Promise<void> {
  const db = getDb(env.DB);
  const base = Date.now();

  // 1. Cancún: lat 21.1619, lng -86.8515 (Foto)
  const id1 = crypto.randomUUID();
  const s1 = sha(`${userId}-loc-1`);
  await db.insert(media).values({
    id: id1,
    userId,
    sha256: s1,
    mediaType: "photo",
    mimeType: "image/jpeg",
    ext: "jpg",
    takenAt: base,
    dateGroup: "2026-06-10",
    latitude: 21.1619,
    longitude: -86.8515,
    width: 1920,
    height: 1080,
    thumbhash: "AQAAAA==",
    r2KeyOriginal: `users/${userId}/originals/${s1}.jpg`,
    r2KeyThumb: `users/${userId}/thumbs/${s1}.webp`,
    fileSize: 400_000,
    thumbSize: 10_000,
    status: "ready",
    caption: "Playa en Cancún",
    city: "Cancún",
    country: "México",
    locationName: "Cancún, México",
    createdAt: base,
    updatedAt: base,
  });

  // 2. CDMX: lat 19.4326, lng -99.1332 (Foto)
  const id2 = crypto.randomUUID();
  const s2 = sha(`${userId}-loc-2`);
  await db.insert(media).values({
    id: id2,
    userId,
    sha256: s2,
    mediaType: "photo",
    mimeType: "image/jpeg",
    ext: "jpg",
    takenAt: base + 1000,
    dateGroup: "2026-05-15",
    latitude: 19.4326,
    longitude: -99.1332,
    width: 1920,
    height: 1080,
    thumbhash: "AQAAAA==",
    r2KeyOriginal: `users/${userId}/originals/${s2}.jpg`,
    r2KeyThumb: `users/${userId}/thumbs/${s2}.webp`,
    fileSize: 500_000,
    thumbSize: 10_000,
    status: "ready",
    caption: "Centro Histórico CDMX",
    createdAt: base + 1000,
    updatedAt: base + 1000,
  });

  // 3. Sin GPS (Foto)
  const id3 = crypto.randomUUID();
  const s3 = sha(`${userId}-loc-3`);
  await db.insert(media).values({
    id: id3,
    userId,
    sha256: s3,
    mediaType: "photo",
    mimeType: "image/jpeg",
    ext: "jpg",
    takenAt: base + 2000,
    dateGroup: "2026-04-01",
    latitude: null,
    longitude: null,
    width: 1920,
    height: 1080,
    thumbhash: "AQAAAA==",
    r2KeyOriginal: `users/${userId}/originals/${s3}.jpg`,
    r2KeyThumb: `users/${userId}/thumbs/${s3}.webp`,
    fileSize: 300_000,
    thumbSize: 10_000,
    status: "ready",
    createdAt: base + 2000,
    updatedAt: base + 2000,
  });

  // 4. Madrid: lat 40.4168, lng -3.7038 (Video)
  const id4 = crypto.randomUUID();
  const s4 = sha(`${userId}-loc-4`);
  await db.insert(media).values({
    id: id4,
    userId,
    sha256: s4,
    mediaType: "video",
    mimeType: "video/mp4",
    ext: "mp4",
    takenAt: base + 3000,
    dateGroup: "2026-03-20",
    latitude: 40.4168,
    longitude: -3.7038,
    durationMs: 30_000,
    width: 1920,
    height: 1080,
    thumbhash: "AQAAAA==",
    r2KeyOriginal: `users/${userId}/originals/${s4}.mp4`,
    r2KeyThumb: `users/${userId}/thumbs/${s4}.webp`,
    fileSize: 15_000_000,
    thumbSize: 12_000,
    status: "ready",
    caption: "Plaza Mayor Madrid",
    createdAt: base + 3000,
    updatedAt: base + 3000,
  });
}

describe("rutas de ubicación y mapa (locations)", () => {
  it("requiere autenticación para listar ubicaciones", async () => {
    const res = await SELF.fetch("http://localhost/v1/locations");
    expect(res.status).toBe(401);
  });

  it("devuelve solo elementos con coordenadas GPS del usuario", async () => {
    const { cookie, userId } = await createUser();
    await seedLocationMedia(userId);

    const res = await SELF.fetch("http://localhost/v1/locations", authed(cookie));
    expect(res.status).toBe(200);
    const data = await j(res);
    expect(data.totalWithGps).toBe(3);
    expect(data.items.length).toBe(3);

    // Debe contener las fotos de Cancún, CDMX y video de Madrid, pero no la que no tiene GPS
    const lats = data.items.map((i: { latitude: number }) => i.latitude);
    expect(lats).toContain(21.1619);
    expect(lats).toContain(19.4326);
    expect(lats).toContain(40.4168);
  });

  it("filtra por tipo (solo fotos)", async () => {
    const { cookie, userId } = await createUser();
    await seedLocationMedia(userId);

    const res = await SELF.fetch("http://localhost/v1/locations?filter=photos", authed(cookie));
    expect(res.status).toBe(200);
    const data = await j(res);
    expect(data.totalWithGps).toBe(2);
    expect(data.items.every((i: { mediaType: string }) => i.mediaType === "photo")).toBe(true);
  });

  it("filtra por caja delimitadora (bounding box)", async () => {
    const { cookie, userId } = await createUser();
    await seedLocationMedia(userId);

    // Bounding box en la península de Yucatán (alrededor de Cancún)
    const res = await SELF.fetch(
      "http://localhost/v1/locations?minLat=20&maxLat=22&minLng=-88&maxLng=-85",
      authed(cookie),
    );
    expect(res.status).toBe(200);
    const data = await j(res);
    expect(data.totalWithGps).toBe(1);
    expect(data.items[0].caption).toBe("Playa en Cancún");
  });

  it("GET /v1/locations/places agrupa fotos por ciudad con conteo", async () => {
    const { cookie, userId } = await createUser();
    await seedLocationMedia(userId);

    const res = await SELF.fetch("http://localhost/v1/locations/places", authed(cookie));
    expect(res.status).toBe(200);
    const data = await j(res);
    expect(Array.isArray(data.places)).toBe(true);
    expect(data.places.length).toBeGreaterThanOrEqual(1);
    const cancun = data.places.find((p: { city: string }) => p.city === "Cancún");
    expect(cancun).toBeDefined();
    expect(cancun.country).toBe("México");
    expect(cancun.count).toBe(1);
  });

  it("POST /v1/locations/geocode-batch procesa fotos pendientes de geocodificación", async () => {
    const { cookie, userId } = await createUser();
    await seedLocationMedia(userId);

    const res = await SELF.fetch(
      "http://localhost/v1/locations/geocode-batch",
      authed(cookie, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const data = await j(res);
    expect(typeof data.geocoded).toBe("number");
  });
});
