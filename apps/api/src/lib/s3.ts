import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
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

const presignGetCache = new Map<string, string>();
const MAX_PRESIGN_CACHE_SIZE = 2000;

export function clearPresignCacheForTests(): void {
  presignGetCache.clear();
}

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
  const windowMs = PRESIGN_GET_WINDOW_SECONDS * 1000;
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const cacheKey = `${env.R2_BUCKET_NAME}:${windowStart}:${key}`;

  const cachedUrl = presignGetCache.get(cacheKey);
  if (cachedUrl) {
    presignGetCache.delete(cacheKey);
    presignGetCache.set(cacheKey, cachedUrl);
    return cachedUrl;
  }

  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ResponseCacheControl: IMMUTABLE_CACHE_CONTROL,
  });
  // Fecha de firma redondeada a bloques de 6 h: la URL no cambia dentro de la
  // ventana, así que las caches (expo-image, CDN) pueden reutilizarla.
  const url = await getSignedUrl(getClient(env), command, {
    expiresIn: PRESIGN_GET_TTL_SECONDS,
    signingDate: new Date(windowStart),
  });

  if (presignGetCache.size >= MAX_PRESIGN_CACHE_SIZE) {
    const oldestKey = presignGetCache.keys().next().value;
    if (oldestKey !== undefined) {
      presignGetCache.delete(oldestKey);
    }
  }
  presignGetCache.set(cacheKey, url);

  return url;
}

/**
 * GET prefirmado con TTL ajustado. Lo usan los enlaces públicos para que sus
 * URLs no sobrevivan a la caducidad del enlace. Sin caché: el TTL es variable.
 */
export async function presignGetWithTtl(
  env: Bindings,
  key: string,
  ttlSeconds?: number,
): Promise<string> {
  if (ttlSeconds == null) return presignGet(env, key);
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ResponseCacheControl: IMMUTABLE_CACHE_CONTROL,
  });
  return getSignedUrl(getClient(env), command, { expiresIn: Math.max(1, ttlSeconds) });
}

/**
 * GET prefirmado para descarga: fuerza `Content-Disposition: attachment` con
 * un nombre de archivo legible en la respuesta de R2.
 */
export async function presignGetDownload(
  env: Bindings,
  key: string,
  filename: string,
  ttlSeconds?: number,
): Promise<string> {
  if (ttlSeconds != null) {
    const command = new GetObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      ResponseCacheControl: IMMUTABLE_CACHE_CONTROL,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
    });
    return getSignedUrl(getClient(env), command, { expiresIn: Math.max(1, ttlSeconds) });
  }
  const windowMs = PRESIGN_GET_WINDOW_SECONDS * 1000;
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const cacheKey = `${env.R2_BUCKET_NAME}:${windowStart}:${key}:dl:${filename}`;

  const cachedUrl = presignGetCache.get(cacheKey);
  if (cachedUrl) {
    presignGetCache.delete(cacheKey);
    presignGetCache.set(cacheKey, cachedUrl);
    return cachedUrl;
  }

  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ResponseCacheControl: IMMUTABLE_CACHE_CONTROL,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
  });
  const url = await getSignedUrl(getClient(env), command, {
    expiresIn: PRESIGN_GET_TTL_SECONDS,
    signingDate: new Date(windowStart),
  });

  if (presignGetCache.size >= MAX_PRESIGN_CACHE_SIZE) {
    const oldestKey = presignGetCache.keys().next().value;
    if (oldestKey !== undefined) {
      presignGetCache.delete(oldestKey);
    }
  }
  presignGetCache.set(cacheKey, url);

  return url;
}

export type MultipartPartInfo = {
  partNumber: number;
  etag: string;
};

/**
 * Inicia una subida multipart para archivos grandes. Prefiere el binding R2 nativo
 * si está disponible (entorno Cloudflare/Miniflare) o recurre a la API S3.
 */
export async function createMultipartUpload(
  env: Bindings,
  key: string,
  contentType: string,
): Promise<string> {
  if (env.BUCKET && typeof env.BUCKET.createMultipartUpload === "function") {
    try {
      const mpu = await env.BUCKET.createMultipartUpload(key, {
        httpMetadata: { contentType },
      });
      return mpu.uploadId;
    } catch {
      // Continuar con S3Client
    }
  }
  const command = new CreateMultipartUploadCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  const res = await getClient(env).send(command);
  if (!res.UploadId) throw new Error("No se pudo iniciar la subida multipart");
  return res.UploadId;
}

