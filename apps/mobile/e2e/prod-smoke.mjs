/**
 * Smoke manual contra producción (H-007): login en photos-web.workers.dev y
 * subida real — verifica el PUT presignado cross-origin a R2 de producción.
 * Uso: node e2e/prod-smoke.mjs   (NO es un spec de playwright test).
 */
import { chromium } from "@playwright/test";
import { encode } from "jpeg-js";

const WEB = "https://photos-web.luis-sg9915.workers.dev";
const EMAIL = "e2e-prod-web@example.com";
const PASSWORD = "password-e2e-123";

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

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // Captura de red: todo lo que salga hacia el API o hacia R2 queda registrado.
  const hits = [];
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("r2.cloudflarestorage.com") || u.includes("photos-api")) {
      hits.push(`${res.request().method()} ${res.status()} ${u.slice(0, 110)}`);
    }
  });

  await page.goto(`${WEB}/login`);
  await page.locator('input[autocomplete="email"]:visible').fill(EMAIL);
  await page.locator('input[type="password"]:visible').fill(PASSWORD);
  await page.getByText("Iniciar sesión", { exact: true }).last().click();
  await page
    .getByText("Continuar", { exact: true })
    .filter({ visible: true })
    .last()
    .click({ timeout: 30_000 })
    .catch(() => {}); // si entra directo a tabs no hay pantalla de permisos
  await page
    .getByText("Aún no hay fotos respaldadas", { exact: true })
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => {});
  await page.getByText("Respaldo", { exact: true }).filter({ visible: true }).last().click();

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
} finally {
  await browser.close();
}
