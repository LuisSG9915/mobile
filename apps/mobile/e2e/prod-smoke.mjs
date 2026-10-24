/**
 * Smoke contra producción: login en la web desplegada y subida real (verifica
 * el PUT prefirmado cross-origin a R2 de producción).
 *
 * Credenciales: SOLO por secretos del repo (`SMOKE_USER_EMAIL`,
 * `SMOKE_USER_PASSWORD`). No hay valores por defecto: sin ellos el script sale
 * con código 2 ("no configurado") y el workflow lo trata como skip.
 *
 * Uso:
 *   node e2e/prod-smoke.mjs [--optional]
 *
 * Salidas: 0 = OK (o omitido con --optional), 1 = fallo real, 2 = no configurado.
 */
import { chromium } from "@playwright/test";
import { encode } from "jpeg-js";

const isOptional =
  process.argv.includes("--optional") ||
  process.env.SMOKE_OPTIONAL === "true" ||
  process.env.SMOKE_OPTIONAL === "1";

const WEB = process.env.PROD_WEB_URL ?? "https://photos-web.luis-sg9915.workers.dev";
const API = process.env.PROD_API_URL ?? "https://photos-api.luis-sg9915.workers.dev";
const EMAIL = process.env.SMOKE_USER_EMAIL ?? "";
const PASSWORD = process.env.SMOKE_USER_PASSWORD ?? "";

function notConfigured(reason) {
  console.warn(
    `prod-smoke: no configurado (${reason}). Define SMOKE_USER_EMAIL y SMOKE_USER_PASSWORD.`,
  );
  process.exit(isOptional ? 0 : 2);
}

function makeJpeg(seed, width = 640, height = 480) {
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
  return encode({ data, width, height }, 80).data;
}

/** Borra el media subido por el smoke (papelera + purga; nunca toca otros usuarios). */
async function cleanupUploaded(id, bearer) {
  if (!id || !bearer) return;
  const headers = { authorization: `Bearer ${bearer}` };
  await fetch(`${API}/v1/media/${id}`, { method: "DELETE", headers }).catch(() => {});
  await fetch(`${API}/v1/trash/empty`, { method: "POST", headers }).catch(() => {});
}

if (!EMAIL || !PASSWORD) notConfigured("faltan credenciales");

let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  if (isOptional) {
    console.warn(`prod-smoke: chromium no disponible (${err.message}). Omitiendo smoke opcional.`);
    process.exit(0);
  }
  throw err;
}

let mediaId = null;
let token = null;

try {
  const page = await browser.newPage();
  const hits = [];
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("r2.cloudflarestorage.com") || u.includes("photos-api")) {
      hits.push(`${res.request().method()} ${res.status()} ${u.slice(0, 110)}`);
    }
  });

  console.log(`prod-smoke: conectando a ${WEB}/login…`);
  try {
    await page.goto(`${WEB}/login`, { timeout: 30_000 });
  } catch (err) {
    if (isOptional) {
      console.warn(
        `prod-smoke: no se pudo cargar ${WEB}/login (${err.message}). Omitiendo smoke opcional.`,
      );
      process.exit(0);
    }
    throw err;
  }

  await page.locator('input[autocomplete="email"]:visible').fill(EMAIL);
  await page.locator('input[type="password"]:visible').fill(PASSWORD);
  await page.getByText("Iniciar sesión", { exact: true }).last().click();

  // Comprobar si entró o si hay botón Continuar (pantalla de permisos)
  const tabsOrPerms = await Promise.race([
    page
      .getByText("Continuar", { exact: true })
      .filter({ visible: true })
      .last()
      .waitFor({ timeout: 15_000 })
      .then(() => "permissions"),
    page
      .getByText("Respaldo", { exact: true })
      .filter({ visible: true })
      .last()
      .waitFor({ timeout: 15_000 })
      .then(() => "tabs"),
  ]).catch(() => null);

  if (tabsOrPerms === "permissions") {
    await page.getByText("Continuar", { exact: true }).filter({ visible: true }).last().click();
  } else if (!tabsOrPerms) {
    // NUNCA registrar cuentas en producción desde un smoke: es un fallo de credenciales.
    throw new Error(
      "login falló: revisa SMOKE_USER_EMAIL / SMOKE_USER_PASSWORD (el smoke no registra cuentas)",
    );
  }

  token = await page.evaluate(() => localStorage.getItem("photos.session_token"));
  if (!token) throw new Error("sin token de sesión tras el login");

  await page
    .getByText("Respaldo", { exact: true })
    .filter({ visible: true })
    .last()
    .click({ timeout: 30_000 });

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page
      .getByText("Subir fotos y videos", { exact: true })
      .filter({ visible: true })
      .last()
      .click(),
  ]);
  await chooser.setFiles({
    name: "prod-smoke.jpg",
    mimeType: "image/jpeg",
    buffer: makeJpeg(Date.now() % 100000),
  });

  // La subida termina cuando el timeline se refresca; localizamos el id para limpiarlo.
  const timeline = await page
    .waitForResponse((r) => r.url().includes("/v1/timeline") && r.status() === 200, {
      timeout: 120_000,
    })
    .then((r) => r.json())
    .catch(() => null);

  if (!timeline) throw new Error("la subida no refrescó el timeline en 120 s");
  mediaId = timeline?.items?.[0]?.id ?? null;

  console.log("RESULT: subida completada — timeline refrescado");
  console.log("RED:");
  for (const h of hits) console.log(`  ${h}`);
  console.log("TOKEN:", token ? `${token.slice(0, 6)}… (no se imprime completo)` : "(no hay)");
} catch (err) {
  if (isOptional) {
    console.warn(
      `prod-smoke: fallo en smoke de producción (${err.message}). Omitiendo por flag opcional.`,
    );
    process.exit(0);
  }
  throw err;
} finally {
  await cleanupUploaded(mediaId, token);
  await browser.close();
}
