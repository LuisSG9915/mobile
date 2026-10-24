import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { j } from "./helpers";

describe("health", () => {
  it("responde ok y adjunta cabeceras de seguridad", async () => {
    const res = await SELF.fetch("http://localhost/health");
    expect(res.status).toBe(200);
    expect(await j(res)).toEqual({ ok: true });
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("GET /version expone versión y commit (o 'dev'/'unknown' sin vars)", async () => {
    const res = await SELF.fetch("http://localhost/version");
    expect(res.status).toBe(200);
    const body = await j(res);
    expect(body.service).toBe("photos-api");
    expect(typeof body.version).toBe("string");
    expect(typeof body.commit).toBe("string");
    expect(typeof body.time).toBe("string");
  });

  it("ruta desconocida → 404 con formato de error y cabeceras de seguridad", async () => {
    const res = await SELF.fetch("http://localhost/nope");
    expect(res.status).toBe(404);
    const body = await j(res);
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("message");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});
