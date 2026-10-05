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
    // content-type debe quedar firmado: sin esto un cliente podría subir con
    // un MIME distinto al declarado en uploads/init.
    unhoistableHeaders: new Set(["content-type"]),
  });
  cached = { key: cacheKey, client };
  return client;
}

export type PresignedTarget = { url: string; headers: Record<string, string> };

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
  const url = await getSignedUrl(getClient(env), command, { expiresIn });
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
  });
  // Fecha de firma redondeada a bloques de 6 h: la URL no cambia dentro de la
  // ventana, así que las caches (expo-image, CDN) pueden reutilizarla.
  const windowMs = PRESIGN_GET_WINDOW_SECONDS * 1000;
  const signingDate = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  return getSignedUrl(getClient(env), command, {
    expiresIn: PRESIGN_GET_TTL_SECONDS,
    signingDate,
  });
}
