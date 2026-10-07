#!/usr/bin/env node
/**
 * Auditoría SOLO-LECTURA del estado de producción (D1 + opcionalmente R2).
 * Pensada para validar hipótesis de los hallazgos del análisis de procesos:
 *
 *   node scripts/audit-prod.mjs            # contra D1 de producción (SELECTs)
 *   node scripts/audit-prod.mjs --local    # contra la D1 local de wrangler dev
 *   node scripts/audit-prod.mjs --json out.json   # vuelca el resultado crudo
 *
 * Barrido de objetos R2 (opcional): definir en el entorno
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 * y el script lista el bucket y detecta objetos huérfanos (sin fila en media)
 * y filas 'ready' cuyo objeto falta en R2. Sin credenciales se omite.
 *
 * No escribe nada en D1 ni en R2: únicamente SELECT y ListObjectsV2.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const args = process.argv.slice(2);
const LOCAL = args.includes("--local");
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

const H = 3600_000;
const D = 24 * H;
const now = Date.now();
const PENDING_TTL = D;
const TRASH_TTL = 30 * D;

// Cada entrada: [nombre, SQL]. Los SELECTs van en UNA llamada a d1 execute
// (wrangler acepta múltiples sentencias separadas por ';').
const QUERIES = [
  [
    "users_sessions",
    `select (select count(*) from user) as users,
            (select count(*) from session) as sessions,
            (select count(*) from session where expires_at > ${now}) as sessions_active`,
  ],
  [
    "media_by_status",
    `select status, (deleted_at is not null) as trashed, count(*) as items,
            coalesce(sum(file_size),0) as file_bytes, coalesce(sum(thumb_size),0) as thumb_bytes
     from media group by status, trashed order by status, trashed`,
  ],
  [
    "pending_backlog",
    `select count(*) as stale_pending, coalesce(sum(file_size),0) as bytes,
            min(created_at) as oldest_created, max(updated_at) as newest_update
     from media where status='pending' and created_at < ${now - PENDING_TTL}`,
  ],
  [
    "pending_reinit_race",
    // Pendientes re-iniciados en las últimas 24h que el cron purgará igualmente
    // porque la purga mira created_at (que el re-init no refresca).
    `select count(*) as at_risk from media
     where status='pending' and created_at < ${now - PENDING_TTL} and updated_at >= ${now - PENDING_TTL}`,
  ],
  [
    "trash_backlog",
    `select count(*) as expired_trash, coalesce(sum(file_size+thumb_size),0) as bytes
     from media where deleted_at is not null and deleted_at < ${now - TRASH_TTL}`,
  ],
  [
    "stats_drift",
    // used_bytes incluye la papelera (sigue ocupando R2 hasta la purga),
    // así que la comparación es contra TODOS los 'ready'.
    `select u.user_id, u.used_bytes, u.media_count,
            coalesce(m.bytes,0) as actual_bytes, coalesce(m.cnt,0) as actual_count,
            u.used_bytes - coalesce(m.bytes,0) as drift_bytes
     from user_storage_stats u
     left join (
       select user_id, sum(file_size+thumb_size) as bytes, count(*) as cnt
       from media where status='ready' group by user_id
     ) m on m.user_id = u.user_id
     order by abs(u.used_bytes - coalesce(m.bytes,0)) desc`,
  ],
  [
    "quota_over",
    `select user_id, used_bytes, max_bytes from user_storage_stats where used_bytes > max_bytes`,
  ],
  [
    "dup_sha_same_user",
    `select user_id, sha256, count(*) as c from media group by user_id, sha256 having c > 1 limit 20`,
  ],
  [
    "dup_sha_cross_user",
    `select sha256, count(distinct user_id) as users, count(*) as rows_,
            max(file_size+thumb_size) as bytes
     from media group by sha256 having users > 1 order by bytes desc limit 20`,
  ],
  [
    "taken_at_anomalies",
    `select count(*) as c, min(taken_at) as min_taken, max(taken_at) as max_taken
     from media where taken_at <= 0 or taken_at > ${now + D}`,
  ],
  [
    "date_group_mismatch",
    // date_group debería ser siempre la fecha UTC de taken_at.
    `select count(*) as c from media
     where date_group = '' or date_group != substr(datetime(taken_at/1000,'unixepoch'),1,10)`,
  ],
  [
    "size_by_ext",
    `select ext, media_type, count(*) as c, coalesce(sum(file_size),0) as bytes
     from media group by ext, media_type order by bytes desc`,
  ],
  [
    "mime_ext_map",
    // Si un ext aparece con varios mime_type distintos conviene revisarlo.
    `select ext, mime_type, count(*) as c from media group by ext, mime_type order by ext`,
  ],
  [
    "r2_keys",
    `select r2_key_thumb as k, status from media
     union all select r2_key_original as k, status from media`,
  ],
];

function runD1() {
  const cmd = QUERIES.map(([, sql]) => sql).join(";");
  const scope = LOCAL ? "--local" : "--remote";
  const res = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "execute", "photos-db", scope, "--json", "-y", "--command", cmd],
    { cwd: path.join(ROOT, "apps", "api"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    const errText = res.stderr || res.stdout;
    console.error("wrangler d1 execute falló:");
    console.error(errText);
    if (/no such table/.test(errText)) {
      console.error(
        "\nLa base local no tiene todas las migraciones. Ejecuta: pnpm --filter @photos/api db:migrate:local",
      );
    } else if (/7403|not authorized|not valid/.test(errText)) {
      console.error(
        "\nError de cuenta Cloudflare (7403): suele ser transitorio del token de wrangler — reintenta, o ejecuta `wrangler login` de nuevo si persiste.",
      );
    }
    process.exit(1);
  }
  const start = res.stdout.indexOf("[");
  const end = res.stdout.lastIndexOf("]");
  if (start < 0 || end <= start) {
    console.error("No se encontró JSON en la salida de wrangler:");
    console.error(res.stdout.slice(0, 2000));
    process.exit(1);
  }
  const blocks = JSON.parse(res.stdout.slice(start, end + 1));
  const report = {};
  QUERIES.forEach(([name], i) => {
    report[name] = blocks[i]?.results ?? null;
  });
  return report;
}

async function auditR2(dbKeys) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  const bucket = process.env.R2_BUCKET_NAME || "photos-media";
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return { skipped: "sin credenciales R2 en el entorno" };
  }
  const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  const known = new Map(dbKeys.map((r) => [r.k, r.status]));
  let token;
  let objects = 0;
  let bytes = 0;
  const orphans = [];
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const o of page.Contents ?? []) {
      objects++;
      bytes += o.Size ?? 0;
      if (!known.has(o.Key)) orphans.push({ key: o.Key, size: o.Size ?? 0 });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return { objects, bytes, orphans, orphanBytes: orphans.reduce((s, o) => s + o.size, 0) };
}

const fmtBytes = (n) => {
  if (n == null) return "-";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};

const report = runD1();
report.r2 = await auditR2(report.r2_keys ?? []);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));

console.log(
  `\n=== Auditoría ${LOCAL ? "LOCAL" : "PRODUCCIÓN"} — ${new Date().toISOString()} ===\n`,
);

const us = report.users_sessions?.[0] ?? {};
console.log(`Usuarios: ${us.users} | Sesiones: ${us.sessions} (activas: ${us.sessions_active})`);

console.log("\nMedia por estado:");
for (const r of report.media_by_status ?? []) {
  console.log(
    `  ${r.status}${r.trashed ? " (papelera)" : ""}: ${r.items} items, ${fmtBytes(r.file_bytes)} + thumbs ${fmtBytes(r.thumb_bytes)}`,
  );
}

const pb = report.pending_backlog?.[0] ?? {};
console.log(
  `\nPending >24h sin purgar: ${pb.stale_pending} (${fmtBytes(pb.bytes)})` +
    (pb.stale_pending ? ` — más antiguo: ${new Date(pb.oldest_created).toISOString()}` : ""),
);
const pr = report.pending_reinit_race?.[0] ?? {};
console.log(`Pending en riesgo de purga pese a re-init reciente: ${pr.at_risk}`);

const tb = report.trash_backlog?.[0] ?? {};
console.log(`Papelera >30d sin purgar: ${tb.expired_trash} (${fmtBytes(tb.bytes)})`);

console.log("\nDeriva user_storage_stats vs media:");
for (const r of report.stats_drift ?? []) {
  const flag = r.drift_bytes !== 0 ? "  <-- DERIVA" : "";
  console.log(
    `  ${r.user_id.slice(0, 8)}… used=${fmtBytes(r.used_bytes)} real=${fmtBytes(r.actual_bytes)} drift=${fmtBytes(r.drift_bytes)} count=${r.media_count}/${r.actual_count}${flag}`,
  );
}
console.log(`Usuarios sobre cuota: ${(report.quota_over ?? []).length}`);
if (report.quota_over?.length) console.table(report.quota_over);

console.log(`\nDuplicados sha256 mismo usuario: ${(report.dup_sha_same_user ?? []).length}`);
console.log(`Sha256 compartidos entre usuarios: ${(report.dup_sha_cross_user ?? []).length}`);
if (report.dup_sha_cross_user?.length) console.table(report.dup_sha_cross_user);

const ta = report.taken_at_anomalies?.[0] ?? {};
console.log(
  `taken_at anómalos (<=0 o futuro): ${ta.c}` +
    (ta.c
      ? ` — rango ${new Date(ta.min_taken).toISOString()} .. ${new Date(ta.max_taken).toISOString()}`
      : ""),
);
const dg = report.date_group_mismatch?.[0] ?? {};
console.log(`date_group inconsistente con taken_at: ${dg.c}`);

console.log("\nTamaño por extensión:");
console.table(report.size_by_ext ?? []);
console.log("Mapa ext→mime (revisar ext con más de un mime):");
console.table(report.mime_ext_map ?? []);

if (report.r2?.skipped) {
  console.log(
    `\nR2: ${report.r2.skipped}. Para el barrido exporta R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY (+R2_BUCKET_NAME).`,
  );
} else if (report.r2) {
  console.log(
    `\nR2: ${report.r2.objects} objetos, ${fmtBytes(report.r2.bytes)} | huérfanos: ${report.r2.orphans.length} (${fmtBytes(report.r2.orphanBytes)})`,
  );
  if (report.r2.orphans.length) console.table(report.r2.orphans.slice(0, 50));
}

if (jsonOut) console.log(`\nJSON crudo en ${jsonOut}`);
