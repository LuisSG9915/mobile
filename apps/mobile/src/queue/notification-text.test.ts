import { describe, expect, it } from "vitest";
import { describeUploadNotification } from "./notification-text";
import type { SyncProgressState } from "./types";

const base: SyncProgressState = {
  bytesUploaded: 30,
  totalBytes: 100,
  filesTotal: 10,
  filesRemaining: 7,
  currentFileName: "IMG_20260101_private.jpg",
  currentPhase: "uploading_original",
  bytesPerSecond: 0,
  etaSeconds: null,
  status: "syncing",
};

describe("describeUploadNotification", () => {
  it("resume cuenta y porcentaje por bytes, sin el nombre del archivo", () => {
    const text = describeUploadNotification(base);
    expect(text.title).toBe("Respaldando fotos y videos");
    expect(text.body).toContain("3 de 10");
    expect(text.body).toContain("30%");
    expect(text.body).not.toContain("IMG_20260101_private");
    expect(text.percent).toBe(30);
  });

  it("añade velocidad y ETA cuando hay medición", () => {
    const text = describeUploadNotification({
      ...base,
      bytesUploaded: 50,
      bytesPerSecond: 1258291,
      etaSeconds: 221,
    });
    expect(text.body).toContain("50%");
    expect(text.body).toMatch(/MB\/s/);
    expect(text.body).toContain("3:41");
  });

  it("sin archivos pendientes muestra la fase de preparación", () => {
    const text = describeUploadNotification({
      ...base,
      filesRemaining: 0,
      bytesUploaded: 100,
      totalBytes: 100,
    });
    expect(text.body).toBe("Preparando archivos…");
    expect(text.percent).toBe(100);
  });

  it("una cola vacía no divide por cero", () => {
    const text = describeUploadNotification({
      ...base,
      filesTotal: 0,
      filesRemaining: 0,
      bytesUploaded: 0,
      totalBytes: 0,
    });
    expect(text.percent).toBe(0);
    expect(text.body).toBe("Preparando archivos…");
  });
});
