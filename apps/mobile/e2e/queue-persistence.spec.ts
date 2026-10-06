import { expect, type Page, type Route, test } from "@playwright/test";
import {
  apiGet,
  cleanupUserById,
  getToken,
  makeJpeg,
  register,
  resolveUserId,
  uniqueEmail,
} from "./helpers";

/**
 * H-005: la cola web persiste en IndexedDB y sobrevive a recargas/cierres de
 * pestaña; el procesamiento es exclusivo vía Web Locks y el logout explícito
 * borra los pendientes locales.
 *
 * Un solo usuario para todo el describe (mode serial). Cada test recibe un
 * contexto de navegador nuevo (localStorage e IndexedDB vacíos), así que la
 * sesión se reinyecta con addInitScript y la cola se vuelve a poblar en cada
 * caso — las recargas/nuevas pestañas son dentro del MISMO contexto, que es
 * donde IDB y el token sí se comparten.
 */

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

/**
 * Tras recarga/navigation la app muestra "Preparando tus respaldos…" mientras
 * abre IndexedDB; esperar a que la tab bar (etiqueta "Respaldo") esté visible.
 */
async function waitForTabs(page: Page): Promise<void> {
  const byLabel = page.getByLabel("Respaldo", { exact: true }).first();
  try {
    await byLabel.waitFor({ state: "visible", timeout: 60_000 });
  } catch {
    await page
      .getByText("Respaldo", { exact: true })
      .filter({ visible: true })
      .last()
      .waitFor({ timeout: 60_000 });
  }
}

async function pickFile(page: Page, name: string, buffer: Buffer): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page
      .getByText("Subir fotos y videos", { exact: true })
      .filter({ visible: true })
      .last()
      .click(),
  ]);
  await chooser.setFiles({ name, mimeType: "image/jpeg", buffer });
}

/** Conteos de los stores de la BD local `photos.queue` (IndexedDB). */
function idbCounts(page: Page): Promise<{ items: number; files: number }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("photos.queue");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      if (!db.objectStoreNames.contains("items")) return { items: 0, files: 0 };
      const tx = db.transaction(["items", "files"], "readonly");
      const count = (store: string) =>
        new Promise<number>((resolve, reject) => {
          const req = tx.objectStore(store).count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      // Ambas peticiones en el mismo tick: la tx no debe quedar inactiva.
      const itemsP = count("items");
      const filesP = count("files");
      return { items: await itemsP, files: await filesP };
    } finally {
      db.close();
    }
  });
}

/** Estado de la primera fila de `items` (o null si la BD no existe/está vacía). */
function idbItemState(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("photos.queue");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      if (!db.objectStoreNames.contains("items")) return null;
      const tx = db.transaction("items", "readonly");
      const rows = await new Promise<{ state: string }[]>((resolve, reject) => {
        const req = tx.objectStore("items").getAll();
        req.onsuccess = () => resolve(req.result as { state: string }[]);
        req.onerror = () => reject(req.error);
      });
      return rows[0]?.state ?? null;
    } finally {
      db.close();
    }
  });
}

type HeldRoutes = {
  /** Cuántas peticiones quedaron retenidas. */
  count: () => number;
  /** Deja de retener y continúa las pendientes (las ya muertas se ignoran). */
  release: () => Promise<void>;
  /** Deja de retener y aborta las pendientes (las ya muertas se ignoran). */
  abort: () => Promise<void>;
  /** Quita el handler por completo. */
  stop: () => Promise<void>;
};

/**
 * Intercepta `pattern` RETENIENDO las peticiones (sin responder ni abortar):
 * la app queda bloqueada en ese await hasta que release()/abort() las suelte
 * o la pestaña navegue/cierre. Las que lleguen tras release() pasan directo.
 */
async function holdRoutes(page: Page, pattern: string | RegExp): Promise<HeldRoutes> {
  const held: Route[] = [];
  let holding = true;
  const handler = (route: Route) => {
    if (holding) held.push(route);
    else void route.continue().catch(() => {});
  };
  await page.route(pattern, handler);
  return {
    count: () => held.length,
    release: async () => {
      holding = false;
      for (const r of held.splice(0)) await r.continue().catch(() => {});
    },
    abort: async () => {
      holding = false;
      for (const r of held.splice(0)) await r.abort().catch(() => {});
    },
    stop: () => page.unroute(pattern, handler).catch(() => {}),
  };
}

/** stats con pequeño margen por si D1 tarda en reflejar el insert. */
async function waitStatsCount(token: string, count: number): Promise<Stats> {
  let stats = await apiGet<Stats>("/v1/stats", token);
  for (let i = 0; i < 20 && stats.count !== count; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    stats = await apiGet<Stats>("/v1/stats", token);
  }
  return stats;
}