/**
 * Genera una URL prefirmada para subir una parte individual (PUT).
 */
export async function presignUploadPart(
  env: Bindings,
  key: string,
  uploadId: string,
  partNumber: number,
): Promise<string> {
  const command = new UploadPartCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  const expiresIn = Number(env.PRESIGN_TTL_SECONDS) || 900;
  return getSignedUrl(getClient(env), command, { expiresIn });
}

/**
 * Finaliza la subida multipart ensamblando todas las partes cargadas.
 */
export async function completeMultipartUpload(
  env: Bindings,
  key: string,
  uploadId: string,
  parts: MultipartPartInfo[],
): Promise<void> {
  const sorted = parts.slice().sort((a, b) => a.partNumber - b.partNumber);
  if (env.BUCKET && typeof env.BUCKET.resumeMultipartUpload === "function") {
    try {
      const mpu = env.BUCKET.resumeMultipartUpload(key, uploadId);
      await mpu.complete(
        sorted.map((p) => ({
          partNumber: p.partNumber,
          etag: p.etag.replace(/"/g, ""),
        })),
      );
      return;
    } catch {
      // Continuar con S3Client
    }
  }
  const command = new CompleteMultipartUploadCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: sorted.map((p) => ({
        PartNumber: p.partNumber,
        ETag: p.etag.startsWith('"') ? p.etag : `"${p.etag}"`,
      })),
    },
  });
  await getClient(env).send(command);
}

/**
 * Aborta la subida multipart y descarta los fragmentos almacenados.
 */
export async function abortMultipartUpload(
  env: Bindings,
  key: string,
  uploadId: string,
): Promise<void> {
  if (env.BUCKET && typeof env.BUCKET.resumeMultipartUpload === "function") {
    try {
      const mpu = env.BUCKET.resumeMultipartUpload(key, uploadId);
      await mpu.abort();
      return;
    } catch {
      // Continuar con S3Client
    }
  }
  const command = new AbortMultipartUploadCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
  });
  await getClient(env).send(command);
}

/**
 * Purga subidas multipart incompletas que lleven más de `maxAgeMs` (por defecto 24 horas).
 * R2 cobra el almacenamiento de los fragmentos cargados hasta que la subida se completa o aborta.
 */
export async function abortStaleMultipartUploads(
  env: Bindings,
  maxAgeMs = 24 * 3600 * 1000,
): Promise<number> {
  if (
    !env.R2_ACCOUNT_ID ||
    env.R2_ACCOUNT_ID === "test-account" ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY ||
    !env.R2_BUCKET_NAME
  ) {
    return 0;
  }
  try {
    const client = getClient(env);
    let aborted = 0;
    const now = Date.now();
    // ListMultipartUploads devuelve como máximo 1.000 entradas: sin paginar,
    // las MPUs que caen en la segunda página nunca se abortarían.
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await client.send(
        new ListMultipartUploadsCommand({
          Bucket: env.R2_BUCKET_NAME,
          KeyMarker: keyMarker,
          UploadIdMarker: uploadIdMarker,
        }),
      );
      for (const upload of res.Uploads ?? []) {
        if (!upload.Key || !upload.UploadId || !upload.Initiated) continue;
        if (now - upload.Initiated.getTime() <= maxAgeMs) continue;
        try {
          await client.send(
            new AbortMultipartUploadCommand({
              Bucket: env.R2_BUCKET_NAME,
              Key: upload.Key,
              UploadId: upload.UploadId,
            }),
          );
          aborted++;
        } catch (err) {
          console.error(
            `Failed to abort multipart upload ${upload.UploadId} for key ${upload.Key}:`,
            err,
          );
        }
      }
      if (!res.IsTruncated) break;
      keyMarker = res.NextKeyMarker;
      uploadIdMarker = res.NextUploadIdMarker;
    }
    return aborted;
  } catch (err) {
    console.error("Failed to list multipart uploads:", err);
    return 0;
  }
}
