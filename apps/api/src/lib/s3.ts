import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PRESIGN_GET_TTL_SECONDS, PRESIGN_GET_WINDOW_SECONDS } from "@photos/shared";
import type { Bindings } from "../env";

let cached: { key: string; client: S3Client } | null = null;

function getClient(env: Bindings): S3Client {
  const cacheKey = env.R2_ACCOUNT_ID;
  if (cached?.key === cacheKey) return cached.client;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    // IMPORTANTE: el SDK v3 agrega checksums CRC32 por defecto que R2 no acepta
    // en PUT prefirmados. Se limitan a cuando el servicio los exige.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  cached = { key: cacheKey, client };
  return client;
}

export type PresignedTarget = { url: string; headers: Record<string, string> };

// Las claves R2 van direccionadas por sha256: el contenido nunca cambia bajo
// la misma clave, así que cualquier caché (CDN, navegador, expo-image) puede
// tratar la respuesta como inmutable.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

// Ventana de firma reutilizada por todas las lecturas GET (ver presignGet).
const getSigningDate = () => {
  const windowMs = PRESIGN_GET_WINDOW_SECONDS * 1000;
  return new Date(Math.floor(Date.now() / windowMs) * windowMs);
};

export async function presignPut(
  env: Bindings,
  key: string,
  contentType: string,
  contentLength: number,
): Promise<PresignedTarget> {
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  const expiresIn = Number(env.PRESIGN_TTL_SECONDS) || 900;
  const url = await getSignedUrl(getClient(env), command, {
    expiresIn,
    // content-type debe quedar firmado: sin esto un cliente podría subir con
    // un MIME distinto al declarado en uploads/init. Esta opción va en el
    // presign (no en el S3Client).
    unhoistableHeaders: new Set(["content-type"]),
  });
  return {
    url,
    headers: {
      "content-type": contentType,
      "content-length": String(contentLength),
    },
  };
}

export async function presignGet(env: Bindings, key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ResponseCacheControl: IMMUTABLE_CACHE_CONTROL,
  });
  // Fecha de firma redondeada a bloques de 6 h: la URL no cambia dentro de la
  // ventana, así que las caches (expo-image, CDN) pueden reutilizarla.
  return getSignedUrl(getClient(env), command, {
    expiresIn: PRESIGN_GET_TTL_SECONDS,
    signingDate: getSigningDate(),
  });
}

/**
 * GET prefirmado para descarga: fuerza `Content-Disposition: attachment` con
 * un nombre de archivo legible en la respuesta de R2.
 */
export async function presignGetDownload(
  env: Bindings,
  key: string,
  filename: string,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ResponseCacheControl: IMMUTABLE_CACHE_CONTROL,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
  });
  return getSignedUrl(getClient(env), command, {
    expiresIn: PRESIGN_GET_TTL_SECONDS,
    signingDate: getSigningDate(),
  });
}
