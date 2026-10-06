import { readFileSync } from "node:fs";
import path from "node:path";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { Page } from "@playwright/test";
import { encode } from "jpeg-js";

const API_URL = "http://localhost:8787";
// Playwright transpila los tests a CJS: __dirname está disponible (import.meta no).
const dirname = __dirname;

export const E2E_PASSWORD = "password-e2e-123";

/** Email único por corrida: el usuario se crea contra el API/D1 reales. */
export function uniqueEmail(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-${Date.now()}-${rand}@example.com`;
}

/**
 * Registra un usuario nuevo desde /register y deja la app en las tabs.
 * En web el registro pasa por /permissions (requestMediaPermissions es un stub
 * que siempre concede): hay que pulsar "Continuar" para llegar a las tabs.
 */
export async function register(
  page: Page,
  email: string,
  password: string = E2E_PASSWORD,
): Promise<void> {
  await page.goto("/register");
  await page.locator('input[autocomplete="name"]:visible').fill("E2E Test");
  await page.locator('input[autocomplete="email"]:visible').fill(email);
  await page.locator('input[type="password"]:visible').fill(password);
  await page.getByText("Crear cuenta", { exact: true }).last().click();
  await page.getByText("Continuar", { exact: true }).filter({ visible: true }).last().click();
  await page
    .getByText("Aún no hay fotos respaldadas", { exact: true })
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 60_000 });
}

/**
 * JPEG real generado con jpeg-js (el procesador calcula sha256 y miniatura con
 * canvas, así que el archivo tiene que decodificar de verdad). Los píxeles se
 * derivan de `seed` para que el sha256 cambie entre corridas.
 */
export function makeJpeg(seed: number, width = 640, height = 480): Buffer {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const x = i % width;
    const y = Math.floor(i / width);
    const v = (i * 31 + seed * 131) % 251;
    data[p] = (v + x) % 256;
    data[p + 1] = (v * 3 + y + seed) % 256;
    data[p + 2] = (v * 7 + x + y) % 256;
    data[p + 3] = 255;
  }
  const { data: jpg } = encode({ data, width, height }, 80);
  return jpg;
}

/** Token Bearer que el cliente web guarda en localStorage (auth/client.web.ts). */
export function getToken(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem("photos.session_token"));
}

/** GET autenticado contra el wrangler dev local. */
export async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

// Mismo parser de .dev.vars que apps/api/vitest.config.ts.
function loadDevVars(): Record<string, string> {
  try {
    const raw = readFileSync(path.join(dirname, "../../api/.dev.vars"), "utf8");
    return Object.fromEntries(
      raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

type SessionResponse = { user?: { id?: string } | null } | null;

/** Resuelve el userId del token Bearer (mientras la sesión siga viva). */
export async function resolveUserId(token: string): Promise<string | null> {
  const session = await apiGet<SessionResponse>("/api/auth/get-session", token);
  return session?.user?.id ?? null;
}

/**
 * Obligatorio: el E2E escribe en el bucket REAL de dev (photos-media-dev).
 * Borra únicamente el prefijo users/<userId>/ del usuario de prueba.
 * Devuelve cuántos objetos eliminó.
 */
export async function cleanupUser(token: string | null): Promise<number> {
  if (!token) return 0;
  // Si el test hizo logout el token ya no resuelve: preferir cleanupUserById.
  const userId = await resolveUserId(token).catch(() => null);
  if (!userId) return 0;
  return cleanupUserById(userId);
}

/** Limpieza por userId directo: funciona aunque la sesión se haya cerrado. */
export async function cleanupUserById(userId: string | null): Promise<number> {
  if (!userId) return 0;
  const vars = loadDevVars();
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${vars.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: vars.R2_ACCESS_KEY_ID,
      secretAccessKey: vars.R2_SECRET_ACCESS_KEY,
    },
    // El SDK v3 agrega checksums que R2 no acepta salvo que sean requeridos.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  const Bucket = vars.R2_BUCKET_NAME;
  // Guardarraíl (además de global-setup): esta función borra en un bucket real;
  // nunca debe apuntar fuera del bucket de desarrollo.
  if (Bucket !== "photos-media-dev") {
    throw new Error(
      `cleanupUserById: bucket inesperado "${Bucket ?? "(vacío)"}"; el E2E solo puede limpiar photos-media-dev`,
    );
  }
  const Prefix = `users/${userId}/`;

  let deleted = 0;
  let continuation: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken: continuation }),
    );
    const objects = (listed.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => typeof k === "string")
      .map((Key) => ({ Key }));
    if (objects.length > 0) {
      const out = await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objects } }));
      if (out.Errors?.length) {
        throw new Error(
          `cleanupUser: R2 rechazó ${out.Errors.length} borrados de ${objects.length} objetos`,
        );
      }
      deleted += objects.length;
    }
    continuation = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuation);
  return deleted;
}
