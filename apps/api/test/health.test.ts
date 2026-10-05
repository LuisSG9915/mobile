import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { j } from "./helpers";

describe("health", () => {
  it("responde ok", async () => {
    const res = await SELF.fetch("http://localhost/health");
    expect(res.status).toBe(200);
    expect(await j(res)).toEqual({ ok: true });
  });

  it("ruta desconocida → 404 con formato de error", async () => {
    const res = await SELF.fetch("http://localhost/nope");
    expect(res.status).toBe(404);
    const body = await j(res);
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("message");
  });
});
