#!/usr/bin/env node
/**
 * Preflight para `build:web` / `deploy:web`: exige EXPO_PUBLIC_API_URL con
 * esquema https y host real (no localhost/LAN), para no publicar por accidente
 * una web que apunte al API de desarrollo.
 *
 * Misma precedencia que Expo CLI: process.env gana sobre apps/mobile/.env.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function envFileValue(name) {
  // CHECK_WEB_ENV_FILE existe solo para tests: apunta a un .env alternativo.
  const file = process.env.CHECK_WEB_ENV_FILE ?? path.join(root, ".env");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    if (trimmed.slice(0, i).trim() === name) return trimmed.slice(i + 1).trim();
  }
  return undefined;
}

function fail(message) {
  console.error(`check-web-env: ${message}`);
  process.exit(1);
}

const url = process.env.EXPO_PUBLIC_API_URL ?? envFileValue("EXPO_PUBLIC_API_URL");

if (!url) {
  fail(
    "EXPO_PUBLIC_API_URL no está definida. Exporta la URL del API de producción " +
      "(ej. https://photos-api.luis-sg9915.workers.dev) en el entorno o en apps/mobile/.env antes de exportar.",
  );
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  fail(`EXPO_PUBLIC_API_URL no es una URL válida: ${url}`);
}

if (parsed.username || parsed.password) {
  fail("EXPO_PUBLIC_API_URL no puede llevar credenciales en la URL.");
}
if (parsed.search || parsed.hash) {
  fail("EXPO_PUBLIC_API_URL debe ser solo el origen (sin query ni fragmento).");
}

const isLocalHost =
  parsed.hostname === "localhost" ||
  parsed.hostname === "127.0.0.1" ||
  parsed.hostname === "::1" ||
  parsed.hostname.endsWith(".local");

if (parsed.protocol !== "https:" || isLocalHost) {
  fail(
    `EXPO_PUBLIC_API_URL debe ser una URL https de producción, no "${url}". ` +
      "Una web en https no puede llamar a un API http/local.",
  );
}

console.log(`check-web-env: API de producción OK -> ${parsed.origin}`);
