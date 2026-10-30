import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { media, userStorageStats } from "../src/db/schema";
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

async function multipartInit(cookie: string, body: Record<string, unknown>) {
  return SELF.fetch(
    "http://localhost/v1/uploads/multipart/init",
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

  it("rechaza con 413 quota_exceeded cuando la subida supera la cuota", async () => {
    const { cookie, userId } = await createUser();
    // Usuario al límite de su cuota: quedan 5 000 B, la subida pide más.
    const db = getDb(env.DB);
    await db.insert(userStorageStats).values({
      userId,
      usedBytes: 10 * 1024 * 1024 * 1024 - 5_000,
      mediaCount: 1,
      updatedAt: Date.now(),
    });

    const res = await init(cookie, initBody({ fileSize: 1_000_000, thumbSize: 8_000 }));
    expect(res.status).toBe(413);
    const json = await j(res);
    expect(json.code).toBe("quota_exceeded");
    expect(json.error).toBe("quota_exceeded");
    // No se emitieron URLs ni se materializó fila pending extra.
    expect(json.thumb).toBeUndefined();
    const rows = await db.select().from(media).where(eq(media.userId, userId)).all();
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(0);
  });

  it("rechaza con 413 file_too_large cuando el archivo supera 5 GB", async () => {
    const { cookie } = await createUser();
    const res = await init(cookie, initBody({ fileSize: 5_368_709_121 }));
    expect(res.status).toBe(413);
    const json = await j(res);
    expect(json.code).toBe("file_too_large");
    expect(json.error).toBe("file_too_large");
  });

  it("re-iniciar una subida de algo en la papelera lo restaura sin re-subir", async () => {
    const { cookie, userId } = await createUser();
    const body = initBody({ sha256: sha("77ab") });
    const id = await makeReady(cookie, userId, body);

    // A la papelera.
    const del = await SELF.fetch(
      `http://localhost/v1/media/${id}`,
      authed(cookie, { method: "DELETE" }),
    );
    expect(del.status).toBe(200);

    // Re-init con el mismo sha: restaura la fila (deletedAt → null) y
    // responde duplicate — sin PUTs ni doble conteo de cuota.
    const res = await init(cookie, body);
    expect(res.status).toBe(200);
    const json = await j(res);
    expect(json.status).toBe("duplicate");
    expect(json.id).toBe(id);

    const db = getDb(env.DB);
    const row = await db.select().from(media).where(eq(media.id, id)).get();
    expect(row?.deletedAt).toBeNull();
  });

  it("un segundo /complete del mismo id no duplica la cuota", async () => {
    const { cookie, userId } = await createUser();
    const body = initBody({ sha256: sha("dc88"), fileSize: 100_000, thumbSize: 1_000 });
    const id = await makeReady(cookie, userId, body);

    // Llamada idempotente repetida (retry del cliente tras timeout, p. ej.).
    const again = await SELF.fetch(
      `http://localhost/v1/uploads/${id}/complete`,
      authed(cookie, { method: "POST" }),
    );
    expect(again.status).toBe(200);

    const db = getDb(env.DB);
    const stats = await db
      .select()
      .from(userStorageStats)
      .where(eq(userStorageStats.userId, userId))
      .get();
    expect(stats?.usedBytes).toBe(101_000);
    expect(stats?.mediaCount).toBe(1);
  });

  it("dos POST /uploads/init concurrentes que exceden la cuota → exactamente uno 201 y uno 413", async () => {
    const { cookie, userId } = await createUser();
    const db = getDb(env.DB);
    // Establecer cuota con 4 GB usados (quedan 6 GB disponibles de 10 GB)
    await db.insert(userStorageStats).values({
      userId,
      usedBytes: 4 * 1024 * 1024 * 1024,
      reservedBytes: 0,
      mediaCount: 1,
      updatedAt: Date.now(),
    });

    // Dos archivos de 4 GB cada uno: individualmente caben (4 + 4 = 8 <= 10 GB), pero juntos suman 4 + 4 + 4 = 12 GB > 10 GB
    const bodyA = initBody({ sha256: sha("ca11"), fileSize: 4 * 1024 * 1024 * 1024 });
    const bodyB = initBody({ sha256: sha("cb22"), fileSize: 4 * 1024 * 1024 * 1024 });

    const [resA, resB] = await Promise.all([init(cookie, bodyA), init(cookie, bodyB)]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 413]);

    const res413 = resA.status === 413 ? resA : resB;
    const json413 = await j(res413);
    expect(json413.code).toBe("quota_exceeded");

    // Verificar que reservedBytes solo tiene la reserva del que tuvo éxito
    const stats = await db
      .select()
      .from(userStorageStats)
      .where(eq(userStorageStats.userId, userId))
      .get();
    expect(stats?.reservedBytes).toBe(4 * 1024 * 1024 * 1024 + 8_000); // 4 GB + thumbSize
  });
});

