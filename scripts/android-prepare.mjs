#!/usr/bin/env node
/**
 * Prepara el APK de release sin EAS (H1.4).
 *
 * EAS agotó su plan gratuito, así que el binario lo produce Gradle:
 *   npx expo prebuild --platform android --clean --no-install
 *   node scripts/android-prepare.mjs --tag v1.2.0      # firma + versión
 *   (cd apps/mobile/android && ./gradlew assembleRelease)
 *
 * `android/` no se versiona (CNG), por eso la firma y el `versionCode` se
 * inyectan en cada build; sin esto el release saldría firmado con la keystore
 * de debug y dos versiones no se podrían instalar una encima de otra.
 *
 *   --dry-run  valida la inyección sobre el Gradle ya generado, sin escribir.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gradlePropertiesForSigning,
  injectSigningConfig,
  looksLikeKeystore,
  parseTagVersion,
  SIGNING_SECRETS,
  setVersion,
} from "./lib/android-release.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dryRun = args.includes("--dry-run");
const tag = value("--tag");
const androidDir = path.resolve(ROOT, value("--android-dir") ?? "apps/mobile/android");

function fail(message) {
  console.error(`android-prepare: ${message}`);
  process.exit(1);
}

if (!tag) fail("falta --tag vX.Y.Z");

let target;
try {
  target = parseTagVersion(tag);
} catch (error) {
  fail(error.message);
}

const buildGradlePath = path.join(androidDir, "app", "build.gradle");
if (!existsSync(buildGradlePath)) {
  fail(
    `no existe ${path.relative(ROOT, buildGradlePath)}: corre antes "npx expo prebuild --platform android"`,
  );
}

let gradle;
try {
  gradle = setVersion(injectSigningConfig(readFileSync(buildGradlePath, "utf8")), target);
} catch (error) {
  fail(`${error.message} (¿cambió la plantilla de prebuild?)`);
}

if (!dryRun) {
  const keystoreBase64 = process.env[SIGNING_SECRETS.keystoreBase64];
  const storePassword = process.env[SIGNING_SECRETS.storePassword];
  const keyAlias = process.env[SIGNING_SECRETS.keyAlias];
  const keyPassword = process.env[SIGNING_SECRETS.keyPassword];

  if (!keystoreBase64) {
    fail(
      `falta ${SIGNING_SECRETS.keystoreBase64}: sin keystore de release el APK se firma con la de debug y no se actualiza. Ver docs/ops/RELEASE.md`,
    );
  }
  const bytes = Buffer.from(keystoreBase64, "base64");
  if (!looksLikeKeystore(bytes))
    fail(`${SIGNING_SECRETS.keystoreBase64} no parece un JKS/PKCS12 (base64 corrupto)`);

  const keystorePath = path.join(androidDir, "app", "release.keystore");
  writeFileSync(keystorePath, bytes);

  writeFileSync(buildGradlePath, gradle);
  writeFileSync(
    path.join(androidDir, "gradle.properties"),
    `${readFileSync(path.join(androidDir, "gradle.properties"), "utf8").trimEnd()}\n\n${gradlePropertiesForSigning(
      {
        alias: keyAlias,
        storePassword,
        keyPassword,
      },
    ).join("\n")}\n`,
  );

  console.log(
    `android-prepare: firma y versión inyectadas (v${target.versionName}, versionCode ${target.versionCode})`,
  );
} else {
  console.log(
    `android-prepare: dry-run OK — build.gradle acepta firma y versión v${target.versionName} (${target.versionCode})`,
  );
}
