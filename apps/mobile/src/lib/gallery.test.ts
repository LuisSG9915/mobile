import type { TimelineItem } from "@photos/shared";
import { describe, expect, it } from "vitest";
import type { QueueItem, QueueState } from "../queue/types";
import { buildGalleryRows, type LocalAsset, mergeGallery, queueStateToSyncStatus } from "./gallery";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function makeQueue(over: Partial<QueueItem> = {}): QueueItem {
  return {
    asset_id: "asset-1",
    uri: "file:///local/1.jpg",
    filename: "1.jpg",
    media_type: "photo",
    created_at: 1_000,
    state: "queued",
    sha256: null,
    remote_id: null,
    attempts: 0,
    last_error: null,
    bytes_total: 0,
    bytes_sent: 0,
    updated_at: 1_000,
    ...over,
  };
}

function makeRemote(over: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: "remote-1",
    sha256: SHA_A,
    mediaType: "photo",
    takenAt: 1_000,
    width: 100,
    height: 100,
    durationMs: null,
    thumbhash: "hash",
    thumbUrl: "https://example.com/t.webp",
    ...over,
  };
}

function makeLocal(over: Partial<LocalAsset> = {}): LocalAsset {
  return {
    id: "asset-1",
    uri: "file:///local/1.jpg",
    mediaType: "photo",
    creationTime: 1_000,
    width: 100,
    height: 100,
    ...over,
  };
}

describe("queueStateToSyncStatus", () => {
  it.each([
    ["queued", "PENDING"],
    ["hashing", "SYNCING"],
    ["thumbnailing", "SYNCING"],
    ["init", "SYNCING"],
    ["uploading_thumb", "SYNCING"],
    ["uploading_original", "SYNCING"],
    ["completing", "SYNCING"],
    ["done", "SYNCED"],
    ["duplicate", "SYNCED"],
    ["failed", "FAILED"],
  ] as [QueueState, string][])("mapea %s → %s", (state, expected) => {
    expect(queueStateToSyncStatus(state)).toBe(expected);
  });
});