/** init + objetos en R2 + complete: deja el media en estado 'ready'. */
async function makeReady(cookie: string, userId: string, body: Record<string, unknown>) {
  const r = await init(cookie, body);
  const created = await j(r);
  const sha256 = body.sha256 as string;
  await env.BUCKET.put(
    `users/${userId}/thumbs/${sha256}.webp`,
    "x".repeat(body.thumbSize as number),
    { httpMetadata: { contentType: "image/webp" } },
  );
  await env.BUCKET.put(
    `users/${userId}/originals/${sha256}.${body.ext}`,
    "x".repeat(body.fileSize as number),
    { httpMetadata: { contentType: body.mimeType as string } },
  );
  const c = await SELF.fetch(
    `http://localhost/v1/uploads/${created.id}/complete`,
    authed(cookie, { method: "POST" }),
  );
  expect(c.status).toBe(200);
  return created.id as string;
}

describe("uploads/check-hashes", () => {
  const check = (cookie: string, hashes: string[]) =>
    SELF.fetch(
      "http://localhost/v1/uploads/check-hashes",
      authed(cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sha256: hashes }),
      }),
    );

  it("devuelve solo los hashes ya respaldados (ready)", async () => {
    const { cookie, userId } = await createUser();
    const body = initBody({ sha256: sha("ee11") });
    const id = await makeReady(cookie, userId, body);

    const res = await check(cookie, [body.sha256 as string, sha("dead"), sha("beef")]);
    expect(res.status).toBe(200);
    const json = await j(res);
    expect(json.existing).toEqual([{ sha256: body.sha256, id }]);
  });

  it("ignora medias 'pending' (subida no confirmada)", async () => {
    const { cookie } = await createUser();
    const body = initBody({ sha256: sha("ff22") });
    await init(cookie, body); // queda 'pending': nunca se llama a /complete

    const res = await check(cookie, [body.sha256 as string]);
    const json = await j(res);
    expect(json.existing).toEqual([]);
  });

  it("no filtra hashes de otro usuario", async () => {
    const a = await createUser();
    const b = await createUser();
    const body = initBody({ sha256: sha("aa33") });
    await makeReady(a.cookie, a.userId, body);

    const res = await check(b.cookie, [body.sha256 as string]);
    const json = await j(res);
    expect(json.existing).toEqual([]);
  });

  it("sin sesión → 401; hash inválido → 400", async () => {
    const anon = await SELF.fetch("http://localhost/v1/uploads/check-hashes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sha256: [sha("x")] }),
    });
    expect(anon.status).toBe(401);

    const { cookie } = await createUser();
    const bad = await check(cookie, ["no-es-hex"]);
    expect(bad.status).toBe(400);
  });
});

