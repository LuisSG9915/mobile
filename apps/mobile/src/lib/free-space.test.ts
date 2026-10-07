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
  deleteAssetsAsync: vi.fn<(ids: string[]) => Promise<boolean>>(() => Promise.resolve(true)),
}));

vi.mock("../queue/db", () => ({ getQueueItems: mocks.getQueueItems }));
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
  mocks.deleteAssetsAsync.mockReset().mockResolvedValue(true);
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
    expect(fs.getSyncedLocal()).toEqual({ assetIds: ["A1", "A2", "A3"], totalBytes: 600 });
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
  });

  it("devuelve 0 si el usuario cancela el diálogo del sistema", async () => {
    mocks.getQueueItems.mockReturnValue([item()]);
    mocks.deleteAssetsAsync.mockResolvedValue(false);
    expect(await fs.freeSyncedSpace()).toBe(0);
  });

  it("devuelve 0 sin nada que liberar y no toca MediaLibrary", async () => {
    mocks.getQueueItems.mockReturnValue([
      item({ asset_id: "A1", remote_id: null, state: "uploading_original", sha256: SHA }),
    ]);
    expect(await fs.freeSyncedSpace()).toBe(0);
    expect(mocks.deleteAssetsAsync).not.toHaveBeenCalled();
  });
});

describe("hasLocalCopy", () => {
  it("distingue elemento con copia local de uno solo-remoto", () => {
    mocks.getQueueItems.mockReturnValue([item({ remote_id: "r1" })]);
    expect(fs.hasLocalCopy("r1")).toBe(true);
    expect(fs.hasLocalCopy("rX")).toBe(false);
  });
});