describe("mergeGallery", () => {
  it("asset local sin cola ni remoto es LOCAL_ONLY", () => {
    const [p] = mergeGallery({
      localAssets: [makeLocal()],
      queueItems: [],
      remoteItems: [],
    });
    expect(p.syncStatus).toBe("LOCAL_ONLY");
    expect(p.localUri).toBe("file:///local/1.jpg");
    expect(p.assetId).toBe("asset-1");
  });

  it("item encolado es PENDING y reclama su asset local", () => {
    const photos = mergeGallery({
      localAssets: [makeLocal()],
      queueItems: [makeQueue()],
      remoteItems: [],
    });
    // Una sola foto: la local queda absorbida por la entrada de la cola.
    expect(photos).toHaveLength(1);
    expect(photos[0].syncStatus).toBe("PENDING");
    expect(photos[0].progress).toBeNull();
  });

  it("item subiendo es SYNCING con progreso derivado de bytes", () => {
    const [p] = mergeGallery({
      localAssets: [makeLocal()],
      queueItems: [makeQueue({ state: "uploading_original", bytes_total: 1000, bytes_sent: 500 })],
      remoteItems: [],
    });
    expect(p.syncStatus).toBe("SYNCING");
    expect(p.progress).toBe(0.5);
  });

  it("SYNCING sin bytes conocidos reporta progreso indeterminado", () => {
    const [p] = mergeGallery({
      localAssets: [],
      queueItems: [makeQueue({ state: "hashing" })],
      remoteItems: [],
    });
    expect(p.syncStatus).toBe("SYNCING");
    expect(p.progress).toBeNull();
  });

  it("item fallido es FAILED", () => {
    const [p] = mergeGallery({
      localAssets: [makeLocal()],
      queueItems: [makeQueue({ state: "failed", last_error: "red" })],
      remoteItems: [],
    });
    expect(p.syncStatus).toBe("FAILED");
  });

  it("colisión completa: local + done + remoto se fusionan en UN SYNCED", () => {
    const photos = mergeGallery({
      localAssets: [makeLocal()],
      queueItems: [makeQueue({ state: "done", remote_id: "remote-1", sha256: SHA_A })],
      remoteItems: [makeRemote({ id: "remote-1", sha256: SHA_A })],
    });
    expect(photos).toHaveLength(1);
    const p = photos[0];
    expect(p.syncStatus).toBe("SYNCED");
    expect(p.localUri).toBe("file:///local/1.jpg"); // conserva el acceso local
    expect(p.thumbUrl).toBe("https://example.com/t.webp"); // y la miniatura remota
    expect(p.remoteId).toBe("remote-1");
  });

  it("duplicate también resuelve a SYNCED enlazado al remoto", () => {
    const [p] = mergeGallery({
      localAssets: [makeLocal()],
      queueItems: [makeQueue({ state: "duplicate", remote_id: "remote-1" })],
      remoteItems: [makeRemote()],
    });
    expect(p.syncStatus).toBe("SYNCED");
    expect(p.remoteId).toBe("remote-1");
  });

  it("enlaza por sha256 cuando remote_id falta (dedup del servidor)", () => {
    const photos = mergeGallery({
      localAssets: [makeLocal()],
      queueItems: [makeQueue({ state: "done", sha256: SHA_A, remote_id: null })],
      remoteItems: [makeRemote({ sha256: SHA_A })],
    });
    expect(photos).toHaveLength(1);
    expect(photos[0].syncStatus).toBe("SYNCED");
    expect(photos[0].remoteId).toBe("remote-1");
  });

  it("done sin asset local pero con remoto es REMOTE_ONLY (archivo borrado)", () => {
    const [p] = mergeGallery({
      localAssets: [],
      queueItems: [makeQueue({ state: "done", remote_id: "remote-1" })],
      remoteItems: [makeRemote()],
    });
    expect(p.syncStatus).toBe("REMOTE_ONLY");
    expect(p.thumbUrl).toBe("https://example.com/t.webp");
    expect(p.localUri).toBeNull();
  });

  it("done sin remoto cargado aún pero con local sigue siendo SYNCED", () => {
    // El remoto puede estar en una página del timeline no descargada todavía.
    const [p] = mergeGallery({
      localAssets: [makeLocal()],
      queueItems: [makeQueue({ state: "done", remote_id: "remote-1" })],
      remoteItems: [],
    });
    expect(p.syncStatus).toBe("SYNCED");
  });

  it("done sin local ni remoto visible no emite tile", () => {
    const photos = mergeGallery({
      localAssets: [],
      queueItems: [makeQueue({ state: "done", remote_id: "remote-1" })],
      remoteItems: [],
    });
    expect(photos).toHaveLength(0);
  });

  it("remoto sin cola ni local es REMOTE_ONLY", () => {
    const [p] = mergeGallery({
      localAssets: [],
      queueItems: [],
      remoteItems: [makeRemote()],
    });
    expect(p.syncStatus).toBe("REMOTE_ONLY");
    expect(p.localUri).toBeNull();
    expect(p.remoteId).toBe("remote-1");
  });

  it("dos assets locales distintos que apuntan al mismo remoto no se pierden", () => {
    const photos = mergeGallery({
      localAssets: [makeLocal({ id: "a1" }), makeLocal({ id: "a2", uri: "file:///2.jpg" })],
      queueItems: [
        makeQueue({ asset_id: "a1", state: "done", remote_id: "remote-1" }),
        makeQueue({
          asset_id: "a2",
          uri: "file:///2.jpg",
          state: "duplicate",
          remote_id: "remote-1",
        }),
      ],
      remoteItems: [makeRemote()],
    });
    // Dos archivos físicos = dos tiles; el remoto reclamado no se repite.
    expect(photos).toHaveLength(2);
    expect(photos.every((p) => p.syncStatus === "SYNCED")).toBe(true);
    expect(photos.every((p) => p.remoteId === "remote-1")).toBe(true);
  });

  it("ordena por fecha de captura descendente", () => {
    const photos = mergeGallery({
      localAssets: [
        makeLocal({ id: "old", uri: "file:///old.jpg", creationTime: 100 }),
        makeLocal({ id: "new", uri: "file:///new.jpg", creationTime: 300 }),
      ],
      queueItems: [],
      remoteItems: [makeRemote({ id: "mid", sha256: SHA_B, takenAt: 200 })],
    });
    expect(photos.map((p) => p.key)).toEqual(["l-new", "r-mid", "l-old"]);
  });
});

describe("buildGalleryRows", () => {
  it("agrupa en Hoy / Ayer / mes con encabezados adhesivos", () => {
    // now fijo: miércoles 15 de octubre de 2025, mediodía.
    const now = new Date(2025, 9, 15, 12).getTime();
    const hoy = new Date(2025, 9, 15, 9).getTime();
    const ayer = new Date(2025, 9, 14, 22).getTime();
    const septiembre = new Date(2025, 8, 1).getTime();
    const rows = buildGalleryRows(
      mergeGallery({
        localAssets: [
          makeLocal({ id: "hoy", uri: "u1", creationTime: hoy }),
          makeLocal({ id: "ayer", uri: "u2", creationTime: ayer }),
          makeLocal({ id: "sep", uri: "u3", creationTime: septiembre }),
        ],
        queueItems: [],
        remoteItems: [],
      }),
      now,
    );
    const labels = rows.filter((r) => r.type === "header").map((r) => r.label);
    expect(labels).toEqual(["Hoy", "Ayer", "Septiembre de 2025"]);
    expect(rows[0].type).toBe("header");
    expect(rows.filter((r) => r.type === "photo")).toHaveLength(3);
  });

  it("no repite el encabezado dentro del mismo día", () => {
    const now = new Date(2025, 9, 15, 12).getTime();
    const rows = buildGalleryRows(
      mergeGallery({
        localAssets: [
          makeLocal({ id: "a", uri: "u1", creationTime: now - 60_000 }),
          makeLocal({ id: "b", uri: "u2", creationTime: now - 120_000 }),
        ],
        queueItems: [],
        remoteItems: [],
      }),
      now,
    );
    expect(rows.filter((r) => r.type === "header")).toHaveLength(1);
  });
});
