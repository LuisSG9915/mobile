import { describe, expect, it } from "vitest";
import { computeSyncProgress } from "./progress";
import type { QueueItem } from "./types";

function item(over: Partial<QueueItem> = {}): QueueItem {
  return {
    asset_id: crypto.randomUUID(),
    uri: "file:///x.jpg",
    filename: "x.jpg",
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

describe("computeSyncProgress", () => {
  it("cola vacía → idle con contadores en cero", () => {
    const p = computeSyncProgress([], false);
    expect(p.status).toBe("idle");
    expect(p.filesTotal).toBe(0);
    expect(p.bytesUploaded).toBe(0);
  });

  it("pasada en curso con pendientes → syncing y archivo actual", () => {
    const items = [
      item({ state: "done", bytes_total: 1000, bytes_sent: 1000 }),
      item({
        state: "uploading_original",
        filename: "subiendo.jpg",
        bytes_total: 2000,
        bytes_sent: 500,
      }),
      item({ state: "queued" }),
    ];
    const p = computeSyncProgress(items, true);
    expect(p.status).toBe("syncing");
    expect(p.filesTotal).toBe(3);
    expect(p.filesRemaining).toBe(2);
    expect(p.currentFileName).toBe("subiendo.jpg");
    expect(p.bytesUploaded).toBe(1500);
    expect(p.totalBytes).toBe(3000);
  });

  it("todo en estado terminal → completed", () => {
    const items = [item({ state: "done" }), item({ state: "duplicate" })];
    const p = computeSyncProgress(items, false);
    expect(p.status).toBe("completed");
    expect(p.filesRemaining).toBe(0);
  });

  it("pendientes sin pasada activa → paused (esperando wifi/red)", () => {
    const p = computeSyncProgress([item({ state: "queued" })], false);
    expect(p.status).toBe("paused");
  });

  it("con errores → error (haya o no pendientes)", () => {
    const solo = computeSyncProgress([item({ state: "failed" })], false);
    expect(solo.status).toBe("error");
    const mezcla = computeSyncProgress(
      [item({ state: "failed" }), item({ state: "queued" })],
      false,
    );
    expect(mezcla.status).toBe("error");
  });

  it("bytes_sent nunca excede bytes_total al agregar", () => {
    const items = [item({ state: "done", bytes_total: 100, bytes_sent: 250 })];
    const p = computeSyncProgress(items, false);
    expect(p.bytesUploaded).toBe(100);
  });
});
