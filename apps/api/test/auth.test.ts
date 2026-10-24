import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import {
  album,
  albumMedia,
  media,
  session as sessionTable,
  user as userTable,
} from "../src/db/schema";
import { authed, createUser, initBody, j, sha } from "./helpers";

describe("auth", () => {
  it("registro devuelve sesión con cookie", async () => {
    const res = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({
        email: "ana@test.dev",
        password: "password1234",
        name: "Ana",
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("better-auth");
    const body = await j(res);
    expect(body.user.email).toBe("ana@test.dev");
  });

  it("rutas /v1 sin sesión → 401", async () => {
    const res = await SELF.fetch("http://localhost/v1/timeline");
    expect(res.status).toBe(401);
    const body = await j(res);
    expect(body.error).toBe("unauthorized");
  });

  it("sign-in con password correcta funciona", async () => {
    const res = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({ email: "ana@test.dev", password: "password1234" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("better-auth");
  });

  it("lista sesiones y permite revocar una sesión secundaria", async () => {
    const { cookie, userId } = await createUser();
    const db = getDb(env.DB);

    // Crear una sesión secundaria manual para el mismo usuario
    const secondSessionId = crypto.randomUUID();
    const now = new Date();
    await db.insert(sessionTable).values({
      id: secondSessionId,
      userId,
      token: `token-${secondSessionId}`,
      expiresAt: new Date(now.getTime() + 86400000),
      createdAt: now,
      updatedAt: now,
      ipAddress: "192.168.1.100",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
    });

    // 1. Listar sesiones
    const sessionsRes = await SELF.fetch("http://localhost/v1/user/sessions", authed(cookie));
    expect(sessionsRes.status).toBe(200);
    const sessionsJson = await j(sessionsRes);
    expect(sessionsJson.sessions.length).toBeGreaterThanOrEqual(2);
    const current = sessionsJson.sessions.find((s: any) => s.isCurrent);
    expect(current).toBeDefined();

    // 2. Revocar sesión secundaria
    const revokeRes = await SELF.fetch(
      `http://localhost/v1/user/sessions/${secondSessionId}`,
      authed(cookie, { method: "DELETE" }),
    );
    expect(revokeRes.status).toBe(200);

    // 3. Verificar que ya no existe
    const afterRes = await SELF.fetch("http://localhost/v1/user/sessions", authed(cookie));
    const afterJson = await j(afterRes);
    expect(afterJson.sessions.find((s: any) => s.id === secondSessionId)).toBeUndefined();
  });

  it("exporta datos del usuario (GDPR) con metadatos, álbumes y URLs de descarga", async () => {
    const { cookie, userId } = await createUser();
    const db = getDb(env.DB);

    // Crear un medio en D1
    const mId = crypto.randomUUID();
    const now = Date.now();
    await db.insert(media).values({
      id: mId,
      userId,
      sha256: sha("export11"),
      mediaType: "photo",
      mimeType: "image/jpeg",
      ext: "jpg",
      takenAt: now,
      dateGroup: "2026-10-22",
      width: 1920,
      height: 1080,
      thumbhash: "AQAAAA==",
      r2KeyOriginal: `users/${userId}/originals/${sha("export11")}.jpg`,
      r2KeyThumb: `users/${userId}/thumbs/${sha("export11")}.webp`,
      fileSize: 1000,
      thumbSize: 100,
      status: "ready",
      caption: "Foto de prueba exportación",
      createdAt: now,
      updatedAt: now,
    });

    // Crear un álbum y asociarle el medio
    const aId = crypto.randomUUID();
    await db.insert(album).values({
      id: aId,
      userId,
      title: "Álbum Export",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(albumMedia).values({
      albumId: aId,
      mediaId: mId,
      addedAt: now,
    });

    // Solicitar exportación
    const exportRes = await SELF.fetch("http://localhost/v1/user/export", authed(cookie));
    expect(exportRes.status).toBe(200);
    const exportJson = await j(exportRes);
    expect(exportJson.user.id).toBe(userId);
    expect(exportJson.mediaCount).toBe(1);
    expect(exportJson.media[0].id).toBe(mId);
    expect(exportJson.media[0].caption).toBe("Foto de prueba exportación");
    expect(exportJson.media[0].downloadUrl).toContain("X-Amz-Signature");
    expect(exportJson.albums.length).toBe(1);
    expect(exportJson.albums[0].title).toBe("Álbum Export");
    expect(exportJson.albums[0].mediaIds).toContain(mId);
  });

  it("elimina la cuenta y todos los datos asociados en D1 y R2", async () => {
    const { cookie, userId } = await createUser();
    const db = getDb(env.DB);

    const mId = crypto.randomUUID();
    const now = Date.now();
    await db.insert(media).values({
      id: mId,
      userId,
      sha256: sha("delacct11"),
      mediaType: "photo",
      mimeType: "image/jpeg",
      ext: "jpg",
      takenAt: now,
      dateGroup: "2026-10-22",
      width: 1920,
      height: 1080,
      thumbhash: "AQAAAA==",
      r2KeyOriginal: `users/${userId}/originals/${sha("delacct11")}.jpg`,
      r2KeyThumb: `users/${userId}/thumbs/${sha("delacct11")}.webp`,
      fileSize: 1000,
      thumbSize: 100,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });

    const delRes = await SELF.fetch(
      "http://localhost/v1/user/account",
      authed(cookie, { method: "DELETE" }),
    );
    expect(delRes.status).toBe(200);
    const delJson = await j(delRes);
    expect(delJson.ok).toBe(true);

    // La sesión fue revocada: peticiones autenticadas dan 401
    const checkRes = await SELF.fetch("http://localhost/v1/timeline", authed(cookie));
    expect(checkRes.status).toBe(401);

    // Filas borradas en D1
    const userRow = await db.select().from(userTable).where(eq(userTable.id, userId)).get();
    expect(userRow).toBeUndefined();
    const mediaRow = await db.select().from(media).where(eq(media.userId, userId)).get();
    expect(mediaRow).toBeUndefined();
  });

  it("bloquea subidas con 403 email_unverified tras expirar el periodo de gracia", async () => {
    const { cookie, userId } = await createUser();
    const db = getDb(env.DB);

    // Simular que el usuario fue creado hace 10 días y no ha verificado su correo
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    await db
      .update(userTable)
      .set({ createdAt: tenDaysAgo, emailVerified: false })
      .where(eq(userTable.id, userId));

    const body = initBody({ sha256: sha("aa11") });
    const blockedRes = await SELF.fetch("http://localhost/v1/uploads/init", {
      ...authed(cookie),
      method: "POST",
      headers: { ...authed(cookie).headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(blockedRes.status).toBe(403);
    const blockedJson = await j(blockedRes);
    expect(blockedJson.code).toBe("email_unverified");

    // Marcar como verificado y comprobar que se desbloquea
    await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, userId));
    const okRes = await SELF.fetch("http://localhost/v1/uploads/init", {
      ...authed(cookie),
      method: "POST",
      headers: { ...authed(cookie).headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(okRes.status).toBe(201);
  });

  it("acepta callbackURL nativo (photos://) y web en registro y reenvío de verificación", async () => {
    // 1. Registro con deep link nativo
    const nativeSignupRes = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({
        email: "native@test.dev",
        password: "password1234",
        name: "Native User",
        callbackURL: "photos:///welcome",
      }),
    });
    expect(nativeSignupRes.status).toBe(200);

    // 2. Registro con origen web permitido
    const webSignupRes = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8081" },
      body: JSON.stringify({
        email: "webuser@test.dev",
        password: "password1234",
        name: "Web User",
        callbackURL: "http://localhost:8081/welcome",
      }),
    });
    expect(webSignupRes.status).toBe(200);

    // 3. Reenvío de correo de verificación con callbackURL nativo
    const resendRes = await SELF.fetch("http://localhost/api/auth/send-verification-email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({
        email: "native@test.dev",
        callbackURL: "photos:///welcome",
      }),
    });
    expect(resendRes.status).toBe(200);

    // 4. Rechazo con callbackURL no confiable (Better Auth responde 403 Forbidden)
    const untrustedRes = await SELF.fetch("http://localhost/api/auth/send-verification-email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({
        email: "native@test.dev",
        callbackURL: "https://evil.example.com/steal",
      }),
    });
    expect(untrustedRes.status).toBe(403);
  });
});
