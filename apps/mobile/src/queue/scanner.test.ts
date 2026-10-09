import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPermissionsAsync = vi.fn();
const mockGetAssetsAsync = vi.fn();
let mockLastScanTs = 0;
const mockSetLastScanTs = vi.fn((ts: number) => {
  mockLastScanTs = ts;
});
const mockEnqueueAssetsBatch = vi.fn();
const mockLibraryEmit = vi.fn();

vi.mock("expo-media-library/legacy", () => ({
  MediaType: { photo: "photo", video: "video" },
  SortBy: { creationTime: "creationTime" },
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  getAssetsAsync: (...args: unknown[]) => mockGetAssetsAsync(...args),
}));

const mockClearQueue = vi.fn();
const mockPruneQueueExcept = vi.fn();
const mockCancelQueue = vi.fn();

vi.mock("./db", () => ({
  getLastScanTs: () => mockLastScanTs,
  setLastScanTs: (ts: number) => mockSetLastScanTs(ts),
  enqueueAssetsBatch: (batch: unknown[]) => mockEnqueueAssetsBatch(batch),
  clearQueue: () => mockClearQueue(),
  pruneQueueExcept: (set: Set<string>) => mockPruneQueueExcept(set),
}));

vi.mock("./processor", () => ({
  cancelQueue: () => mockCancelQueue(),
}));

vi.mock("../lib/events", () => ({
  useLibraryEvents: {
    getState: () => ({ emit: mockLibraryEmit }),
  },
}));

let mockSettings = { includeVideos: true, syncedAlbumIds: null as string[] | null };

vi.mock("../lib/store", () => ({
  useSettings: {
    getState: () => mockSettings,
  },
}));

// Importar explícitamente scanner.ts para evitar que vitest resuelva scanner.web.ts
async function importNativeScanner() {
  vi.resetModules();
  // @ts-expect-error -- import nativo explícito
  return await import("./scanner.ts");
}

describe("scanLibrary (nativo incremental / delta)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = { includeVideos: true, syncedAlbumIds: null };
    mockLastScanTs = 0;
    mockGetPermissionsAsync.mockResolvedValue({ granted: true });
    mockGetAssetsAsync.mockResolvedValue({
      assets: [],
      hasNextPage: false,
    });
  });

  it("devuelve { added: 0, skipped: 0 } si los permisos no fueron otorgados", async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: false });
    const { scanLibrary } = await importNativeScanner();
    const result = await scanLibrary();

    expect(result).toEqual({ added: 0, skipped: 0 });
    expect(mockGetAssetsAsync).not.toHaveBeenCalled();
  });

  it("en el primer escaneo (lastScan == 0) no incluye createdAfter (escaneo completo)", async () => {
    mockLastScanTs = 0;
    const { scanLibrary } = await importNativeScanner();
    await scanLibrary();

    expect(mockGetAssetsAsync).toHaveBeenCalledWith(
      expect.not.objectContaining({ createdAfter: expect.anything() }),
    );
    expect(mockSetLastScanTs).toHaveBeenCalled();
    expect(mockLibraryEmit).toHaveBeenCalled();
  });

  it("en escaneo subsiguiente usa createdAfter = lastScan - 24 horas", async () => {
    const fixedScanTs = 1_700_000_000_000;
    mockLastScanTs = fixedScanTs;
    const { scanLibrary } = await importNativeScanner();
    await scanLibrary();

    const expectedCreatedAfter = fixedScanTs - 24 * 60 * 60 * 1000;
    expect(mockGetAssetsAsync).toHaveBeenCalledWith(
      expect.objectContaining({ createdAfter: expectedCreatedAfter }),
    );
  });

  it("con forceScan: true omite createdAfter incluso habiendo escaneo previo", async () => {
    mockLastScanTs = 1_700_000_000_000;
    const { scanLibrary } = await importNativeScanner();
    await scanLibrary({ forceScan: true });

    expect(mockGetAssetsAsync).toHaveBeenCalledWith(
      expect.not.objectContaining({ createdAfter: expect.anything() }),
    );
  });

  it("filtra extensiones no soportadas y normaliza creationTime", async () => {
    mockGetAssetsAsync.mockResolvedValue({
      assets: [
        {
          id: "1",
          uri: "file:///test1.jpg",
          filename: "test1.jpg",
          mediaType: "photo",
          creationTime: 1700000000, // en segundos
        },
        {
          id: "2",
          uri: "file:///test2.raw",
          filename: "test2.raw",
          mediaType: "photo",
          creationTime: 1700000000,
        },
      ],
      hasNextPage: false,
    });

    const { scanLibrary } = await importNativeScanner();
    const result = await scanLibrary();

    expect(result).toEqual({ added: 1, skipped: 1 });
    expect(mockEnqueueAssetsBatch).toHaveBeenCalledWith([
      {
        id: "1",
        uri: "file:///test1.jpg",
        filename: "test1.jpg",
        mediaType: "photo",
        creationTime: 1700000000 * 1000,
      },
    ]);
  });

  it("si syncedAlbumIds es un arreglo vacío, no escanea nada, cancela la cola, la limpia y retorna { added: 0, skipped: 0 }", async () => {
    mockSettings = { includeVideos: true, syncedAlbumIds: [] };
    const { scanLibrary } = await importNativeScanner();
    const result = await scanLibrary();

    expect(result).toEqual({ added: 0, skipped: 0 });
    expect(mockGetAssetsAsync).not.toHaveBeenCalled();
    expect(mockCancelQueue).toHaveBeenCalled();
    expect(mockClearQueue).toHaveBeenCalled();
  });

  it("si syncedAlbumIds tiene álbumes configurados, escanea únicamente esos álbumes y poda si forceScan", async () => {
    mockSettings = { includeVideos: true, syncedAlbumIds: ["alb-camara", "alb-favoritos"] };
    const { scanLibrary } = await importNativeScanner();
    await scanLibrary({ forceScan: true });

    expect(mockGetAssetsAsync).toHaveBeenCalledTimes(2);
    expect(mockGetAssetsAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ album: "alb-camara" }),
    );
    expect(mockGetAssetsAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ album: "alb-favoritos" }),
    );
    expect(mockPruneQueueExcept).toHaveBeenCalled();
  });
});
