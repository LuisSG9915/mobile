#!/usr/bin/env node
/**
 * Puerta de verificación del Tramo 1 (pulido de honestidad) para Gemini 3.8 Flash.
 *
 *   node scripts/gemini-gate-pulido.mjs            # checks estáticos + typecheck + mobile tests + pipeline
 *   node scripts/gemini-gate-pulido.mjs --static   # solo checks estáticos (rápido, sin tests)
 *
 * No modifica el repositorio, no hace commit y no toca producción.
 * Escribe un resumen en test-results/gemini-gate-pulido-<timestamp>.md (gitignored).
 *
 * Este gate codifica el camino recomendado del guion:
 * docs/GEMINI_3_8_FLASH_PULIDO_2026-11.md
 * Si el humano autoriza una variante (por ejemplo, enlaces públicos reales en vez de ocultarlos),
 * actualiza el check correspondiente y explica el cambio en el commit.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const staticOnly = process.argv.includes("--static");
const checks = [];

function read(rel) {
  const file = path.join(ROOT, rel);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function check(label, ok, detail = "") {
  checks.push({ label, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function run(label, command, args) {
  const started = Date.now();
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const ok = result.status === 0;
  checks.push({
    label,
    ok,
    detail: `exit ${result.status ?? "signal"}`,
    ms: Date.now() - started,
  });
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  return ok;
}

function writeReport() {
  const dir = path.join(ROOT, "test-results");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `gemini-gate-pulido-${stamp}.md`);
  const ok = checks.every((c) => c.ok);
  const body = [
    `# Gemini gate — Tramo 1 (pulido) — ${new Date().toISOString()}`,
    "",
    `Resultado: **${ok ? "OK" : "FALLO"}**`,
    "",
    "| Check | Estado | Detalle |",
    "| :--- | :---: | :--- |",
    ...checks.map((c) => `| ${c.label} | ${c.ok ? "✅" : "❌"} | ${c.detail || ""} |`),
    "",
  ].join("\n");
  writeFileSync(file, body);
  console.log(`\nResumen: ${path.relative(ROOT, file)}`);
  return ok;
}

// ---------- P-01: el visor no promete un enlace público falso ----------
const shareModal = read("apps/mobile/src/ui/ShareMediaModal.tsx");
check("P-01 ShareMediaModal existe", shareModal.length > 0, "apps/mobile/src/ui/ShareMediaModal.tsx");
check("P-01 sin handleCopyLink", !shareModal.includes("handleCopyLink"));
check("P-01 sin estado expiresIn", !shareModal.includes("expiresIn"));
check("P-01 sin clipboard sobre media.uri", !shareModal.includes("navigator.clipboard"));

// ---------- P-02: paridad del editor ----------
const editorCalc = read("apps/mobile/src/lib/image-editor-calc.ts");
const editorCalcTest = read("apps/mobile/src/lib/image-editor-calc.test.ts");
const editorNative = read("apps/mobile/src/lib/image-editor.ts");
const editorWeb = read("apps/mobile/src/lib/image-editor.web.ts");
const editorModal = read("apps/mobile/src/ui/PhotoEditorModal.tsx");
check("P-02 helper compartido existe", editorCalc.length > 0);
check("P-02 helper cubre 9:16", /9\s*\/\s*16/.test(editorCalc));
check("P-02 test del helper existe y cubre 9:16", editorCalcTest.includes("9:16"));
check("P-02 web usa el helper", editorWeb.includes("aspectRatioValue"));
check("P-02 nativo usa el helper", editorNative.includes("aspectRatioValue"));
check("P-02 nativo crea asset", editorNative.includes("createAssetAsync"));
check("P-02 nativo encola la edición", editorNative.includes("enqueueAsset"));
check("P-02 el modal dispara el respaldo", editorModal.includes("runBackupPass"));

// ---------- P-03: papelera paginada ----------
const trash = read("apps/mobile/src/app/trash.tsx");
check("P-03 papelera usa useInfiniteQuery", trash.includes("useInfiniteQuery"));
check("P-03 papelera usa getNextPageParam", trash.includes("getNextPageParam"));
check("P-03 papelera pasa cursor a la API", /api\.trash\(\{\s*cursor/.test(trash));

// ---------- P-04: CSP del mapa ----------
const headers = read("apps/mobile/public/_headers");
const pipelineTests = read("scripts/test-pipeline.test.mjs");
check(
  "P-04 CSP permite teselas CARTO",
  /img-src[^;]*basemaps\.cartocdn\.com/.test(headers),
);
check(
  "P-04 el test de pipeline cubre CARTO",
  pipelineTests.includes("basemaps.cartocdn.com"),
);

// ---------- P-09: textos visibles a i18n ----------
const settings = read("apps/mobile/src/app/(tabs)/settings.tsx");
const backup = read("apps/mobile/src/app/(tabs)/backup.tsx");
const es = read("apps/mobile/src/i18n/es.ts");
check("P-09 settings sin 'Sesión revocada'", !settings.includes('"Sesión revocada"'));
check("P-09 settings sin 'Datos exportados'", !settings.includes('"Datos exportados'));
check(
  "P-09 backup sin texto de reenvío hardcodeado",
  !backup.includes('"Vuelve a iniciar sesión para reenviar la verificación."'),
);
check("P-09 es.ts tiene settings.sessionRevoked", es.includes("sessionRevoked"));
check("P-09 es.ts tiene backup.resendNeedsLogin", es.includes("resendNeedsLogin"));

// ---------- P-10: accesibilidad de acciones principales ----------
const ui = read("apps/mobile/src/ui/index.tsx");
const gallery = read("apps/mobile/src/app/(tabs)/index.tsx");
check("P-10 Button expone accessibilityState", ui.includes("accessibilityState"));
check("P-10 celda de galería expone accessibilityState", gallery.includes("accessibilityState"));

// ---------- P-11: versión y permiso huérfano ----------
const appJson = read("apps/mobile/app.json");
check("P-11 app.json declara 1.1.0", /"version"\s*:\s*"1\.1\.0"/.test(appJson));
check(
  "P-11 sin FOREGROUND_SERVICE_DATA_SYNC",
  !appJson.includes("FOREGROUND_SERVICE_DATA_SYNC"),
);

// ---------- Comandos ----------
if (!staticOnly) {
  const typecheckOk = run("Typecheck", "pnpm", ["typecheck"]);
  if (typecheckOk) {
    run("Tests mobile", "pnpm", ["--filter", "@photos/mobile", "test"]);
    run("Pipeline selftest", "pnpm", ["test:pipeline"]);
  } else {
    check("Tests mobile", false, "omitido: typecheck falló");
    check("Pipeline selftest", false, "omitido: typecheck falló");
  }
}

const ok = writeReport();
process.exit(ok ? 0 : 1);
