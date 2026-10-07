import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// files.ts encola en ../queue/db (db.web.ts -> IndexedDB) y mantiene una caché
// de File de sesión; el store y el Map de la cola viven a nivel de módulo.
let files: typeof import("./files");
let db: typeof import("../queue/db");

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("photos.queue");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("deleteDatabase bloqueado: quedó una conexión abierta"));
  });
}

beforeEach(async () => {
  const prev = await import("../queue/db");
  await prev.closeQueue().catch(() => {});
  await deleteDb();
  vi.resetModules();
  localStorage.clear();
  files = await import("./files");
  db = await import("../queue/db");
  await db.initializeQueue("u1");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Espía input.click() y devuelve una función que abre el selector falso. */
function capturarInput() {
  const holder: { el?: HTMLInputElement } = {};
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    holder.el = this;
  });
  return () => {
    if (!holder.el) throw new Error("pickAndEnqueue no creó el input");
    return holder.el;
  };
}

function elegirArchivos(input: HTMLInputElement, elegidos: File[]) {
  Object.defineProperty(input, "files", { value: elegidos });
  input.dispatchEvent(new Event("change"));
}

const UUID_RE = /^web-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("pickAndEnqueue", () => {
  it("encola solo las extensiones permitidas y cuenta las omitidas", async () => {
    const getInput = capturarInput();
    const promise = files.pickAndEnqueue();
    const input = getInput();

    const jpg = new File(["jpeg"], "a.jpg", { type: "image/jpeg", lastModified: 1_111 });
    const mp4 = new File(["video"], "b.mp4", { type: "video/mp4", lastModified: 2_222 });
    const txt = new File(["texto"], "c.txt", { type: "text/plain", lastModified: 3_333 });
    elegirArchivos(input, [jpg, mp4, txt]);

    await expect(promise).resolves.toEqual({ added: 2, failed: 0, skipped: 1 });

    const items = db.getPendingItems();
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.asset_id).toMatch(UUID_RE);
    const itemJpg = items.find((i) => i.filename === "a.jpg");
    const itemMp4 = items.find((i) => i.filename === "b.mp4");
    expect(itemJpg?.media_type).toBe("photo");
    expect(itemMp4?.media_type).toBe("video");
    expect(db.getQueueStats().total).toBe(2);
  });

  it("getFile reconstruye un File equivalente tras reabrir la cola", async () => {
    const getInput = capturarInput();
    const promise = files.pickAndEnqueue();
    const input = getInput();
    const jpg = new File(["contenido-jpg"], "a.jpg", {
      type: "image/jpeg",
      lastModified: 1_111,
    });
    elegirArchivos(input, [jpg]);
    await promise;

    const id = db.getPendingItems()[0].asset_id;
    // Misma sesión: viene de la caché (mismo objeto).
    expect(await files.getFile(id)).toBe(jpg);

    // Recarga simulada: la caché se limpia y el File se reconstruye desde IDB.
    await db.closeQueue();
    await db.initializeQueue("u1");

    const restored = await files.getFile(id);
    expect(restored).toBeDefined();
    expect(restored).not.toBe(jpg); // no es el mismo objeto
    expect(restored?.name).toBe("a.jpg");
    expect(restored?.type).toBe("image/jpeg");
    expect(restored?.lastModified).toBe(1_111);
    expect(restored?.size).toBe(jpg.size);
    expect(await restored?.text()).toBe("contenido-jpg");
  });

  it("resuelve {added:0, failed:0, skipped:0} cuando el usuario cancela el selector", async () => {
    const getInput = capturarInput();
    const promise = files.pickAndEnqueue();
    getInput().dispatchEvent(new Event("cancel"));

    await expect(promise).resolves.toEqual({ added: 0, failed: 0, skipped: 0 });
    expect(db.getQueueStats().total).toBe(0);
  });
});
