#!/usr/bin/env node
/**
 * Herramienta para generar y validar el checklist de pruebas nativas (Android/dev-client).
 *
 * Uso:
 *   # Generar una instancia para un release específico
 *   node scripts/verify-native-checklist.mjs docs/testing/native-checklist.template.json --generate test-results/checklist-v1.0.0.json --tag v1.0.0
 *
 *   # Validar un checklist completo para autorizar release estable (exit 0 si todo 'ok', exit 1 si hay pendientes/fallas)
 *   node scripts/verify-native-checklist.mjs test-results/checklist-v1.0.0.json --strict
 *
 *   # Mostrar tabla markdown (para adjuntar a las notas de GitHub Release)
 *   node scripts/verify-native-checklist.mjs test-results/checklist-v1.0.0.json --markdown
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith("--"));

if (!fileArg) {
  console.error(
    "Uso: node scripts/verify-native-checklist.mjs <checklist-path> [--generate <out>] [--tag <tag>] [--strict] [--markdown]",
  );
  process.exit(1);
}

const inputPath = path.resolve(ROOT, fileArg);
if (!existsSync(inputPath)) {
  console.error(`verify-native-checklist: el archivo "${fileArg}" no existe.`);
  process.exit(1);
}

const generateIndex = args.indexOf("--generate");
const generateOut = generateIndex >= 0 ? args[generateIndex + 1] : null;

const tagIndex = args.indexOf("--tag");
const tag = tagIndex >= 0 ? args[tagIndex + 1] : "vNext";

const isStrict = args.includes("--strict");
const isMarkdown = args.includes("--markdown");

let items = [];
try {
  items = JSON.parse(readFileSync(inputPath, "utf8"));
  if (!Array.isArray(items)) {
    throw new Error("El archivo JSON debe contener un arreglo de casos.");
  }
} catch (err) {
  console.error(`verify-native-checklist: error al leer JSON (${inputPath}): ${err.message}`);
  process.exit(1);
}

// 1. Modo Generación
if (generateOut) {
  const targetPath = path.resolve(ROOT, generateOut);
  const instantiated = items.map((item) => ({
    ...item,
    tag,
    status: item.status ?? "pendiente",
    dispositivo: item.dispositivo ?? "",
    notas: item.notas ?? "",
    updatedAt: new Date().toISOString(),
  }));

  writeFileSync(targetPath, JSON.stringify(instantiated, null, 2), "utf8");
  console.log(
    `verify-native-checklist: checklist generado en ${targetPath} para tag "${tag}" (${instantiated.length} casos).`,
  );
  process.exit(0);
}

// 2. Conteo de Estados
const stats = {
  total: items.length,
  ok: 0,
  falla: 0,
  pendiente: 0,
  bloqueado: 0,
  otro: 0,
};

const notOkItems = [];

for (const item of items) {
  const status = item.status?.toLowerCase() ?? "pendiente";
  if (status === "ok") {
    stats.ok++;
  } else if (status === "falla") {
    stats.falla++;
    notOkItems.push(item);
  } else if (status === "bloqueado") {
    stats.bloqueado++;
    notOkItems.push(item);
  } else if (status === "pendiente") {
    stats.pendiente++;
    notOkItems.push(item);
  } else {
    stats.otro++;
    notOkItems.push(item);
  }
}

// 3. Salida Markdown
if (isMarkdown) {
  console.log(`### Checklist Nativo Android (${stats.ok}/${stats.total} verificados)\n`);
  console.log("| ID | Área | Estado | Dispositivo | Notas |");
  console.log("|:---|:---|:---:|:---|:---|");
  for (const item of items) {
    const statusMap = {
      ok: "✅ OK",
      falla: "❌ Falla",
      bloqueado: "🚫 Bloqueado",
      pendiente: "⏳ Pendiente",
    };
    const statusText = statusMap[item.status?.toLowerCase()] || `⚠️ ${item.status}`;
    const dispositivo = item.dispositivo ? `\`${item.dispositivo}\`` : "-";
    const notas = (item.notas || item.esperado || "").replace(/\|/g, "\\|").slice(0, 80);
    console.log(`| **${item.id}** | ${item.area} | ${statusText} | ${dispositivo} | ${notas} |`);
  }
  console.log("");
}

// 4. Reporte por consola
console.log(
  `Checklist Nativo: Total=${stats.total} | OK=${stats.ok} | Fallas=${stats.falla} | Pendientes=${stats.pendiente} | Bloqueados=${stats.bloqueado}`,
);

if (stats.ok === stats.total && stats.total > 0) {
  console.log("✅ Todos los casos del checklist nativo fueron verificados exitosamente.");
  process.exit(0);
}

if (isStrict) {
  console.error("\n❌ Validación estricta fallida: el checklist tiene casos no completados:");
  for (const item of notOkItems) {
    console.error(
      `  - [${item.id}] (${item.area}): status="${item.status}" | notas="${item.notas || item.esperado || ""}"`,
    );
  }
  process.exit(1);
}

// En modo no estricto (informativo), exit 0
process.exit(0);