test.describe("queue-persistence", () => {
  test.describe.configure({ mode: "serial" });
  const email = uniqueEmail();
  let token: string | null = null;
  // Capturado mientras el token vive: el test de logout lo invalida en el
  // servidor y cleanupUser ya no podría resolver el usuario para limpiar R2.
  let userId: string | null = null;
  // Medias distintas ya subidas por el usuario (stats acumulado del servidor).
  let expectedMedia = 0;

  const withSession = async (page: Page): Promise<void> => {
    await page.addInitScript((t) => {
      if (t) localStorage.setItem("photos.session_token", t);
    }, token);
  };

  test.afterAll(async () => {
    // Obligatorio: el E2E escribe en el bucket REAL photos-media-dev.
    await cleanupUserById(userId);
  });

  test("reanuda la subida tras recargar la página", async ({ page }) => {
    await register(page, email);
    token = await getToken(page);
    expect(token).toBeTruthy();
    userId = await resolveUserId(token as string);
    expect(userId).toBeTruthy();
    await clickTab(page, "Respaldo");

    const initHold = await holdRoutes(page, "**/v1/uploads/init");
    await pickFile(page, "persiste.jpg", makeJpeg(Date.now()));

    // Item + blob persistidos en IndexedDB y el init ya quedó retenido.
    await expect.poll(() => idbCounts(page), { timeout: 30_000 }).toEqual({ items: 1, files: 1 });
    await expect.poll(() => initHold.count(), { timeout: 30_000 }).toBe(1);

    // La recarga mata la petición retenida; al soltar el intercept la pasada
    // que arranca sola tras "Preparando tus respaldos…" completa la subida.
    await page.reload();
    await waitForTabs(page);
    await initHold.release();
    await initHold.stop();

    await clickTab(page, "Respaldo");
    await expect(visibleText(page, synced(1, 1))).toBeVisible({ timeout: 90_000 });

    await clickTab(page, "Fotos");
    await expect(page.getByLabel("foto", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    // done: la fila queda y el blob se borró en la misma transacción terminal.
    await expect.poll(() => idbCounts(page), { timeout: 15_000 }).toEqual({ items: 1, files: 0 });
    const stats = await waitStatsCount(token as string, 1);
    expect(stats.count).toBe(1);
    expectedMedia = 1;
  });

  test("recarga con 'complete' retenido: re-subida o duplicate reconcilian", async ({ page }) => {
    // Contexto nuevo: la cola arranca vacía y hay que reencolar el archivo.
    await withSession(page);
    await page.goto("/");
    await waitForTabs(page);
    await clickTab(page, "Respaldo");

    const completeHold = await holdRoutes(page, "**/v1/uploads/*/complete");
    await pickFile(page, "segunda.jpg", makeJpeg(Date.now() + 7));
    await expect.poll(() => idbCounts(page), { timeout: 30_000 }).toEqual({ items: 1, files: 1 });

    // Estado 'completing': los PUTs a R2 ya salieron y el POST /complete queda
    // retenido. La media remota puede quedar 'pending'.
    await expect.poll(() => idbItemState(page), { timeout: 60_000 }).toBe("completing");
    await expect.poll(() => completeHold.count(), { timeout: 30_000 }).toBe(1);

    await page.reload();
    await waitForTabs(page);
    await completeHold.release();
    await completeHold.stop();

    // Tras la recarga el item vuelve a queued y repite init: si la media quedó
    // pending el API devuelve 'upload' (re-subida idempotente); si el complete
    // retenido llegó a tiempo devuelve 'duplicate'. Ambos terminan en done.
    await clickTab(page, "Respaldo");
    await expect(visibleText(page, synced(1, 1))).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => idbCounts(page), { timeout: 15_000 }).toEqual({ items: 1, files: 0 });
    const stats = await waitStatsCount(token as string, expectedMedia + 1);
    expect(stats.count).toBe(expectedMedia + 1);
    expectedMedia++;
  });

  test("cerrar la pestaña y abrir otra en el mismo contexto continúa la cola", async ({ page }) => {
    await withSession(page);
    await page.goto("/");
    await waitForTabs(page);
    await clickTab(page, "Respaldo");

    const initHold = await holdRoutes(page, "**/v1/uploads/init");
    await pickFile(page, "tercera.jpg", makeJpeg(Date.now() + 13));
    await expect.poll(() => idbCounts(page), { timeout: 30_000 }).toEqual({ items: 1, files: 1 });
    await expect.poll(() => initHold.count(), { timeout: 30_000 }).toBe(1);

    // Cerrar la pestaña: localStorage e IndexedDB son del contexto y sobreviven.
    const context = page.context();
    await page.close();
    await initHold.abort().catch(() => {});
    await initHold.stop();

    const p2 = await context.newPage();
    await p2.goto("/");
    await waitForTabs(p2);
    await clickTab(p2, "Respaldo");
    // La pasada de la nueva pestaña (con la cola hidratada desde IDB) termina
    // la subida sola: init ya no está interceptado en p2.
    await expect(visibleText(p2, synced(1, 1))).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => idbCounts(p2), { timeout: 15_000 }).toEqual({ items: 1, files: 0 });
    const stats = await waitStatsCount(token as string, expectedMedia + 1);
    expect(stats.count).toBe(expectedMedia + 1);
    expectedMedia++;
    await p2.close();
  });

  test("dos pestañas no duplican el trabajo (Web Locks)", async ({ page, context }) => {
    await withSession(page);
    await page.goto("/");
    await waitForTabs(page);
    await clickTab(page, "Respaldo");

    // Cuenta los init en AMBAS pestañas y los retiene: si el lock fallara y la
    // segunda pestaña procesara, el contador lo delataría (y quedaría retenida
    // para no contaminar la cuenta).
    let initCalls = 0;
    const held: Route[] = [];
    const countAndHold = (route: Route) => {
      initCalls++;
      held.push(route);
    };
    await page.route("**/v1/uploads/init", countAndHold);

    await pickFile(page, "cuarta.jpg", makeJpeg(Date.now() + 21));
    await expect.poll(() => initCalls, { timeout: 30_000 }).toBe(1);

    const p2 = await context.newPage();
    await withSession(p2);
    await p2.route("**/v1/uploads/init", countAndHold);
    await p2.goto("/");
    await waitForTabs(p2);
    await clickTab(p2, "Respaldo");
    // p2 hidrata la cola desde IndexedDB: ve el pendiente ("0 de 1") pero su
    // pasada no consigue el lock (la primera pestaña lo retiene en el init).
    await expect(visibleText(p2, synced(0, 1))).toBeVisible({ timeout: 30_000 });
    // Margen para que una hipotética pasada de p2 disparara su init.
    await page.waitForTimeout(3000);
    expect(initCalls).toBe(1);

    await p2.close();
    for (const r of held.splice(0)) await r.abort().catch(() => {});
    await page.unroute("**/v1/uploads/init", countAndHold).catch(() => {});
    await p2.unroute("**/v1/uploads/init", countAndHold).catch(() => {});
  });

  test("cancelar el diálogo de logout conserva la cola", async ({ page }) => {
    await withSession(page);
    await page.goto("/");
    await waitForTabs(page);
    await clickTab(page, "Respaldo");

    const putHold = await holdRoutes(page, /r2\.cloudflarestorage\.com/);
    await pickFile(page, "quinta.jpg", makeJpeg(Date.now() + 31));
    await expect.poll(() => idbCounts(page), { timeout: 30_000 }).toEqual({ items: 1, files: 1 });

    await clickTab(page, "Ajustes");
    await expect(visibleText(page, "Cerrar sesión")).toBeVisible();
    page.once("dialog", (d) => void d.dismiss());
    await page.getByText("Cerrar sesión", { exact: true }).filter({ visible: true }).last().click();

    // Sigue en Ajustes, con sesión viva y la cola intacta.
    await expect(visibleText(page, "Cerrar sesión")).toBeVisible();
    await page.waitForTimeout(1500); // margen por si un logout erróneo avanzara
    expect(page.url()).not.toMatch(/welcome/);
    expect(await getToken(page)).toBeTruthy();
    await expect.poll(() => idbCounts(page), { timeout: 15_000 }).toEqual({ items: 1, files: 1 });
    await putHold.release();
    await putHold.stop();

    // El PUT retenido termina su subida (no heredar pendientes al logout).
    await clickTab(page, "Respaldo");
    await expect(visibleText(page, synced(1, 1))).toBeVisible({ timeout: 90_000 });
    expectedMedia++;
  });

  // Va último en el describe serial: el signOut invalida el token en el
  // servidor y los tests posteriores no podrían reutilizarlo.
  test("logout confirmado borra los pendientes locales", async ({ page }) => {
    await withSession(page);
    await page.goto("/");
    await waitForTabs(page);
    await clickTab(page, "Respaldo");

    const putHold = await holdRoutes(page, /r2\.cloudflarestorage\.com/);
    await pickFile(page, "sexta.jpg", makeJpeg(Date.now() + 41));
    await expect.poll(() => idbCounts(page), { timeout: 30_000 }).toEqual({ items: 1, files: 1 });
    // Retenido a mitad de subida: el item sigue pendiente en IndexedDB.
    await expect.poll(() => putHold.count(), { timeout: 30_000 }).toBeGreaterThan(0);

    await clickTab(page, "Ajustes");
    await expect(visibleText(page, "Cerrar sesión")).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await page.getByText("Cerrar sesión", { exact: true }).filter({ visible: true }).last().click();

    await expect(page).toHaveURL(/welcome/, { timeout: 30_000 });
    // La cola local se borró entera (items + archivos + cuenta).
    await expect.poll(() => idbCounts(page), { timeout: 15_000 }).toEqual({ items: 0, files: 0 });
    expect(await getToken(page)).toBeNull();
    await putHold.abort();
    await putHold.stop();

    // Otro usuario en el mismo navegador no ve restos del anterior.
    await register(page, uniqueEmail());
    await clickTab(page, "Respaldo");
    await expect(visibleText(page, "Todo al día")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => idbCounts(page), { timeout: 15_000 }).toEqual({ items: 0, files: 0 });
  });
});
