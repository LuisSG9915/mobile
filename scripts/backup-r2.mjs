#!/usr/bin/env node

/**
 * Respaldo Físico 3-2-1 de Cloudflare R2
 * Sincroniza incrementalmente todos los originales y miniaturas de R2 hacia un disco local.
 * Cloudflare R2 tiene $0 costo de transferencia (zero egress fees), por lo que ejecutar
 * este script diariamente o bajo demanda es 100% gratuito.
 */

import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

// Cargar variables de entorno desde apps/api/.dev.vars si existe y no están definidas en el entorno
function loadLocalDevVars() {
  const devVarsPath = path.resolve(process.cwd(), "apps/api/.dev.vars");
  if (!fs.existsSync(devVarsPath)) return;

  try {
    const content = fs.readFileSync(devVarsPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn("No se pudo leer apps/api/.dev.vars:", err.message);
  }
}

loadLocalDevVars();

// Parámetros CLI o variables de entorno
const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const accountId =
  process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || getArg("--account", "");
const accessKeyId =
  process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || getArg("--key", "");
const secretAccessKey =
  process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || getArg("--secret", "");
const bucketName =
  process.env.R2_BUCKET_NAME || process.env.BUCKET_NAME || getArg("--bucket", "photos-media");
const outDir = path.resolve(
  process.cwd(),
  getArg("--out", process.env.BACKUP_DIR || "./backups/r2-photos"),
);
const prefix = getArg("--prefix", "");

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error("❌ Faltan credenciales de Cloudflare R2.");
  console.error(
    "Por favor define R2_ACCOUNT_ID, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY en tu entorno o en apps/api/.dev.vars.",
  );
  console.error(
    "Uso alternativo: node scripts/backup-r2.mjs --account <id> --key <key> --secret <secret> [--bucket <name>] [--out <dir>]",
  );
  process.exit(1);
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`;
}

async function main() {
  console.log("==================================================");
  console.log("   📷 Respaldo Físico 3-2-1 - Cloudflare R2      ");
  console.log("   Egress Cost: $0 (Cloudflare Zero Egress)       ");
  console.log("==================================================");
  console.log(`Bucket de origen: ${bucketName}`);
  console.log(`Directorio local: ${outDir}`);
  if (prefix) console.log(`Prefijo:          ${prefix}`);
  console.log("Iniciando escaneo de objetos en R2...\n");

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });

  let continuationToken;
  const objects = [];
  let totalBytesInBucket = 0;

  do {
    const listRes = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
      }),
    );

    if (listRes.Contents) {
      for (const item of listRes.Contents) {
        if (!item.Key || item.Key.endsWith("/")) continue;
        objects.push(item);
        totalBytesInBucket += item.Size || 0;
      }
    }
    continuationToken = listRes.NextContinuationToken;
  } while (continuationToken);

  console.log(`Total en R2: ${objects.length} archivos (${formatBytes(totalBytesInBucket)})\n`);

  let downloadedCount = 0;
  let downloadedBytes = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const key = obj.Key;
    const size = obj.Size || 0;
    const progress = `[${i + 1}/${objects.length}]`;

    const localFilePath = path.join(outDir, ...key.split("/"));
    const localDir = path.dirname(localFilePath);

    // Verificación incremental: si el archivo ya existe y coincide el tamaño, omitir descarga
    if (fs.existsSync(localFilePath)) {
      const stat = fs.statSync(localFilePath);
      if (stat.size === size) {
        skippedCount++;
        continue;
      }
    }

    fs.mkdirSync(localDir, { recursive: true });

    process.stdout.write(`${progress} Descargando ${key} (${formatBytes(size)})... `);
    try {
      const getRes = await s3.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        }),
      );

      const writeStream = fs.createWriteStream(localFilePath);
      await pipeline(getRes.Body, writeStream);

      downloadedCount++;
      downloadedBytes += size;
      process.stdout.write("✓ OK\n");
    } catch (err) {
      errorCount++;
      process.stdout.write(`✗ ERROR: ${err.message}\n`);
    }
  }

  console.log("\n==================================================");
  console.log("   🎉 Respaldo completado exitosamente            ");
  console.log("==================================================");
  console.log(`Archivos escaneados:   ${objects.length}`);
  console.log(`Archivos omitidos:     ${skippedCount} (ya estaban actualizados)`);
  console.log(`Archivos descargados:  ${downloadedCount} (${formatBytes(downloadedBytes)})`);
  if (errorCount > 0) {
    console.log(`Archivos con error:    ${errorCount}`);
  }
  console.log(`Ubicación de copia:    ${outDir}`);
  console.log("==================================================\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
