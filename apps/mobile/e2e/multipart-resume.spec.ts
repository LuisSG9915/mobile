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
 * H1.1: una subida multipart (> 20 MB) reanuda contra la MISMA MPU después de
 * recargar la pestaña. Cubre I-03 (antes cada init creaba una MPU nueva y los
 * etags viejos envenenaban el ensamblado → 409 permanente).
 *
 * El archivo se inyecta directamente en la cola persistida (IndexedDB) porque
 * el selector web solo acepta image/* y el procesador web decodifica la
 * imagen para la miniatura. El JPG real se rellena con bytes de relleno hasta
 * superar el umbral: sha256/miniatura se calculan sobre el mismo buffer, así
 * que el flujo es el real salvo por la selección manual.
 *
 * Requiere `.dev.vars` con R2 dev (global-setup ya lo exige): el E2E escribe en
 * el bucket REAL photos-media-dev y limpia users/<userId>/ al terminar.
 */

type Stats = { count: number };
type SeedResult = { sha256: string };

const MB = 1024 * 1024;
const PART_SIZE = 5 * MB;
const FILE_SIZE = 21 * MB;

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

/**
 * Inserta el item + blob en la cola IndexedDB y arranca una pasada real del
 * procesador web. Devuelve el sha256 para localizar la fila en D1.
 */
async function seedMultipartItem(page: Page, file: Buffer): Promise<SeedResult> {
  return page.evaluate(async (bytes) => {
    // Import dinámico del bundle web de Metro (código de la propia app).
    const mod = (path: string): Promise<any> => import(/* @vite-ignore */ path);
    const db = await mod("/src/queue/db.web.ts");
    const processor = await mod("/src/queue/processor.web.ts");
    const { sha256File } = await mod("/src/web/hash.ts");

    const token = localStorage.getItem("photos.session_token") ?? "";
    const session = await fetch("/api/auth/get-session", {
      headers: { authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    const userId = session?.user?.id as string | undefined;
    if (!userId) throw new Error("No se pudo resolver el usuario de la sesión");
    await db.initializeQueue(userId);

    const name = "resume-multipart.jpg";
    const blob = new File([new Uint8Array(bytes)], name, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    const sha256 = await sha256File(blob);
    const id = `seed-${sha256.slice(0, 12)}`;
    await db.enqueueAsset(
      { id, uri: `seed://${id}`, filename: name, mediaType: "photo", creationTime: Date.now() },
      blob,
    );

    // No esperar la pasada: se retiene en presign-parts y se recarga.
    void processor.processQueue({ concurrency: 1, skipBatchPrehash: true });
    return { sha256 };
  }, Array.from(file));
}

/** Estado y partes persistidas de la primera fila de la cola. */
function idbState(page: Page): Promise<{ state: string; parts: string | null } | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("photos.queue");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      if (!db.objectStoreNames.contains("items")) return null;
      const tx = db.transaction("items", "readonly");
      const rows = await new Promise<{ state: string; parts: string | null }[]>(
        (resolve, reject) => {
          const req = tx.objectStore("items").getAll();
          req.onsuccess = () => resolve(req.result as { state: string; parts: string | null }[]);
          req.onerror = () => reject(req.error);
        },
      );
      const row = rows[0];
      return row ? { state: row.state, parts: row.parts ?? null } : null;
    } finally {
      db.close();
    }
  });
}

type HeldRoutes = {
  count: () => number;
  release: () => Promise<void>;
  stop: () => Promise<void>;
};

/** Retiene las peticiones que casan con `pattern` hasta release(). */
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
    stop: () => page.unroute(pattern, handler).catch(() => {}),
  };
}

async function waitStatsCount(token: string, count: number): Promise<Stats> {
  let stats = await apiGet<Stats>("/v1/stats", token);
  for (let i = 0; i < 30 && stats.count !== count; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    stats = await apiGet<Stats>("/v1/stats", token);
  }
  return stats;
}

test.describe("multipart resume", () => {
  test.describe.configure({ mode: "serial" });
  const email = uniqueEmail();
  let token: string | null = null;
  let userId: string | null = null;

  test.afterAll(async () => {
    await cleanupUserById(userId);
  });

  test("archivo > 20 MB: corta a mitad de partes, recarga y reanuda la misma MPU", async ({
    page,
  }) => {
    test.setTimeout(360_000);

    await test.step("registro y cola sembrada con un JPG de 21 MB", async () => {
      await register(page, email);
      token = await getToken(page);
      expect(token).toBeTruthy();
      userId = await resolveUserId(token as string);
      expect(userId).toBeTruthy();
    });

    const jpg = makeJpeg(Date.now(), 640, 480);

    await test.step("la primera pasada queda retenida en presign-parts", async () => {
      const partsHold = await holdRoutes(page, "**/v1/uploads/multipart/presign-parts");
      const { sha256 } = await seedMultipartItem(page, jpg);
      expect(sha256).toMatch(/^[a-f0-9]{64}$/);

      await expect.poll(() => partsHold.count(), { timeout: 120_000 }).toBe(1);
      const state = await idbState(page);
      expect(state?.state).toBe("uploading_original");
      expect(state?.parts).toBe("[]");

      // Recarga: aborta la petición retenida y arranca una pasada nueva.
      await page.reload();
      await waitForTabs(page);
      await partsHold.release();
      await partsHold.stop();
    });

    const resumed = await test.step("el reintento conserva la MPU (resumed: true)", async () => {
      const [initRes] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/v1/uploads/multipart/init") && r.request().method() === "POST",
          { timeout: 60_000 },
        ),
        clickTab(page, "Respaldo"),
      ]);
      const body = (await initRes.json()) as Record<string, unknown>;
      expect(initRes.status()).toBe(200);
      return body;
    });

    await test.step("resumed coincide con lo persistido en D1", async () => {
      // La primera sesión de la MPU se guardó al sembrar; el reintento la reusa.
      expect(resumed.resumed).toBe(true);
      expect(resumed.totalParts).toBe(FILE_SIZE / PART_SIZE);
    });

    await test.step("la subida termina: '1 de 1 respaldados' y stats.count = 1", async () => {
      await expect(visibleText(page, synced(1, 1))).toBeVisible({ timeout: 180_000 });
      const stats = await waitStatsCount(token as string, 1);
      expect(stats.count).toBe(1);
    });

    await test.step("el item queda done y sin partes pendientes", async () => {
      const state = await idbState(page);
      expect(state?.state).toBe("done");
    });
  });
});
