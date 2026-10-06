import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256File } from "./hash";

describe("sha256File", () => {
  it("devuelve el SHA-256 conocido de un blob vacío", async () => {
    expect(await sha256File(new Blob([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("devuelve el SHA-256 conocido de 'abc'", async () => {
    expect(await sha256File(new Blob(["abc"]))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("procesa en varios chunks los blobs mayores de 4 MB", async () => {
    const bytes = new Uint8Array(4 * 1024 * 1024 + 123);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(await sha256File(new Blob([bytes]))).toBe(expected);
  });
});
