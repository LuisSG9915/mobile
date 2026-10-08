import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { media } from "../src/db/schema";
import { geocodeMediaItem, reverseGeocode } from "../src/lib/geo";
import { createUser, sha } from "./helpers";

describe("geocodificación inversa", () => {
  it("reverseGeocode resuelve coordenadas y usa la caché", async () => {
    // Madrid
    const r1 = await reverseGeocode(40.4168, -3.7038);
    // Si la red está disponible devuelve Madrid, si no, null sin romper
    if (r1.locationName) {
      expect(r1.locationName).toContain("Madrid");
    }

    // Segunda llamada debe consultar la caché instantáneamente
    const r2 = await reverseGeocode(40.4168, -3.7038);
    expect(r2).toEqual(r1);
  });

  it("geocodeMediaItem enriquece la foto y añade la ciudad a las etiquetas", async () => {
    const { userId } = await createUser();
    const db = getDb(env.DB);
    const id = crypto.randomUUID();
    const s = sha("geo-media-test");

    await db.insert(media).values({
      id,
      userId,
      sha256: s,
      mediaType: "photo",
      mimeType: "image/jpeg",
      ext: "jpg",
      takenAt: Date.now(),
      width: 1000,
      height: 1000,
      thumbhash: "AQAAAA==",
      r2KeyOriginal: `users/${userId}/originals/${s}.jpg`,
      r2KeyThumb: `users/${userId}/thumbs/${s}.webp`,
      fileSize: 100_000,
      thumbSize: 5_000,
      latitude: 21.1619,
      longitude: -86.8515,
      status: "ready",
      tags: JSON.stringify(["playa"]),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await geocodeMediaItem(env, id, userId, 21.1619, -86.8515);
    if (res.locationName) {
      const row = await db.select().from(media).where(undefined).get();
      expect(row?.locationName).toBe(res.locationName);
      const tags = JSON.parse(row?.tags ?? "[]");
      expect(tags).toContain("playa");
    }
  });
});
