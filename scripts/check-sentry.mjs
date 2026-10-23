#!/usr/bin/env node
/**
 * Verifica un DSN de Sentry enviando un evento de prueba al endpoint de ingesta.
 *
 * Uso:
 *   pnpm check:sentry
 *   EXPO_PUBLIC_SENTRY_DSN=https://... pnpm check:sentry
 *
 * Busca el DSN en el entorno, luego en apps/mobile/.env y por último en
 * apps/api/.dev.vars (SENTRY_DSN). No imprime el DSN.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function envFileValue(file, name) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    if (trimmed.slice(0, i).trim() === name) {
      return trimmed
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

const candidates = [
  ["entorno", process.env.EXPO_PUBLIC_SENTRY_DSN],
  ["entorno", process.env.SENTRY_DSN],
  ["apps/mobile/.env", envFileValue(path.resolve("apps/mobile/.env"), "EXPO_PUBLIC_SENTRY_DSN")],
  ["apps/api/.dev.vars", envFileValue(path.resolve("apps/api/.dev.vars"), "SENTRY_DSN")],
];

const found = candidates.find(([, value]) => value);
if (!found) {
  const isOptional =
    process.argv.includes("--optional") ||
    process.env.SENTRY_OPTIONAL === "true" ||
    process.env.SENTRY_OPTIONAL === "1";
  if (isOptional) {
    console.log(
      "check-sentry: DSN no configurado (opcional en este entorno). Saltando verificación.",
    );
    process.exit(0);
  }
  console.error(
    "check-sentry: no hay DSN. Define EXPO_PUBLIC_SENTRY_DSN en apps/mobile/.env " +
      "o SENTRY_DSN en apps/api/.dev.vars.",
  );
  process.exit(1);
}

const [source, dsn] = found;

let url;
try {
  url = new URL(dsn);
} catch {
  console.error(`check-sentry: DSN inválido (${source}).`);
  process.exit(1);
}

const publicKey = url.username;
const projectId = url.pathname.replace(/^\//, "");
if (!publicKey || !projectId) {
  console.error(`check-sentry: al DSN le falta la clave pública o el project id (${source}).`);
  process.exit(1);
}

const endpoint = `https://${url.host}/api/${projectId}/store/`;
const event = {
  message: "Photos: prueba de integración de Sentry",
  level: "info",
  platform: "javascript",
  tags: { source: "check-sentry" },
  extra: { source },
};

const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=photos-check/1.0`,
  },
  body: JSON.stringify(event),
});

const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`check-sentry: ingesta rechazó el evento (HTTP ${res.status}).`);
  console.error(body.detail ?? body.error ?? "");
  process.exit(1);
}

console.log(`check-sentry: DSN OK (${source}). Evento enviado: ${body.id ?? "sin id"}`);
console.log("Búscalo en Sentry → Issues con el tag source:check-sentry.");
