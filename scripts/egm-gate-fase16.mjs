#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

const BLOCK_SPECS = {
  1: {
    name: "Block 1: Expo Native Modules & Streaming SHA-256",
    requiredFiles: [
      "apps/mobile/modules/upload-foreground/expo-module.config.json",
      "apps/mobile/modules/upload-foreground/android/build.gradle",
      "apps/mobile/modules/upload-foreground/android/src/main/AndroidManifest.xml",
      "apps/mobile/modules/upload-foreground/android/src/main/java/expo/modules/uploadforeground/UploadForegroundModule.kt",
      "apps/mobile/modules/upload-foreground/android/src/main/java/expo/modules/uploadforeground/UploadForegroundService.kt",
      "apps/mobile/modules/video-thumbnail/expo-module.config.json",
      "apps/mobile/modules/video-thumbnail/android/build.gradle",
      "apps/mobile/modules/video-thumbnail/android/src/main/java/expo/modules/videothumbnail/VideoThumbnailModule.kt",
    ],
    contentChecks: [
      {
        file: "apps/mobile/modules/upload-foreground/android/src/main/AndroidManifest.xml",
        pattern: /foregroundServiceType="dataSync"/,
        desc: 'AndroidManifest declara foregroundServiceType="dataSync"',
      },
      {
        file: "apps/mobile/modules/upload-foreground/android/src/main/java/expo/modules/uploadforeground/UploadForegroundService.kt",
        pattern: /override fun onTimeout/,
        desc: "UploadForegroundService implementa onTimeout para Android 15 (API 35)",
      },
      {
        file: "apps/mobile/modules/upload-foreground/android/src/main/java/expo/modules/uploadforeground/UploadForegroundModule.kt",
        pattern: /AsyncFunction\("sha256File"\)/,
        desc: "UploadForegroundModule expone sha256File nativo por streaming",
      },
      {
        file: "apps/mobile/modules/video-thumbnail/android/src/main/java/expo/modules/videothumbnail/VideoThumbnailModule.kt",
        pattern: /AsyncFunction\("applyColorMatrix"\)/,
        desc: "VideoThumbnailModule expone applyColorMatrix 4x5 nativo",
      },
    ],
    testCommands: [
      ["pnpm", ["--filter", "mobile", "test", "src/queue/foreground.test.ts"]],
      ["node", ["--test", "scripts/android-release.test.mjs"]],
    ],
  },
  2: {
    name: "Block 2: Concurrent Multipart Pool & Incremental Scanner",
    requiredFiles: [
      "apps/mobile/src/queue/upload-part.ts",
      "apps/mobile/src/queue/upload-part.test.ts",
      "apps/mobile/src/queue/db.ts",
      "apps/mobile/src/queue/scanner.ts",
    ],
    contentChecks: [
      {
        file: "apps/mobile/src/queue/upload-part.ts",
        pattern: /uploadPartsConcurrently/,
        desc: "upload-part.ts exporta uploadPartsConcurrently",
      },
      {
        file: "apps/mobile/src/queue/db.ts",
        pattern: /queue_sync_meta/,
        desc: "db.ts gestiona tabla queue_sync_meta para cursor incremental",
      },
    ],
    testCommands: [
      ["pnpm", ["--filter", "mobile", "test", "src/queue/upload-part.test.ts"]],
      ["pnpm", ["--filter", "mobile", "test", "src/queue/scanner.test.ts"]],
    ],
  },
  3: {
    name: "Block 3: Zero-Flicker Hybrid Gallery & Pinch Grid Geometry",
    requiredFiles: [
      "apps/mobile/src/lib/gallery.ts",
      "apps/mobile/src/lib/gallery.test.ts",
      "apps/mobile/src/lib/grid-geometry.ts",
      "apps/mobile/src/lib/grid-geometry.test.ts",
      "apps/mobile/src/ui/FastScrubber.tsx",
    ],
    contentChecks: [
      {
        file: "apps/mobile/src/lib/gallery.ts",
        pattern: /stableKey/,
        desc: "gallery.ts incluye stableKey inmutable para evitar parpadeos",
      },
      {
        file: "apps/mobile/src/lib/grid-geometry.ts",
        pattern: /findRowIndexAtOffset/,
        desc: "grid-geometry.ts incluye búsqueda binaria findRowIndexAtOffset",
      },
    ],
    testCommands: [
      ["pnpm", ["--filter", "mobile", "test", "src/lib/gallery.test.ts"]],
      ["pnpm", ["--filter", "mobile", "test", "src/lib/grid-geometry.test.ts"]],
    ],
  },
  4: {
    name: "Block 4: 3-Layer Progressive Viewer, MediaCodec & Offline/Free-Space",
    requiredFiles: [
      "apps/mobile/src/lib/viewer-physics.ts",
      "apps/mobile/src/lib/viewer-physics.test.ts",
      "apps/mobile/src/ui/ZoomableImage.tsx",
      "apps/mobile/src/ui/VideoPage.tsx",
      "apps/mobile/src/lib/query-client.ts",
      "apps/mobile/src/lib/query-client.test.ts",
      "apps/mobile/src/lib/free-space.ts",
      "apps/mobile/src/lib/free-space.test.ts",
    ],
    contentChecks: [
      {
        file: "apps/mobile/src/lib/viewer-physics.ts",
        pattern: /shouldLoadFullResolution/,
        desc: "viewer-physics.ts exporta shouldLoadFullResolution (>= 1.5x)",
      },
      {
        file: "apps/mobile/src/lib/free-space.ts",
        pattern: /freeUpSpaceInBatches/,
        desc: "free-space.ts exporta borrado seguro por lotes freeUpSpaceInBatches",
      },
    ],
    testCommands: [
      ["pnpm", ["--filter", "mobile", "test", "src/lib/viewer-physics.test.ts"]],
      ["pnpm", ["--filter", "mobile", "test", "src/lib/query-client.test.ts"]],
      ["pnpm", ["--filter", "mobile", "test", "src/lib/free-space.test.ts"]],
    ],
  },
  5: {
    name: "Block 5: Non-Destructive Photo Editor (4x5 ColorMatrix) & Share Optimizer",
    requiredFiles: [
      "apps/mobile/src/lib/image-editor-calc.ts",
      "apps/mobile/src/lib/image-editor-calc.test.ts",
      "apps/mobile/src/lib/image-editor.ts",
      "apps/mobile/src/ui/PhotoEditorModal.tsx",
      "apps/mobile/src/lib/share-optimizer-calc.ts",
      "apps/mobile/src/lib/share-optimizer.test.ts",
    ],
    contentChecks: [
      {
        file: "apps/mobile/src/lib/image-editor-calc.ts",
        pattern: /buildColorMatrix20/,
        desc: "image-editor-calc.ts exporta generador matricial buildColorMatrix20",
      },
      {
        file: "apps/mobile/src/lib/share-optimizer-calc.ts",
        pattern: /planVideoOptimization/,
        desc: "share-optimizer-calc.ts exporta planVideoOptimization",
      },
    ],
    testCommands: [
      ["pnpm", ["--filter", "mobile", "test", "src/lib/image-editor-calc.test.ts"]],
      ["pnpm", ["--filter", "mobile", "test", "src/lib/share-optimizer.test.ts"]],
    ],
  },
  6: {
    name: "Block 6: Cloudflare D1 SQLite FTS5 & Geohash Clustering",
    requiredFiles: [
      "apps/api/migrations/0015_fts5_and_geohash.sql",
      "apps/api/src/lib/geo.ts",
      "apps/api/src/routes/locations.ts",
      "apps/api/src/routes/search.ts",
    ],
    contentChecks: [
      {
        file: "apps/api/migrations/0015_fts5_and_geohash.sql",
        pattern: /USING fts5/i,
        desc: "Migración 0015 declara tabla virtual FTS5",
      },
      {
        file: "apps/api/src/lib/geo.ts",
        pattern: /encodeGeohash/,
        desc: "geo.ts exporta encodeGeohash",
      },
      {
        file: "apps/api/src/routes/search.ts",
        pattern: /buildFts5PrefixQuery/,
        desc: "search.ts exporta sanitizador buildFts5PrefixQuery",
      },
    ],
    testCommands: [
      ["pnpm", ["--filter", "api", "test", "test/geo.test.ts"]],
      ["pnpm", ["--filter", "api", "test", "test/search.test.ts"]],
    ],
  },
};

