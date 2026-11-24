import { describe, expect, it } from "vitest";
import {
  bytesNeededFor,
  DISK_MARGIN_BYTES,
  hasRoomFor,
  planRestore,
  restoreFilename,
  stateAfterError,
  stateAfterHashMismatch,
  totalBytes,
} from "./plan";

const item = (id: string, sha: string, size = 100) => ({
  id,
  sha256: sha,
  fileSize: size,
  ext: "jpg",
  mediaType: "photo" as const,
  takenAt: 1,
});

describe("planRestore", () => {
  it("omite lo que ya está en el teléfono por sha", () => {
    const out = planRestore([item("a", "s1"), item("b", "s2")], new Set(["s1"]));
    expect(out.toRestore.map((i) => i.id)).toEqual(["b"]);
    expect(out.skipped.map((i) => i.id)).toEqual(["a"]);
  });
  it("deduplica sha repetidos dentro del manifiesto", () => {
    const out = planRestore([item("a", "s1"), item("b", "s1")], new Set());
    expect(out.toRestore).toHaveLength(1);
    expect(out.skipped).toHaveLength(1);
  });
  it("suma bytes", () => {
    expect(totalBytes([item("a", "s1", 5), item("b", "s2", 7)])).toBe(12);
  });
});

describe("espacio en disco", () => {
  it("exige 2x el archivo más el margen", () => {
    expect(bytesNeededFor(10)).toBe(20 + DISK_MARGIN_BYTES);
    expect(hasRoomFor(20 + DISK_MARGIN_BYTES, 10)).toBe(true);
    expect(hasRoomFor(19 + DISK_MARGIN_BYTES, 10)).toBe(false);
  });
});

describe("transiciones", () => {
  it("errores transitorios: reintenta y falla al tercer intento", () => {
    expect(stateAfterError(0)).toEqual({ state: "queued", attempts: 1 });
    expect(stateAfterError(1)).toEqual({ state: "queued", attempts: 2 });
    expect(stateAfterError(2)).toEqual({ state: "failed", attempts: 3 });
  });
  it("hash distinto: un reintento y luego corrupt", () => {
    expect(stateAfterHashMismatch(0)).toEqual({ state: "queued", mismatches: 1 });
    expect(stateAfterHashMismatch(1)).toEqual({ state: "corrupt", mismatches: 2 });
  });
});

describe("restoreFilename", () => {
  it("usa el sha y sanea la extensión", () => {
    expect(restoreFilename({ sha256: "abcdef0123456789ffff", ext: "JP/G" })).toBe(
      "restore-abcdef0123456789.jpg",
    );
    expect(restoreFilename({ sha256: "abcdef0123456789ffff", ext: "" })).toBe(
      "restore-abcdef0123456789.bin",
    );
  });
});
