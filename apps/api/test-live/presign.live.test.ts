import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/env";
import { presignGet, presignPut } from "../src/lib/s3";

const env = {
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ?? "",
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? "",
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? "",
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME ?? "photos-media-dev",
  PRESIGN_TTL_SECONDS: "900",
} as Bindings;

const hasCreds = !!(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);

describe.skipIf(!hasCreds)("R2 presign (live)", () => {
  const key = `live-test/${Date.now()}.webp`;
  const payload = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]); // RIFF header fake

  it("PUT prefirmado sube el objeto y GET prefirmado lo lee", async () => {
    const put = await presignPut(env, key, "image/webp", payload.byteLength);
    expect(put.url).toContain("X-Amz-Signature");

    const putRes = await fetch(put.url, {
      method: "PUT",
      headers: put.headers,
      body: payload,
    });
    expect(putRes.status).toBe(200);

    const getUrl = await presignGet(env, key);
    const getRes = await fetch(getUrl);
    expect(getRes.status).toBe(200);
    const bytes = new Uint8Array(await getRes.arrayBuffer());
    expect(bytes).toEqual(payload);
  });

  it("PUT con firma manipulada → 403", async () => {
    const key2 = `live-test/${Date.now()}-bad.webp`;
    const put = await presignPut(env, key2, "image/webp", 8);
    const tampered = put.url.replace(/X-Amz-Signature=[0-9a-f]{63}([0-9a-f])/, (m, c) =>
      m.replace(/[0-9a-f]$/, c === "0" ? "1" : "0"),
    );
    expect(tampered).not.toBe(put.url);
    const res = await fetch(tampered, {
      method: "PUT",
      headers: put.headers,
      body: payload,
    });
    expect(res.status).toBe(403);
  });
});