describe("user/storage", () => {
  const storage = (cookie: string) =>
    SELF.fetch("http://localhost/v1/user/storage", authed(cookie));

  it("sin sesión → 401", async () => {
    const res = await SELF.fetch("http://localhost/v1/user/storage");
    expect(res.status).toBe(401);
  });

  it("usuario sin medios → cuota vacía con maxBytes por defecto", async () => {
    const { cookie } = await createUser();
    const res = await storage(cookie);
    expect(res.status).toBe(200);
    const json = await j(res);
    expect(json.usedBytes).toBe(0);
    expect(json.mediaCount).toBe(0);
    expect(json.maxBytes).toBe(10 * 1024 * 1024 * 1024);
    expect(json.usedPercent).toBe(0);
  });

  it("suma bytes y medios al confirmar; ignora pendientes y duplicados", async () => {
    const { cookie, userId } = await createUser();
    const body = initBody({ sha256: sha("ab44"), fileSize: 2_000_000, thumbSize: 10_000 });
    await makeReady(cookie, userId, body);

    let json = await j(await storage(cookie));
    expect(json.usedBytes).toBe(2_010_000); // original + miniatura
    expect(json.mediaCount).toBe(1);
    expect(json.usedPercent).toBeGreaterThan(0);

    const body2 = initBody({ sha256: sha("cd55"), fileSize: 500_000, thumbSize: 5_000 });
    await makeReady(cookie, userId, body2);
    json = await j(await storage(cookie));
    expect(json.usedBytes).toBe(2_515_000);
    expect(json.mediaCount).toBe(2);

    // El duplicado (mismo sha ya 'ready') no vuelve a contar
    const dup = await init(cookie, body);
    expect((await j(dup)).status).toBe("duplicate");
    // El pendiente (init sin complete) tampoco cuenta
    await init(cookie, initBody({ sha256: sha("ef66"), fileSize: 9_000_000 }));
    json = await j(await storage(cookie));
    expect(json.usedBytes).toBe(2_515_000);
    expect(json.mediaCount).toBe(2);
  });
});

describe("date_group", () => {
  it("deriva YYYY-MM-DD (UTC) de takenAt y lo expone en el timeline", async () => {
    const { cookie, userId } = await createUser();
    const body = initBody({ sha256: sha("ab77"), takenAt: Date.UTC(2024, 0, 15, 12) });
    await makeReady(cookie, userId, body);

    const res = await SELF.fetch("http://localhost/v1/timeline", authed(cookie));
    const json = await j(res);
    const item = json.items.find((i: { sha256: string }) => i.sha256 === body.sha256);
    expect(item).toBeTruthy();
    expect(item.dateGroup).toBe("2024-01-15");
  });
});

describe("uploads con preview", () => {
  it("crea subida con preview → 201 con preview presignada", async () => {
    const { cookie, userId } = await createUser();
    const body = initBody({ sha256: sha("ee11"), previewSize: 120_000 });
    const res = await init(cookie, body);
    expect(res.status).toBe(201);
    const json = await j(res);
    expect(json.status).toBe("upload");
    expect(json.preview).toBeTruthy();
    expect(json.preview.url).toContain("X-Amz-Signature");
    expect(json.preview.url).toContain(`users/${userId}/previews/${body.sha256}.webp`);
  });
});

