/**
 * Preparación del APK sin EAS (H1.4): el plan gratuito de EAS se agotó, así que
 * el binario sale de `expo prebuild` + Gradle. `android/` está en `.gitignore`
 * (CNG), de modo que la firma y la versión se inyectan después de prebuild; si
 * no, el `assembleRelease` firma con la keystore de debug y dos builds no se
 * instalan una encima de otra.
 *
 * Reglas puras y testeables; `scripts/android-prepare.mjs` es el que escribe.
 */

/** `v1.2.3` → `{ versionName: "1.2.3", versionCode: 10203 }`. */
export function parseTagVersion(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag ?? "");
  if (!match) throw new Error(`tag no SemVer: ${tag} (se espera vMAJOR.MINOR.PATCH)`);
  const [, major, minor, patch] = match.map(Number);
  const versionCode = major * 10_000 + minor * 100 + patch;
  if (versionCode > 2_100_000_000) throw new Error(`versionCode fuera de rango para ${tag}`);
  return { versionName: `${major}.${minor}.${patch}`, versionCode };
}

/** Nombres de los secretos de firma, en un solo lugar. */
export const SIGNING_SECRETS = {
  keystoreBase64: "ANDROID_KEYSTORE_BASE64",
  storePassword: "ANDROID_KEYSTORE_PASSWORD",
  keyAlias: "ANDROID_KEY_ALIAS",
  keyPassword: "ANDROID_KEY_PASSWORD",
};

/**
 * Añade `signingConfigs.release` y hace que `buildTypes.release` lo use.
 * Idempotente: si ya está inyectado, devuelve el texto intacto.
 */
export function injectSigningConfig(gradle) {
  // Ojo: un patrón "signingConfigs { ... release {" atraviesa hasta el release de
  // buildTypes y daría falso positivo; la marca real es el storeFile inyectado.
  if (/signingConfigs\s*\{[\s\S]*?storeFile file\(RELEASE_STORE_FILE\)/.test(gradle)) return gradle;

  const signingBlock = `
        release {
            storeFile file(RELEASE_STORE_FILE)
            storePassword RELEASE_STORE_PASSWORD
            keyAlias RELEASE_KEY_ALIAS
            keyPassword RELEASE_KEY_PASSWORD
        }`;

  const withConfigs = gradle.replace(/signingConfigs\s*\{/, (head) => `${head}${signingBlock}`);
  if (withConfigs === gradle) {
    throw new Error("no se encontró 'signingConfigs {' en android/app/build.gradle");
  }

  // Solo el bloque release de buildTypes: el de debug debe seguir con su keystore.
  const patched = withConfigs.replace(
    /(buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
    "$1signingConfig signingConfigs.release",
  );
  if (patched === withConfigs) {
    throw new Error(
      "no se encontró 'signingConfig signingConfigs.debug' dentro de buildTypes.release",
    );
  }
  return patched;
}

/** Fija `versionCode`/`versionName` del módulo app. */
export function setVersion(gradle, { versionCode, versionName }) {
  let out = gradle;
  if (/\bversionCode\s+\d+/.test(out)) {
    out = out.replace(/\bversionCode\s+\d+/, `versionCode ${versionCode}`);
  } else {
    throw new Error("no se encontró 'versionCode <n>' en android/app/build.gradle");
  }
  if (/\bversionName\s+"[^"]*"/.test(out)) {
    out = out.replace(/\bversionName\s+"[^"]*"/, `versionName "${versionName}"`);
  } else {
    throw new Error("no se encontró 'versionName \"<x>\"' en android/app/build.gradle");
  }
  return out;
}

/** Propiedades de Gradle para la firma (se añaden a `android/gradle.properties`). */
export function gradlePropertiesForSigning({ alias, storePassword, keyPassword }) {
  if (!alias || !storePassword || !keyPassword) {
    throw new Error("firma incompleta: hacen falta alias, contraseña del almacén y de la clave");
  }
  return [
    "# Firma de release inyectada por scripts/android-prepare.mjs (no versionar).",
    "RELEASE_STORE_FILE=release.keystore",
    `RELEASE_STORE_PASSWORD=${storePassword}`,
    `RELEASE_KEY_ALIAS=${alias}`,
    `RELEASE_KEY_PASSWORD=${keyPassword}`,
  ];
}

/** Detecta que el blob descifrado es de verdad un almacén de claves. */
export function looksLikeKeystore(bytes) {
  if (!bytes || bytes.length < 4) return false;
  const hex = Buffer.from(bytes.subarray(0, 2)).toString("hex");
  return hex === "feed" || hex === "3082";
}

/** Ruta del APK que produce `assembleRelease`. */
export const RELEASE_APK_PATH = "apps/mobile/android/app/build/outputs/apk/release/app-release.apk";
