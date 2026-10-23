import { env, SELF } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { album, media } from "../src/db/schema";
import { authed, createUser, j, sha } from "./helpers";

async function seedTestMedia(userId: string, count = 3): Promise<string[]> {
  const db = getDb(env.DB);
  const ids: string[] = [];
  const base = Date.now();
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    const s = sha(`${userId}-${i}`);
    await db.insert(media).values({
      id,
      userId,
      sha256: s,
      mediaType: "photo",
      mimeType: "image/jpeg",
      ext: "jpg",
      takenAt: base + i * 1000,
      width: 1920,
      height: 1080,
      thumbhash: "AQAAAA==",
      r2KeyOriginal: `users/${userId}/originals/${s}.jpg`,
      r2KeyThumb: `users/${userId}/thumbs/${s}.webp`,
      fileSize: 500_000,
      thumbSize: 10_000,
      status: "ready",
      createdAt: base,
      updatedAt: base,
      deletedAt: null,
    });
  }
  return ids;
}

describe("albums y compartido", () => {
  it("flujo completo de álbum: crear, listar, modificar, añadir/quitar fotos, compartir y borrar", async () => {
    const { cookie, userId } = await createUser();
    const mediaIds = await seedTestMedia(userId, 3);

    // 1. Listar álbumes (vacío inicialmente)
    const listRes1 = await SELF.fetch("http://localhost/v1/albums", authed(cookie));
    expect(listRes1.status).toBe(200);
    const listJson1 = await j(listRes1);
    expect(listJson1.albums).toEqual([]);

    // 2. Crear álbum con 2 fotos
    const createRes = await SELF.fetch("http://localhost/v1/albums", {
      ...authed(cookie),
      method: "POST",
      headers: { ...authed(cookie).headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Vacaciones 2026",
        mediaIds: [mediaIds[0], mediaIds[1]],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await j(createRes);
    expect(created.title).toBe("Vacaciones 2026");
    expect(created.mediaCount).toBe(2);
    expect(created.items.length).toBe(2);
    const albumId = created.id;

    // 3. Listar álbumes ahora muestra 1 álbum con portada y conteo
    const listRes2 = await SELF.fetch("http://localhost/v1/albums", authed(cookie));
    const listJson2 = await j(listRes2);
    expect(listJson2.albums.length).toBe(1);
    expect(listJson2.albums[0].id).toBe(albumId);
    expect(listJson2.albums[0].mediaCount).toBe(2);
    expect(listJson2.albums[0].coverThumbUrl).toContain("X-Amz-Signature");

    // 4. Modificar título
    const updateRes = await SELF.fetch(`http://localhost/v1/albums/${albumId}`, {
      ...authed(cookie),
      method: "PATCH",
      headers: { ...authed(cookie).headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Vacaciones en Japón" }),
    });
    expect(updateRes.status).toBe(200);
    const updated = await j(updateRes);
    expect(updated.title).toBe("Vacaciones en Japón");

    // 5. Añadir tercera foto
    const addMediaRes = await SELF.fetch(`http://localhost/v1/albums/${albumId}/media`, {
      ...authed(cookie),
      method: "POST",
      headers: { ...authed(cookie).headers, "Content-Type": "application/json" },
      body: JSON.stringify({ mediaIds: [mediaIds[2]] }),
    });
    expect(addMediaRes.status).toBe(200);

    // Detalle del álbum tiene ahora 3 fotos
    const detailRes = await SELF.fetch(`http://localhost/v1/albums/${albumId}`, authed(cookie));
    const detailJson = await j(detailRes);
    expect(detailJson.mediaCount).toBe(3);
    expect(detailJson.items.length).toBe(3);

    // 6. Quitar una foto del álbum
    const removeMediaRes = await SELF.fetch(
      `http://localhost/v1/albums/${albumId}/media/${mediaIds[0]}`,
      {
        ...authed(cookie),
        method: "DELETE",
      },
    );
    expect(removeMediaRes.status).toBe(200);

    const detailRes2 = await SELF.fetch(`http://localhost/v1/albums/${albumId}`, authed(cookie));
    const detailJson2 = await j(detailRes2);
    expect(detailJson2.mediaCount).toBe(2);

    // 7. Compartir álbum (generar enlace público)
    const shareRes = await SELF.fetch(`http://localhost/v1/albums/${albumId}/share`, {
      ...authed(cookie),
      method: "POST",
    });
    expect(shareRes.status).toBe(200);
    const shareJson = await j(shareRes);
    expect(shareJson.shareToken).toBeDefined();
    expect(shareJson.shareUrl).toContain(shareJson.shareToken);

    // 8. Consulta pública sin sesión (GET /v1/shared/album/:token)
    const publicRes = await SELF.fetch(`http://localhost/v1/shared/album/${shareJson.shareToken}`);
    expect(publicRes.status).toBe(200);
    const publicJson = await j(publicRes);
    expect(publicJson.title).toBe("Vacaciones en Japón");
    expect(publicJson.mediaCount).toBe(2);
    expect(publicJson.items[0].thumbUrl).toContain("X-Amz-Signature");
    expect(publicJson.items[0].originalUrl).toContain("X-Amz-Signature");
    expect(publicJson.items[0].downloadUrl).toContain("X-Amz-Signature");

    // 9. Revocar enlace de compartir
    const unshareRes = await SELF.fetch(`http://localhost/v1/albums/${albumId}/share`, {
      ...authed(cookie),
      method: "DELETE",
    });
    expect(unshareRes.status).toBe(200);

    // Consulta pública tras revocar da 404
    const publicRevokedRes = await SELF.fetch(
      `http://localhost/v1/shared/album/${shareJson.shareToken}`,
    );
    expect(publicRevokedRes.status).toBe(404);

    // 10. Eliminar álbum
    const deleteRes = await SELF.fetch(`http://localhost/v1/albums/${albumId}`, {
      ...authed(cookie),
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);

    // Las fotos originales siguen existiendo en el timeline
    const timelineRes = await SELF.fetch("http://localhost/v1/timeline", authed(cookie));
    const timelineJson = await j(timelineRes);
    expect(timelineJson.items.length).toBe(3);
  });

  it("GET /v1/albums pagina álbumes del usuario con cursor", async () => {
    const { cookie } = await createUser();

    // Crear 3 álbumes
    for (const title of ["Álbum A", "Álbum B", "Álbum C"]) {
      await SELF.fetch("http://localhost/v1/albums", {
        ...authed(cookie),
        method: "POST",
        headers: { ...authed(cookie).headers, "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    }

    // Página 1: limit 2
    const resP1 = await SELF.fetch("http://localhost/v1/albums?limit=2", authed(cookie));
    expect(resP1.status).toBe(200);
    const p1 = await j(resP1);
    expect(p1.albums.length).toBe(2);
    expect(p1.nextCursor).toBeTruthy();

    // Página 2: con cursor
    const resP2 = await SELF.fetch(
      `http://localhost/v1/albums?limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`,
      authed(cookie),
    );
    expect(resP2.status).toBe(200);
    const p2 = await j(resP2);
    expect(p2.albums.length).toBe(1);
    expect(p2.nextCursor).toBeNull();
  });

  it("GET /v1/albums/:id pagina fotos del álbum con cursor y mantiene mediaCount", async () => {
    const { cookie, userId } = await createUser();
    const mediaIds = await seedTestMedia(userId, 4);

    // Crear álbum con 4 fotos
    const createRes = await SELF.fetch("http://localhost/v1/albums", {
      ...authed(cookie),
      method: "POST",
      headers: { ...authed(cookie).headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Álbum Grande",
        mediaIds,
      }),
    });
    const created = await j(createRes);
    const albumId = created.id;

    // Página 1: limit 2
    const resP1 = await SELF.fetch(`http://localhost/v1/albums/${albumId}?limit=2`, authed(cookie));
    expect(resP1.status).toBe(200);
    const p1 = await j(resP1);
    expect(p1.items.length).toBe(2);
    expect(p1.mediaCount).toBe(4);
    expect(p1.nextCursor).toBeTruthy();

    // Página 2: limit 2 con cursor
    const resP2 = await SELF.fetch(
      `http://localhost/v1/albums/${albumId}?limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`,
      authed(cookie),
    );
    expect(resP2.status).toBe(200);
    const p2 = await j(resP2);
    expect(p2.items.length).toBe(2);
    expect(p2.mediaCount).toBe(4);

    const idsP1 = p1.items.map((i: { id: string }) => i.id);
    for (const item of p2.items) {
      expect(idsP1).not.toContain(item.id);
    }
  });

  it("EXPLAIN QUERY PLAN confirma búsqueda por índice sin SCAN TABLE en álbumes", async () => {
    const db = getDb(env.DB);

    // 1. Listar álbumes usa el índice idx_album_user
    const albumsPlan = await db.all<{
      id: number;
      parent: number;
      notused: number;
      detail: string;
    }>(
      sql`EXPLAIN QUERY PLAN
          SELECT id, updated_at FROM album
          WHERE user_id = 'test-user'
          ORDER BY updated_at DESC, id DESC
          LIMIT 51`,
    );

    expect(albumsPlan.length).toBeGreaterThan(0);
    const usesAlbumIndex = albumsPlan.some(
      (p) => p.detail.includes("SEARCH") && p.detail.includes("idx_album_user"),
    );
    expect(usesAlbumIndex).toBe(true);
    const hasAlbumScan = albumsPlan.some((p) => p.detail.includes("SCAN TABLE album"));
    expect(hasAlbumScan).toBe(false);

    // 2. Fotos de un álbum usan el índice idx_album_media_album
    const mediaPlan = await db.all<{ id: number; parent: number; notused: number; detail: string }>(
      sql`EXPLAIN QUERY PLAN
          SELECT album_id, media_id, added_at FROM album_media
          WHERE album_id = 'album-1'
          ORDER BY added_at DESC, media_id DESC
          LIMIT 61`,
    );

    expect(mediaPlan.length).toBeGreaterThan(0);
    const usesMediaIndex = mediaPlan.some(
      (p) => p.detail.includes("SEARCH") && p.detail.includes("idx_album_media_album"),
    );
    expect(usesMediaIndex).toBe(true);
    const hasMediaScan = mediaPlan.some((p) => p.detail.includes("SCAN TABLE album_media"));
    expect(hasMediaScan).toBe(false);
  });

  it("enlace compartido con caducidad devuelve 410 Gone tras expirar", async () => {
    const { cookie, userId } = await createUser();
    const mediaIds = await seedTestMedia(userId, 1);
    const db = getDb(env.DB);

    const createRes = await SELF.fetch("http://localhost/v1/albums", {
      ...authed(cookie),
      method: "POST",
      headers: { ...authed(cookie).headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Álbum Temporal",
        mediaIds: [mediaIds[0]],
      }),
    });
    const created = await j(createRes);
    const albumId = created.id;

    // Compartir con expiración 24h
    const shareRes = await SELF.fetch(`http://localhost/v1/albums/${albumId}/share`, {
      ...authed(cookie),
      method: "POST",
      headers: { ...authed(cookie).headers, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: "24h" }),
    });
    expect(shareRes.status).toBe(200);
    const shareJson = await j(shareRes);
    expect(shareJson.expiresAt).toBeDefined();

    // Acceso antes de expirar -> 200
    const accessOk = await SELF.fetch(`http://localhost/v1/shared/album/${shareJson.shareToken}`);
    expect(accessOk.status).toBe(200);

    // Simular que el enlace expiró en D1
    const past = Date.now() - 3600 * 1000;
    await db.update(album).set({ shareExpiresAt: past }).where(eq(album.id, albumId));

    // Acceso tras expirar -> 410 Gone
    const accessExpired = await SELF.fetch(
      `http://localhost/v1/shared/album/${shareJson.shareToken}`,
    );
    expect(accessExpired.status).toBe(410);
    const expiredJson = await j(accessExpired);
    expect(expiredJson.error).toBe("expired");
  });
});