describe("uploads/multipart", () => {
  it("inicia subida multipart → 201 con uploadId y totalParts", async () => {
    const { cookie } = await createUser();
    const body = initBody({
      sha256: sha("ff22"),
      fileSize: 25 * 1024 * 1024,
      previewSize: 150_000,
    });
    const res = await SELF.fetch(
      "http://localhost/v1/uploads/multipart/init",
      authed(cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(201);
    const json = await j(res);
    expect(json.status).toBe("upload");
    expect(json.uploadId).toBeTruthy();
    expect(json.totalParts).toBe(2); // 25 MB / 16 MB = 2
    expect(json.thumb).toBeTruthy();
    expect(json.preview).toBeTruthy();

    // Presign parts
    const presignRes = await SELF.fetch(
      "http://localhost/v1/uploads/multipart/presign-parts",
      authed(cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: json.id,
          uploadId: json.uploadId,
          partNumbers: [1, 2],
        }),
      }),
    );
    expect(presignRes.status).toBe(200);
    const presignJson = await j(presignRes);
    expect(presignJson.parts.length).toBe(2);
    expect(presignJson.parts[0].partNumber).toBe(1);
    expect(presignJson.parts[0].url).toContain("X-Amz-Signature");

    // Abort
    const abortRes = await SELF.fetch(
      "http://localhost/v1/uploads/multipart/abort",
      authed(cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: json.id,
          uploadId: json.uploadId,
        }),
      }),
    );
    expect(abortRes.status).toBe(200);
    const abortJson = await j(abortRes);
    expect(abortJson.ok).toBe(true);
  });

  it("reanuda la misma MPU cuando el cliente manda el uploadId", async () => {
    const { cookie } = await createUser();
    const body = initBody({
      sha256: sha("b1"),
      fileSize: 25 * 1024 * 1024,
      previewSize: 150_000,
    });
    const r1 = await multipartInit(cookie, body);
    expect(r1.status).toBe(201);
    const j1 = await j(r1);

    const r2 = await multipartInit(cookie, { ...body, uploadId: j1.uploadId });
    expect(r2.status).toBe(200);
    const j2 = await j(r2);
    expect(j2.uploadId).toBe(j1.uploadId);
    expect(j2.resumed).toBe(true);
  });

  it("rechaza un re-init que cambia el tamaño de una subida pending", async () => {
    const { cookie } = await createUser();
    const body = initBody({
      sha256: sha("b2"),
      fileSize: 25 * 1024 * 1024,
    });
    const r1 = await multipartInit(cookie, body);
    expect(r1.status).toBe(201);

    const r2 = await multipartInit(cookie, { ...body, fileSize: 30 * 1024 * 1024 });
    expect(r2.status).toBe(409);
    const json = await j(r2);
    expect(json.code).toBe("upload_size_changed");
  });

  it("rechaza un ensamblado cuyo tamaño real no coincide con el declarado y limpia la fila", async () => {
    const { cookie, userId } = await createUser();
    const body = initBody({
      sha256: sha("b3"),
      fileSize: 6,
      thumbSize: 1,
    });
    const r1 = await multipartInit(cookie, body);
    expect(r1.status).toBe(201);
    const initJson = await j(r1);

    // Miniatura correcta, pero la parte real pesa 6 MiB.
    await env.BUCKET.put(`users/${userId}/thumbs/${body.sha256}.webp`, new Uint8Array(1));
    const mpu = env.BUCKET.resumeMultipartUpload(initJson.key, initJson.uploadId);
    const part = await mpu.uploadPart(1, new Uint8Array(6 * 1024 * 1024));

    const completeRes = await SELF.fetch(
      "http://localhost/v1/uploads/multipart/finalize",
      authed(cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: initJson.id,
          uploadId: initJson.uploadId,
          parts: [{ partNumber: 1, etag: part.etag }],
        }),
      }),
    );
    expect(completeRes.status).toBe(409);
    const completeJson = await j(completeRes);
    expect(completeJson.error).toBe("size_mismatch");

    const db = getDb(env.DB);
    const row = await db.select().from(media).where(eq(media.id, initJson.id)).get();
    expect(row).toBeUndefined();
    const stats = await db
      .select()
      .from(userStorageStats)
      .where(eq(userStorageStats.userId, userId))
      .get();
    expect(stats?.reservedBytes).toBe(0);
  });

  it("rechaza un ensamblado con MIME de miniatura incorrecto", async () => {
    const { cookie, userId } = await createUser();
    const body = initBody({
      sha256: sha("b4"),
      fileSize: 6,
      thumbSize: 1,
    });
    const r1 = await multipartInit(cookie, body);
    expect(r1.status).toBe(201);
    const initJson = await j(r1);

    await env.BUCKET.put(`users/${userId}/thumbs/${body.sha256}.webp`, new Uint8Array(1), {
      httpMetadata: { contentType: "image/png" },
    });
    const mpu = env.BUCKET.resumeMultipartUpload(initJson.key, initJson.uploadId);
    const part = await mpu.uploadPart(1, new Uint8Array(6));

    const completeRes = await SELF.fetch(
      "http://localhost/v1/uploads/multipart/finalize",
      authed(cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: initJson.id,
          uploadId: initJson.uploadId,
          parts: [{ partNumber: 1, etag: part.etag }],
        }),
      }),
    );
    expect(completeRes.status).toBe(409);
    const completeJson = await j(completeRes);
    expect(completeJson.error).toBe("mime_mismatch");
  });
});

