import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { Bindings } from "../env";
import { parseTags } from "../routes/media";

export type GeoResult = {
  city: string | null;
  country: string | null;
  locationName: string | null;
};

// Caché en memoria por cuadrante (~1 km²) para no repetir consultas en lotes
const geoCache = new Map<string, GeoResult>();

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/**
 * Traduce coordenadas GPS a ciudad, país y nombre descriptivo en español.
 * Gratuito y sin claves de API: usa BigDataCloud client API con fallback a Nominatim.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeoResult> {
  const key = cacheKey(lat, lng);
  const cached = geoCache.get(key);
  if (cached) return cached;

  // Intento 1: BigDataCloud client reverse geocoding en español (rápido y sin api key)
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=es`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const city =
        (typeof data.city === "string" && data.city) ||
        (typeof data.locality === "string" && data.locality) ||
        (typeof data.principalSubdivision === "string" && data.principalSubdivision) ||
        null;
      const country = (typeof data.countryName === "string" && data.countryName) || null;

      let locationName: string | null = null;
      if (city && country) {
        locationName = city === country ? city : `${city}, ${country}`;
      } else if (city || country) {
        locationName = city || country;
      }

      if (locationName) {
        const result: GeoResult = { city, country, locationName };
        geoCache.set(key, result);
        return result;
      }
    }
  } catch (err) {
    console.warn("bigdatacloud_reverse_geocode_failed", err);
  }

  // Intento 2 (Fallback): OpenStreetMap Nominatim
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es`;
    const nomRes = await fetch(nomUrl, {
      headers: { "User-Agent": "PhotosApp/1.0 (self-hosted)" },
      signal: AbortSignal.timeout(3000),
    });
    if (nomRes.ok) {
      const data = (await nomRes.json()) as Record<string, unknown>;
      const addr = (data.address as Record<string, unknown> | undefined) || {};
      const city =
        (typeof addr.city === "string" && addr.city) ||
        (typeof addr.town === "string" && addr.town) ||
        (typeof addr.village === "string" && addr.village) ||
        (typeof addr.municipality === "string" && addr.municipality) ||
        (typeof addr.county === "string" && addr.county) ||
        null;
      const country = (typeof addr.country === "string" && addr.country) || null;

      let locationName: string | null = null;
      if (city && country) {
        locationName = city === country ? city : `${city}, ${country}`;
      } else if (city || country) {
        locationName = city || country;
      }

      if (locationName) {
        const result: GeoResult = { city, country, locationName };
        geoCache.set(key, result);
        return result;
      }
    }
  } catch (err) {
    console.warn("nominatim_reverse_geocode_failed", err);
  }

  return { city: null, country: null, locationName: null };
}

/**
 * Obtiene la ubicación de una foto y enriquece el registro en la base de datos,
 * agregando además la ciudad y país a las etiquetas para búsqueda instantánea.
 */
export async function geocodeMediaItem(
  env: Bindings,
  mediaId: string,
  userId: string,
  lat: number,
  lng: number,
): Promise<GeoResult> {
  const geo = await reverseGeocode(lat, lng);
  if (!geo.locationName) return geo;

  const db = getDb(env.DB);
  const row = await db
    .select({ id: media.id, tags: media.tags })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.userId, userId), isNull(media.deletedAt)))
    .get();

  if (!row) return geo;

  // Enriquecer etiquetas existentes con la ciudad y el país
  const existingTags = parseTags(row.tags);
  const placeTags: string[] = [];
  if (geo.city) placeTags.push(geo.city.toLowerCase().trim());
  if (geo.country) placeTags.push(geo.country.toLowerCase().trim());

  const mergedTags = Array.from(new Set([...existingTags, ...placeTags]));

  await db
    .update(media)
    .set({
      city: geo.city,
      country: geo.country,
      locationName: geo.locationName,
      tags: JSON.stringify(mergedTags),
      updatedAt: Date.now(),
    })
    .where(eq(media.id, mediaId));

  return geo;
}

// ---------- Bloque 7: geohash ----------

const BASE32_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(Math.abs(lat) < 0.00001 && Math.abs(lng) < 0.00001)
  );
}

export function encodeGeohash(lat: number, lng: number, precision = 9): string | null {
  if (!isValidCoordinate(lat, lng)) return null;
  const safePrecision = Math.max(1, Math.min(12, Math.floor(precision)));
  let minLat = -90.0,
    maxLat = 90.0,
    minLng = -180.0,
    maxLng = 180.0;
  let hash = "",
    isEvenBit = true,
    bit = 0,
    ch = 0;
  while (hash.length < safePrecision) {
    if (isEvenBit) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        minLng = mid;
      } else {
        ch = ch << 1;
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        minLat = mid;
      } else {
        ch = ch << 1;
        maxLat = mid;
      }
    }
    isEvenBit = !isEvenBit;
    bit += 1;
    if (bit === 5) {
      hash += BASE32_ALPHABET[ch]!;
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export function zoomToGeohashPrecision(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 4) return 2;
  if (zoom <= 7) return 3;
  if (zoom <= 10) return 4;
  if (zoom <= 13) return 5;
  if (zoom <= 15) return 6;
  return 7;
}
