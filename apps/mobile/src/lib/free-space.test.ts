import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "../queue/types";

/**
 * Tests de la implementación NATIVA de "Liberar espacio" (free-space.ts).
 * vitest resuelve "./free-space" a free-space.web.ts por resolve.extensions,
 * así que se importa la ruta literal "./free-space.ts". expo-media-library y
 * la capa de cola (../queue/db) se mockean.
 */

const mocks = vi.hoisted(() => ({
  getQueueItems: vi.fn<() => QueueItem[]>(() => []),
  removeQueueItems: vi.fn<(ids: string[]) => Promise<void>>(() => Promise.resolve()),
  deleteAssetsAsync: vi.fn<(ids: string[]) => Promise<boolean>>(() => Promise.resolve(true)),
  checkHashes: vi.fn<(shas: string[]) => Promise<{ existing: { sha256: string; id: string }[] }>>(
    async (shas) => ({ existing: shas.map((s) => ({ sha256: s, id: "r1" })) }),
  ),
}));

vi.mock("../api/client", () => ({
  api: {
    checkHashes: mocks.checkHashes,
  },
}));

vi.mock("../queue/db", () => ({
  getQueueItems: mocks.getQueueItems,
  removeQueueItems: mocks.removeQueueItems,
}));
vi.mock("expo-media-library/legacy", () => ({ deleteAssetsAsync: mocks.deleteAssetsAsync }));

const SHA = "a".repeat(64);

function item(over: Partial<QueueItem> = {}): QueueItem {
  return {
    asset_id: "asset-1",
    uri: "file:///a.jpg",
    filename: "a.jpg",
    media_type: "photo",
    created_at: 1,
    state: "done",
    sha256: SHA,
    remote_id: "r1",
    attempts: 0,
    last_error: null,
    bytes_total: 100,
    bytes_sent: 100,
    updated_at: 1,
    ...over,
  };
}

type NativeFreeSpace = typeof import("./free-space");
let fs: NativeFreeSpace;

beforeEach(async () => {
  mocks.getQueueItems.mockReset().mockReturnValue([]);
  mocks.removeQueueItems.mockReset().mockResolvedValue();
  mocks.deleteAssetsAsync.mockReset().mockResolvedValue(true);
  mocks.checkHashes.mockReset().mockImplementation(async (shas: string[]) => ({
    existing: shas.map((s) => ({ sha256: s, id: "r1" })),
  }));
  vi.resetModules();
  // @ts-expect-error -- ruta con extensión para saltar la resolución *.web.ts
  fs = await import("./free-space.ts");
});

describe("getSyncedLocal", () => {
  it("solo cuenta elementos con respaldo confirmado (done/duplicate + remote_id + sha256)", () => {
    mocks.getQueueItems.mockReturnValue([
      item({ asset_id: "A1", remote_id: "r1", bytes_total: 100 }),
      item({ asset_id: "A2", remote_id: "r2", state: "duplicate", bytes_total: 200 }),
      item({ asset_id: "A3", remote_id: "r3", bytes_total: 300 }),
      item({ asset_id: "A4", remote_id: null, state: "queued", sha256: null, bytes_total: 400 }),
      item({ asset_id: "A5", remote_id: null, state: "failed", bytes_total: 500 }),
      item({ asset_id: "A6", remote_id: null }), // completo pero sin confirmar en nube
      item({ asset_id: "A7", remote_id: "r7", sha256: null }), // sin hash confirmado
    ]);
    const res = fs.getSyncedLocal();
    expect(res.assetIds).toEqual(["A1", "A2", "A3"]);
    expect(res.totalBytes).toBe(600);
  });

  it("filtra por antigüedad cuando olderThanDays está definido", () => {
    const now = Date.now();
    const fortyDaysAgo = now - 40 * 24 * 60 * 60 * 1000;
    const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;
    mocks.getQueueItems.mockReturnValue([
      item({ asset_id: "A1", created_at: fortyDaysAgo, bytes_total: 100 }),
      item({ asset_id: "A2", created_at: tenDaysAgo, bytes_total: 200 }),
    ]);
    const res = fs.getSyncedLocal(30);
    expect(res.assetIds).toEqual(["A1"]);
    expect(res.totalBytes).toBe(100);
  });
});

describe("verifyRemoteIntegrity", () => {
  it("solo aprueba assets cuyo hash está confirmado como existente en el servidor", async () => {
    mocks.checkHashes.mockResolvedValueOnce({
      existing: [{ sha256: SHA, id: "r1" }],
    });
    const verified = await fs.verifyRemoteIntegrity([
      { asset_id: "A1", sha256: SHA },
      { asset_id: "A2", sha256: "b".repeat(64) },
    ]);
    expect(verified).toEqual(["A1"]);
  });
});