describe("uploads/:id/cancel", () => {
  it("iniciar subida incrementa reserved_bytes, cancelar libera reserved_bytes a 0, y segunda llamada es idempotente", async () => {
    const { cookie, userId } = await createUser();
    const db = getDb(env.DB);

    const body = initBody({ sha256: sha("ca01"), fileSize: 200_000, thumbSize: 5_000 });
    const initRes = await init(cookie, body);
    expect(initRes.status).toBe(201);
    const { id } = await j(initRes);

    const statsAfterInit = await db
      .select()
      .from(userStorageStats)
      .where(eq(userStorageStats.userId, userId))
      .get();
    expect(statsAfterInit?.reservedBytes).toBe(205_000);

    // Cancelar subida
    const cancelRes = await SELF.fetch(
      `http://localhost/v1/uploads/${id}/cancel`,
      authed(cookie, { method: "POST" }),
    );
    expect(cancelRes.status).toBe(200);
    const cancelJson = await j(cancelRes);
    expect(cancelJson.ok).toBe(true);
    expect(cancelJson.releasedBytes).toBe(205_000);

    const statsAfterCancel = await db
      .select()
      .from(userStorageStats)
      .where(eq(userStorageStats.userId, userId))
      .get();
    expect(statsAfterCancel?.reservedBytes).toBe(0);

    // Segunda llamada debe ser idempotente
    const cancel2Res = await SELF.fetch(
      `http://localhost/v1/uploads/${id}/cancel`,
      authed(cookie, { method: "POST" }),
    );
    expect(cancel2Res.status).toBe(200);
    const cancel2Json = await j(cancel2Res);
    expect(cancel2Json.ok).toBe(true);
    expect(cancel2Json.releasedBytes).toBe(0);
  });

  it("reconciliación reactiva limpia reservas huérfanas al superar la cuota y permite la subida", async () => {
    const { cookie, userId } = await createUser();
    const db = getDb(env.DB);

    // Establecer cuota de 500 KB y simular reservas huérfanas desfasadas que llenan la cuota
    await db
      .insert(userStorageStats)
      .values({
        userId,
        usedBytes: 0,
        reservedBytes: 450_000,
        maxBytes: 500_000,
        mediaCount: 0,
        updatedAt: Date.now() - 3600_000,
      })
      .onConflictDoUpdate({
        target: userStorageStats.userId,
        set: { reservedBytes: 450_000, maxBytes: 500_000 },
      });

    // Sin archivos reales pendientes, intentar subir 100 KB (450 KB + 100 KB > 500 KB)
    // Gracias a la reconciliación reactiva, se recalcula reserved_bytes real (0) y la subida se acepta
    const body = initBody({ sha256: sha("ca02"), fileSize: 90_000, thumbSize: 5_000 });
    const res = await init(cookie, body);
    expect(res.status).toBe(201);
  });
});

async function userIdOf(cookie: string): Promise<string> {
  const res = await SELF.fetch("http://localhost/api/auth/get-session", {
    headers: { cookie },
  });
  const body = await j(res);
  return body.user.id;
}
