/**
 * Smoke contra producción (H-007): login en photos-web.workers.dev y
 * subida real — verifica el PUT presignado cross-origin a R2 de producción.
 *
 * Uso:
 *   node e2e/prod-smoke.mjs [--optional]
 */
import { chromium } from "@playwright/test";
import { encode } from "jpeg-js";

const isOptional =
  process.argv.includes("--optional") ||
  process.env.SMOKE_OPTIONAL === "true" ||
  process.env.SMOKE_OPTIONAL === "1";

const WEB = process.env.PROD_WEB_URL ?? "https://photos-web.luis-sg9915.workers.dev";
const EMAIL = process.env.SMOKE_USER_EMAIL ?? "e2e-prod-web@example.com";
const PASSWORD = process.env.SMOKE_USER_PASSWORD ?? "password-e2e-123";

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
      .then(() => "permissions")
      .catch(() => null),
    page
      .getByText("Respaldo", { exact: true })
      .filter({ visible: true })
      .last()
      .waitFor({ timeout: 15_000 })
      .then(() => "tabs")
      .catch(() => null),
  ]);

  if (tabsOrPerms === "permissions") {
    await page.getByText("Continuar", { exact: true }).filter({ visible: true }).last().click();
  } else if (!tabsOrPerms) {
    // Si no entró, intentar registro por si el usuario aún no existe en producción
    console.log("prod-smoke: usuario no autenticado, intentando registro…");
    await page.goto(`${WEB}/register`, { timeout: 15_000 }).catch(() => {});
    const nameInput = page.locator('input[autocomplete="name"]:visible');
    if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nameInput.fill("Smoke Prod");
      await page.locator('input[autocomplete="email"]:visible').fill(EMAIL);
      await page.locator('input[type="password"]:visible').fill(PASSWORD);
      await page.getByText("Crear cuenta", { exact: true }).last().click();
      await page
        .getByText("Continuar", { exact: true })
        .filter({ visible: true })
        .last()
        .click({ timeout: 15_000 })
        .catch(() => {});
    }
  }

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

  await page
    .getByText("1 de 1 respaldados", { exact: true })
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 120_000 });

  console.log("RESULT: subida completada — '1 de 1 respaldados' visible");
  console.log("RED:");
  for (const h of hits) console.log(`  ${h}`);
  const token = await page.evaluate(() => localStorage.getItem("photos.session_token"));
  console.log("TOKEN:", token ? `${token.slice(0, 12)}…` : "(no hay)");
} catch (err) {
  if (isOptional) {
    console.warn(
      `prod-smoke: fallo en smoke de producción (${err.message}). Omitiendo por flag opcional.`,
    );
    process.exit(0);
  }
  throw err;
} finally {
  await browser.close();
}
