import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  errorSchema,
  type IntegrityIssue,
  type IntegrityReport,
  integrityLastResponseSchema,
  integrityReportSchema,
  integrityScanResponseSchema,
  integrityScanSchema,
} from "@photos/shared";
import { and, asc, eq, gt, isNull, lt, lte } from "drizzle-orm";
import { getDb } from "../db/client";
import { media, systemState } from "../db/schema";
import type { AppEnv } from "../env";

const err = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

/** Objetos R2 por página: acota los HEAD/consultas D1 de cada invocación. */
const PAGE_LIMIT = 500;
/** Incidencias detalladas que se guardan en el informe (el conteo sigue siendo exacto). */
const MAX_LISTED = 200;

const reportKey = (userId: string) => `integrity:${userId}`;

const scanRoute = createRoute({
  method: "post",
  path: "/user/integrity/scan",
  tags: ["user"],
  summary: "Verificar una página de originales contra R2",
  description:
    "Cruza una página de objetos de R2 con las filas de D1 del usuario: detecta originales que faltan o con tamaño distinto. Sin `startAfter` reinicia el informe; el cliente repite con `next` hasta que sea null.",
  request: { body: { content: { "application/json": { schema: integrityScanSchema } } } },
  responses: {
    200: {
      content: { "application/json": { schema: integrityScanResponseSchema } },
      description: "Avance del escaneo",
    },
    400: err("Solicitud inválida"),
    401: err("Sin sesión"),
  },
});

const lastRoute = createRoute({
  method: "get",
  path: "/user/integrity",
  tags: ["user"],
  summary: "Último informe de integridad",
  responses: {
    200: {
      content: { "application/json": { schema: integrityLastResponseSchema } },
      description: "Informe guardado o null",
    },
    401: err("Sin sesión"),
  },
});

async function loadReport(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<IntegrityReport | null> {
  const row = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, reportKey(userId)))
    .get();
  if (!row?.value) return null;
  try {
    const parsed = integrityReportSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function saveReport(db: ReturnType<typeof getDb>, userId: string, report: IntegrityReport) {
  const value = JSON.stringify(report);
  await db
    .insert(systemState)
    .values({ key: reportKey(userId), value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: Date.now() } });
}

export const integrityApp = new OpenAPIHono<AppEnv>()
  .openapi(scanRoute, async (c) => {
    const user = c.get("user");
    const { startAfter } = c.req.valid("json");
    const prefix = `users/${user.id}/originals/`;
    // El cursor lo controla el cliente: solo se acepta dentro del prefijo del usuario.
    if (startAfter !== undefined && !startAfter.startsWith(prefix)) {
      return c.json({ error: "bad_request", message: "Cursor inválido" }, 400);
    }
    const db = getDb(c.env.DB);
    const now = Date.now();

    const base: IntegrityReport = {
      startedAt: now,
      checkedAt: null,
      checked: 0,
      missing: [],
      sizeMismatch: [],
      missingCount: 0,
      sizeMismatchCount: 0,
    };
    const report = startAfter === undefined ? base : ((await loadReport(db, user.id)) ?? base);

    const page = await c.env.BUCKET.list({ prefix, limit: PAGE_LIMIT, startAfter });
    const sizes = new Map(page.objects.map((o) => [o.key, o.size]));
    const lastKey = page.objects.at(-1)?.key;

    // Rango de claves cubierto por esta página: (startAfter, lastKey] o, en la última, hasta el final del prefijo.
    const rangeConds = [
      eq(media.userId, user.id),
      eq(media.status, "ready"),
      isNull(media.deletedAt),
    ];
    if (startAfter !== undefined) rangeConds.push(gt(media.r2KeyOriginal, startAfter));
    if (page.truncated && lastKey) rangeConds.push(lte(media.r2KeyOriginal, lastKey));
    else rangeConds.push(lt(media.r2KeyOriginal, `${prefix}￿`));
    if (startAfter === undefined) rangeConds.push(gt(media.r2KeyOriginal, prefix));

    const rows = await db
      .select({
        id: media.id,
        key: media.r2KeyOriginal,
        size: media.fileSize,
        mediaType: media.mediaType,
        takenAt: media.takenAt,
      })
      .from(media)
      .where(and(...rangeConds))
      .orderBy(asc(media.r2KeyOriginal));

    for (const row of rows) {
      const actual = sizes.get(row.key);
      const issue: IntegrityIssue = {
        id: row.id,
        mediaType: row.mediaType,
        takenAt: row.takenAt,
        expectedSize: row.size,
      };
      if (actual === undefined) {
        report.missingCount++;
        if (report.missing.length < MAX_LISTED) report.missing.push(issue);
      } else if (actual !== row.size) {
        report.sizeMismatchCount++;
        if (report.sizeMismatch.length < MAX_LISTED) {
          report.sizeMismatch.push({ ...issue, actualSize: actual });
        }
      }
    }
    report.checked += rows.length;

    const next = page.truncated && lastKey ? lastKey : null;
    if (next === null) report.checkedAt = Date.now();
    await saveReport(db, user.id, report);

    return c.json({ next, report }, 200);
  })
  .openapi(lastRoute, async (c) => {
    const user = c.get("user");
    const report = await loadReport(getDb(c.env.DB), user.id);
    return c.json({ report }, 200);
  });
