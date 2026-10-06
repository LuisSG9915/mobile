import { expect, type Page, test } from "@playwright/test";
import { apiGet, cleanupUser, getToken, makeJpeg, register, uniqueEmail } from "./helpers";

type Stats = { count: number; totalBytes: number; lastUploadAt: number | null };

const synced = (done: number, total: number) => `${done} de ${total} respaldados`;

function visibleText(page: Page, text: string) {
  return page.getByText(text, { exact: true }).filter({ visible: true }).first();
}

async function clickTab(page: Page, name: string): Promise<void> {
  const byLabel = page.getByLabel(name, { exact: true }).first();
  try {
    await byLabel.waitFor({ state: "visible", timeout: 10_000 });
    await byLabel.click();
    return;
  } catch {
    await page.getByText(name, { exact: true }).filter({ visible: true }).last().click();
  }
}

/** stats con pequeño margen por si D1 tarda en reflejar el insert. */
async function waitStatsCount(token: string, count: number): Promise<Stats> {
  let stats = await apiGet<Stats>("/v1/stats", token);
  for (let i = 0; i < 15 && stats.count !== count; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    stats = await apiGet<Stats>("/v1/stats", token);
  }
  return stats;
}

// La cola web vive solo en memoria (los File no sobreviven a recargas), así
// que los tres casos del plan comparten página dentro de un mismo test.
test.describe("upload", () => {
  test.describe.configure({ mode: "serial" });
  const email = uniqueEmail();
  let token: string | null = null;

  test.afterAll(async () => {
    // Obligatorio: el E2E escribe en el bucket REAL photos-media-dev.
    await cleanupUser(token);
  });

  test("subida web: foto sube, duplicado y .txt no alteran el total", async ({ page }) => {
    const seed = Date.now();
    const jpg = makeJpeg(seed);

    await test.step("registro y pestaña Respaldo", async () => {
      await register(page, email);
      token = await getToken(page);
      expect(token).toBeTruthy();
      await clickTab(page, "Respaldo");
      await expect(visibleText(page, "Subir fotos y videos")).toBeVisible();
    });

    await test.step("primera subida termina en '1 de 1 respaldados'", async () => {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page
          .getByText("Subir fotos y videos", { exact: true })
          .filter({ visible: true })
          .last()
          .click(),
      ]);
      await chooser.setFiles({ name: "e2e.jpg", mimeType: "image/jpeg", buffer: jpg });

      await expect(visibleText(page, synced(1, 1))).toBeVisible({ timeout: 90_000 });

      const stats = await waitStatsCount(token as string, 1);
      expect(stats.count).toBe(1);

      await clickTab(page, "Fotos");
      // H-011 (resuelto): tras una subida exitosa la galería DEBE refrescarse
      // sola — processor.web.ts invalida las queries "timeline" y "stats" tras
      // completeUpload (y tras duplicate). Estas asserts verifican que la foto
      // aparece sin pull-refresh ni recarga. Siguen siendo expect.soft: si hay
      // regresión el fallo queda registrado pero el resto del flujo se verifica.
      await expect.soft(page.getByLabel("foto", { exact: true }).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect.soft(visibleText(page, "Aún no hay fotos respaldadas")).not.toBeVisible();

      // Evidencia del alcance: el item sí está en el timeline vía API; el
      // refresco es solo de la UI, la subida y el backend ya funcionaban.
      const timeline = await apiGet<{ items: unknown[] }>("/v1/timeline?limit=60", token as string);
      expect(timeline.items.length).toBe(1);

      // H-011 también cubre "stats": al invalidarse la query, Ajustes debe
      // mostrar el total actualizado sin recargar la página.
      await clickTab(page, "Ajustes");
      await expect(visibleText(page, "1 elementos respaldados")).toBeVisible({ timeout: 15_000 });

      await clickTab(page, "Respaldo");
    });

    await test.step("mismo archivo otra vez: '2 de 2' pero stats.count sigue en 1", async () => {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page
          .getByText("Subir fotos y videos", { exact: true })
          .filter({ visible: true })
          .last()
          .click(),
      ]);
      await chooser.setFiles({ name: "e2e.jpg", mimeType: "image/jpeg", buffer: jpg });

      await expect(visibleText(page, synced(2, 2))).toBeVisible({ timeout: 90_000 });
      const stats = await apiGet<Stats>("/v1/stats", token as string);
      expect(stats.count).toBe(1);
    });

    await test.step("archivo no permitido (notas.txt): el total no cambia", async () => {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page
          .getByText("Subir fotos y videos", { exact: true })
          .filter({ visible: true })
          .last()
          .click(),
      ]);
      await chooser.setFiles({
        name: "notas.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("no es una foto"),
      });

      // El filtro de extensiones lo descarta: sigue mostrando el total previo.
      await page.waitForTimeout(5000);
      await expect(visibleText(page, synced(2, 2))).toBeVisible();
      const stats = await apiGet<Stats>("/v1/stats", token as string);
      expect(stats.count).toBe(1);
    });
  });
});