function verifyBlock(blockNum, { structuralOnly = false } = {}) {
  const spec = BLOCK_SPECS[blockNum];
  if (!spec) {
    console.error(`Bloque desconocido: ${blockNum}`);
    return false;
  }

  console.log(`\n========================================`);
  console.log(`Verificando ${spec.name}`);
  console.log(`========================================`);

  let ok = true;

  for (const relPath of spec.requiredFiles) {
    const fullPath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
      console.error(`  [FALTA] ${relPath}`);
      ok = false;
    } else {
      console.log(`  [OK] Archivo presente: ${relPath}`);
    }
  }

  for (const check of spec.contentChecks) {
    const fullPath = path.join(REPO_ROOT, check.file);
    if (!fs.existsSync(fullPath)) {
      console.error(`  [FALLO] ${check.desc} (archivo no existe)`);
      ok = false;
      continue;
    }
    const content = fs.readFileSync(fullPath, "utf8");
    if (!check.pattern.test(content)) {
      console.error(`  [FALLO] ${check.desc} en ${check.file}`);
      ok = false;
    } else {
      console.log(`  [OK] ${check.desc}`);
    }
  }

  if (!ok || structuralOnly) {
    return ok;
  }

  for (const [cmd, args] of spec.testCommands) {
    console.log(`  [TEST] Ejecutando: ${cmd} ${args.join(" ")}`);
    const res = spawnSync(cmd, args, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (res.status !== 0) {
      console.error(`  [FALLO TEST] ${cmd} ${args.join(" ")}`);
      return false;
    }
  }

  return true;
}

const args = process.argv.slice(2);
const structuralOnly = args.includes("--structural-only");
const blockArgIdx = args.indexOf("--block");

if (blockArgIdx !== -1) {
  const blockNum = Number(args[blockArgIdx + 1]);
  const passed = verifyBlock(blockNum, { structuralOnly });
  process.exit(passed ? 0 : 1);
} else {
  let allPassed = true;
  for (const b of [1, 2, 3, 4, 5, 6]) {
    if (!verifyBlock(b, { structuralOnly })) {
      allPassed = false;
    }
  }
  process.exit(allPassed ? 0 : 1);
}
