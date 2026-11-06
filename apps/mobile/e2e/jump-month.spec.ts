import { expect, type Page, test } from "@playwright/test";
import { apiGet, cleanupUser, getToken, makeJpeg, register, uniqueEmail } from "./helpers";

const MONTHS_ENDPOINT = "/v1/timeline/months";

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

/**
 * Texto real que pinta el modal de meses (`monthLabel` sin capitalizar; la
 * mayúscula inicial es solo CSS `capitalize`, no contenido del DOM).
 */
function esMonthText(ym: string): string {
  const label = new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("es", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  // `monthLabelUtc` capitaliza el contenido (ya no es solo CSS `capitalize`).
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Timestamps dentro de un mismo mes UTC, separados 1 min (nunca cruza el borde). */
function monthDates(ym: string, count: number): number[] {
  const [year, month] = ym.split("-").map(Number);
  const start = Date.UTC(year, month - 1, 1, 0, 0, 0);
  return Array.from({ length: count }, (_, i) => start + i * 60_000);
}

/**
 * Encola fotos con `lastModified` controlado usando el evento `drop` global de
 * la galería: `enqueueFiles` deriva `creationTime` de `File.lastModified`, así
 * que podemos sembrar meses antiguos sin depender de EXIF ni de 60 selectores
 * de archivo. Evita además el límite de la primera página del timeline (60).
 */
async function dropPhotos(page: Page, lastModifiedList: number[]): Promise<void> {
  const files = lastModifiedList.map((lastModified, i) => ({
    b64: makeJpeg(i, 96, 96).toString("base64"),
    lastModified,
    name: `e2e-${i}-${lastModified}.jpg`,
  }));
  await page.evaluate((payload) => {
    const dt = new DataTransfer();
    payload.forEach((item) => {
      const bin = atob(item.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      dt.items.add(
        new File([bytes], item.name, { type: "image/jpeg", lastModified: item.lastModified }),
      );
    });
    window.dispatchEvent(
      new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  }, files);
}

type Month = { month: string; count: number };

test.describe("jump-month", () => {
  test("saltar a meses fuera de la primera página pinta celdas (nunca negro)", async ({ page }) => {
    // 61 recientes + 3 meses antiguos: los antiguos quedan fuera de la página
    // inicial de 60 y fuerzan el camino `before` que dejaba la lista en blanco.
    test.setTimeout(420_000);
    const email = uniqueEmail();
    let token: string | null = null;

    try {
      await register(page, email);
      token = await getToken(page);
      expect(token).toBeTruthy();

      const now = new Date();
      const currentYm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const oldMonths = ["2024-05", "2023-03", "2022-07"];
      const dates = [
        ...monthDates(currentYm, 61),
        ...oldMonths.map((ym) => Date.parse(`${ym}-15T12:00:00Z`)),
      ];
      const total = dates.length;

      await test.step("sembrar fotos en meses distintos", async () => {
        await dropPhotos(page, dates);
        await clickTab(page, "Respaldo");
        await expect(visibleText(page, `${total} de ${total} respaldados`)).toBeVisible({
          timeout: 300_000,
        });
      });

      await test.step("la lista de meses los conoce", async () => {
        const res = await apiGet<{ months: Month[] }>(MONTHS_ENDPOINT, token as string);
        const months = res.months.map((m) => m.month);
        for (const ym of oldMonths) expect(months).toContain(ym);
      });

      await clickTab(page, "Fotos");

      for (const ym of ["2023-03", "2024-05", "2022-07"]) {
        await test.step(`salto a ${ym} mantiene celdas`, async () => {
          await page.getByLabel("Ir a un mes", { exact: true }).click();
          await page
            .getByText(esMonthText(ym), { exact: true })
            .filter({ visible: true })
            .first()
            .click();
          await expect(page.getByLabel("foto", { exact: true }).first()).toBeVisible({
            timeout: 20_000,
          });
          await expect(
            page.getByText("No hay fotos en este mes", { exact: true }),
          ).not.toBeVisible();
        });
      }
    } finally {
      await cleanupUser(token);
    }
  });
});
