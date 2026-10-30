import { beforeEach, describe, expect, it } from "vitest";
import { useItemProgress, useSyncProgress } from "../lib/store";
import { computeSyncProgress, publishByteTick, resetRateWindow } from "./progress";
import type { QueueItem } from "./types";

beforeEach(() => {
  useItemProgress.setState({ progressByAssetId: {} });
  resetRateWindow();
});

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
    expect(p.currentPhase).toBe("uploading_original");
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

describe("publishByteTick", () => {
  it("actualiza bytes y progreso por asset sin releer la cola", () => {
    useSyncProgress.setState({
      bytesUploaded: 0,
      totalBytes: 100,
      filesTotal: 1,
      filesRemaining: 1,
      currentFileName: "foto.jpg",
      status: "syncing",
    });
    publishByteTick("tick-a", 40, 100);
    expect(useSyncProgress.getState().bytesUploaded).toBe(40);
    expect(useItemProgress.getState().progressByAssetId["tick-a"]).toBe(0.4);

    publishByteTick("tick-a", 70, 100);
    expect(useSyncProgress.getState().bytesUploaded).toBe(70);
    expect(useItemProgress.getState().progressByAssetId["tick-a"]).toBe(0.7);
  });
});

describe("useItemProgress", () => {
  it("actualiza el progreso por asset y lo limpia al terminar", () => {
    useItemProgress.getState().setItemProgress("a", 0.5);
    useItemProgress.getState().setItemProgress("b", 0.25);
    expect(useItemProgress.getState().progressByAssetId).toEqual({ a: 0.5, b: 0.25 });

    useItemProgress.getState().clearItemProgress("a");
    expect(useItemProgress.getState().progressByAssetId).toEqual({ b: 0.25 });
    useItemProgress.getState().clearItemProgress("b");
    expect(useItemProgress.getState().progressByAssetId).toEqual({});
  });

  it("clampea el progreso a 0..1", () => {
    useItemProgress.getState().setItemProgress("a", 1.5);
    expect(useItemProgress.getState().progressByAssetId.a).toBe(1);
    useItemProgress.getState().setItemProgress("a", -0.2);
    expect(useItemProgress.getState().progressByAssetId.a).toBe(0);
  });
});

describe("velocidad y ETA (ventana móvil)", () => {
  const MB = 1024 * 1024;

  it("deriva bytes por segundo y ETA de dos muestras", () => {
    const first = computeSyncProgress(
      [item({ state: "uploading_original", bytes_total: 10 * MB, bytes_sent: 0 })],
      true,
      1_000,
    );
    expect(first.bytesPerSecond).toBe(0);
    expect(first.etaSeconds).toBeNull();

    const second = computeSyncProgress(
      [item({ state: "uploading_original", bytes_total: 10 * MB, bytes_sent: 2 * MB })],
      true,
      3_000,
    );

    expect(second.bytesPerSecond).toBe(MB); // 2 MiB en 2 s
    expect(second.etaSeconds).toBe(8); // faltan 8 MiB
  });

  it("en pausa no reporta velocidad ni ETA", () => {
    computeSyncProgress([item({ state: "uploading_original", bytes_sent: 0 })], true, 1_000);
    const paused = computeSyncProgress(
      [item({ state: "uploading_original", bytes_total: 4 * MB, bytes_sent: MB })],
      false,
      3_000,
    );

    expect(paused.bytesPerSecond).toBe(0);
    expect(paused.etaSeconds).toBeNull();
  });

  it("un retroceso del contador reinicia la ventana en vez de dar velocidad negativa", () => {
    computeSyncProgress(
      [item({ state: "uploading_original", bytes_total: 10 * MB, bytes_sent: 5 * MB })],
      true,
      1_000,
    );
    const reset = computeSyncProgress(
      [item({ state: "uploading_original", bytes_total: 10 * MB, bytes_sent: 0 })],
      true,
      3_000,
    );

    expect(reset.bytesPerSecond).toBe(0);

    const afterRestart = computeSyncProgress(
      [item({ state: "uploading_original", bytes_total: 10 * MB, bytes_sent: MB })],
      true,
      4_000,
    );
    expect(afterRestart.bytesPerSecond).toBe(MB);
  });
});
