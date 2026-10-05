import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authed, createUser, initBody, j, sha } from "./helpers";

async function init(cookie: string, body: Record<string, unknown>) {
  return SELF.fetch(
    "http://localhost/v1/uploads/init",
    authed(cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("uploads/init", () => {
  it("crea subida nueva → 201 con dos URLs prefirmadas", async () => {
    const { cookie, userId } = await createUser();
    const body = initBody({ sha256: sha("bb11") });
    const res = await init(cookie, body);
    expect(res.status).toBe(201);
    const json = await j(res);
    expect(json.status).toBe("upload");
    expect(json.id).toBeTruthy();
    for (const target of [json.thumb, json.original]) {
      expect(target.url).toContain("X-Amz-Signature");
      expect(target.headers["content-type"]).toBeTruthy();
    }
    expect(json.thumb.url).toContain(`users/${userId}/thumbs/${body.sha256}.webp`);
    expect(json.original.url).toContain(`users/${userId}/originals/${body.sha256}.jpg`);
  });

  it("sha256 inválido → 400", async () => {
    const { cookie } = await createUser();
    const res = await init(cookie, initBody({ sha256: "nope" }));
    expect(res.status).toBe(400);
  });

  it("miniatura > 50KB → 400", async () => {
    const { cookie } = await createUser();
    const res = await init(cookie, initBody({ thumbSize: 60_000 }));
    expect(res.status).toBe(400);
  });

  it("extensión no permitida → 400", async () => {
    const { cookie } = await createUser();
    const res = await init(cookie, initBody({ ext: "exe", mimeType: "application/x-msdownload" }));
    expect(res.status).toBe(400);
  });

  it("mismo usuario y sha ya 'ready' → duplicate", async () => {
    const { cookie } = await createUser();
    const body = initBody({ sha256: sha("cc22") });
    const r1 = await init(cookie, body);
    const j1 = await j(r1);
    // Simular subida a R2
    await env.BUCKET.put(
      `users/${await userIdOf(cookie)}/thumbs/${body.sha256}.webp`,
      "x".repeat(body.thumbSize),
    );
    const me = await userIdOf(cookie);
    await env.BUCKET.put(`users/${me}/originals/${body.sha256}.jpg`, "x".repeat(body.fileSize));
    const c = await SELF.fetch(
      `http://localhost/v1/uploads/${j1.id}/complete`,
      authed(cookie, { method: "POST" }),
    );
    expect(c.status).toBe(200);
    const r2 = await init(cookie, body);
    expect(r2.status).toBe(200);
    const j2 = await j(r2);
    expect(j2.status).toBe("duplicate");
    expect(j2.id).toBe(j1.id);
  });

  it("mismo sha en otro usuario → subida independiente", async () => {
    const a = await createUser();
    const b = await createUser();
    const shared = sha("dd33");
    const ra = await init(a.cookie, initBody({ sha256: shared }));
    const rb = await init(b.cookie, initBody({ sha256: shared }));
    const [ja, jb] = [await j(ra), await j(rb)];
    expect(ja.status).toBe("upload");
    expect(jb.status).toBe("upload");
    expect(ja.id).not.toBe(jb.id);
    expect(ja.original.url).not.toBe(jb.original.url);
  });
});

async function userIdOf(cookie: string): Promise<string> {
  const res = await SELF.fetch("http://localhost/api/auth/get-session", {
    headers: { cookie },
  });
  const body = await j(res);
  return body.user.id;
}