describe("freeSyncedSpace", () => {
  it("envía a eliminar únicamente los assets sincronizados", async () => {
    mocks.getQueueItems.mockReturnValue([
      item({ asset_id: "A1", remote_id: "r1" }),
      item({ asset_id: "A2", remote_id: "r2" }),
      item({ asset_id: "A3", remote_id: "r3" }),
      item({ asset_id: "A4", remote_id: null, state: "queued", sha256: null }),
      item({ asset_id: "A5", remote_id: null, state: "failed" }),
    ]);
    expect(await fs.freeSyncedSpace()).toBe(3);
    expect(mocks.deleteAssetsAsync).toHaveBeenCalledWith(["A1", "A2", "A3"]);
    expect(mocks.removeQueueItems).toHaveBeenCalledWith(["A1", "A2", "A3"]);
  });

  it("no elimina assets cuya integridad remota no esté confirmada por el servidor", async () => {
    mocks.getQueueItems.mockReturnValue([
      item({ asset_id: "A1", remote_id: "r1", sha256: SHA }),
      item({ asset_id: "A2", remote_id: "r2", sha256: "b".repeat(64) }),
    ]);
    mocks.checkHashes.mockResolvedValueOnce({
      existing: [{ sha256: SHA, id: "r1" }],
    });
    expect(await fs.freeSyncedSpace()).toBe(1);
    expect(mocks.deleteAssetsAsync).toHaveBeenCalledWith(["A1"]);
    expect(mocks.removeQueueItems).toHaveBeenCalledWith(["A1"]);
  });

  it("devuelve 0 si el usuario cancela el diálogo del sistema", async () => {
    mocks.getQueueItems.mockReturnValue([item()]);
    mocks.deleteAssetsAsync.mockResolvedValue(false);
    expect(await fs.freeSyncedSpace()).toBe(0);
    expect(mocks.removeQueueItems).not.toHaveBeenCalled();
  });

  it("devuelve 0 sin nada que liberar y no toca MediaLibrary", async () => {
    mocks.getQueueItems.mockReturnValue([
      item({ asset_id: "A1", remote_id: null, state: "uploading_original", sha256: SHA }),
    ]);
    expect(await fs.freeSyncedSpace()).toBe(0);
    expect(mocks.deleteAssetsAsync).not.toHaveBeenCalled();
    expect(mocks.removeQueueItems).not.toHaveBeenCalled();
  });
});

describe("deleteLocalCopy", () => {
  it("elimina la copia local y purga el item de la cola", async () => {
    mocks.getQueueItems.mockReturnValue([item({ asset_id: "A1", remote_id: "r1" })]);
    const ok = await fs.deleteLocalCopy("r1");
    expect(ok).toBe(true);
    expect(mocks.deleteAssetsAsync).toHaveBeenCalledWith(["A1"]);
    expect(mocks.removeQueueItems).toHaveBeenCalledWith(["A1"]);
  });

  it("devuelve false si el elemento no existe en la cola", async () => {
    mocks.getQueueItems.mockReturnValue([]);
    const ok = await fs.deleteLocalCopy("r1");
    expect(ok).toBe(false);
    expect(mocks.deleteAssetsAsync).not.toHaveBeenCalled();
    expect(mocks.removeQueueItems).not.toHaveBeenCalled();
  });

  it("devuelve false si el usuario cancela la eliminación", async () => {
    mocks.getQueueItems.mockReturnValue([item({ asset_id: "A1", remote_id: "r1" })]);
    mocks.deleteAssetsAsync.mockResolvedValue(false);
    const ok = await fs.deleteLocalCopy("r1");
    expect(ok).toBe(false);
    expect(mocks.removeQueueItems).not.toHaveBeenCalled();
  });
});

describe("hasLocalCopy", () => {
  it("distingue elemento con copia local de uno solo-remoto", () => {
    mocks.getQueueItems.mockReturnValue([item({ remote_id: "r1" })]);
    expect(fs.hasLocalCopy("r1")).toBe(true);
    expect(fs.hasLocalCopy("rX")).toBe(false);
  });
});

describe("deleteLocalAssets", () => {
  it("elimina assets locales por su id y limpia la cola", async () => {
    mocks.deleteAssetsAsync.mockResolvedValue(true);
    const count = await fs.deleteLocalAssets(["A1", "A2"]);
    expect(count).toBe(2);
    expect(mocks.deleteAssetsAsync).toHaveBeenCalledWith(["A1", "A2"]);
    expect(mocks.removeQueueItems).toHaveBeenCalledWith(["A1", "A2"]);
  });

  it("devuelve 0 si la lista está vacía", async () => {
    const count = await fs.deleteLocalAssets([]);
    expect(count).toBe(0);
    expect(mocks.deleteAssetsAsync).not.toHaveBeenCalled();
    expect(mocks.removeQueueItems).not.toHaveBeenCalled();
  });

  it("devuelve 0 si el usuario cancela la eliminación", async () => {
    mocks.deleteAssetsAsync.mockResolvedValue(false);
    const count = await fs.deleteLocalAssets(["A1"]);
    expect(count).toBe(0);
    expect(mocks.removeQueueItems).not.toHaveBeenCalled();
  });
});

describe("deleteLocalAsset", () => {
  it("elimina un solo asset por su id", async () => {
    mocks.deleteAssetsAsync.mockResolvedValue(true);
    const ok = await fs.deleteLocalAsset("A1");
    expect(ok).toBe(true);
    expect(mocks.deleteAssetsAsync).toHaveBeenCalledWith(["A1"]);
    expect(mocks.removeQueueItems).toHaveBeenCalledWith(["A1"]);
  });

  it("devuelve false si la eliminación falla o se cancela", async () => {
    mocks.deleteAssetsAsync.mockResolvedValue(false);
    const ok = await fs.deleteLocalAsset("A1");
    expect(ok).toBe(false);
  });
});
