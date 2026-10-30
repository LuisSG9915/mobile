import assert from "node:assert/strict";
import test from "node:test";
import {
  gradlePropertiesForSigning,
  injectSigningConfig,
  looksLikeKeystore,
  parseTagVersion,
  setVersion,
} from "./lib/android-release.mjs";

// Extracto fiel de la plantilla que genera `expo prebuild` (android/app/build.gradle).
const GRADLE = `android {
    namespace 'com.photosR2.app'
    defaultConfig {
        applicationId 'com.photosR2.app'
        minSdkVersion rootProject.ext.minSdkVersion
        versionCode 1
        versionName "1.0.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableProguardInReleaseBuilds
        }
    }
}
`;

test("parseTagVersion convierte el tag en versionName y versionCode", () => {
  assert.deepEqual(parseTagVersion("v1.2.3"), { versionName: "1.2.3", versionCode: 10203 });
  assert.deepEqual(parseTagVersion("v12.0.7"), { versionName: "12.0.7", versionCode: 120007 });
});

test("parseTagVersion rechaza tags que no son vX.Y.Z", () => {
  assert.throws(() => parseTagVersion("1.2.3"), /no SemVer/);
  assert.throws(() => parseTagVersion("v1.2"), /no SemVer/);
  assert.throws(() => parseTagVersion(undefined), /no SemVer/);
});

test("injectSigningConfig firma el release con su keystore y deja debug intacto", () => {
  const patched = injectSigningConfig(GRADLE);
  assert.match(patched, /signingConfigs \{\s*release \{/);
  assert.match(patched, /storeFile file\(RELEASE_STORE_FILE\)/);
  // debug sigue usando la suya, release ya no.
  assert.equal(patched.match(/signingConfig signingConfigs\.debug/g).length, 1);
  assert.equal(patched.match(/signingConfig signingConfigs\.release/g).length, 1);
  assert.ok(patched.indexOf("signingConfigs.debug") < patched.indexOf("signingConfigs.release"));
});

test("injectSigningConfig es idempotente", () => {
  const once = injectSigningConfig(GRADLE);
  assert.equal(injectSigningConfig(once), once);
});

test("injectSigningConfig falla claro si cambia la plantilla", () => {
  assert.throws(() => injectSigningConfig("android { }"), /signingConfigs/);
  const sinReleaseDebug = GRADLE.replace(
    /(\s+release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
    "$1",
  );
  assert.throws(() => injectSigningConfig(sinReleaseDebug), /buildTypes\.release/);
});

test("setVersion fija versionCode y versionName", () => {
  const patched = setVersion(GRADLE, { versionCode: 10200, versionName: "1.2.0" });
  assert.match(patched, /versionCode 10200/);
  assert.match(patched, /versionName "1.2\.0"/);
  assert.doesNotMatch(patched, /versionCode 1\n/);
});

test("setVersion falla si el Gradle no trae los campos", () => {
  assert.throws(
    () => setVersion("android { }", { versionCode: 1, versionName: "1.0.0" }),
    /versionCode/,
  );
  assert.throws(
    () => setVersion("versionCode 1", { versionCode: 2, versionName: "2.0.0" }),
    /versionName/,
  );
});

test("gradlePropertiesForSigning lleva alias y contraseñas", () => {
  const lines = gradlePropertiesForSigning({
    alias: "photos",
    storePassword: "secreto",
    keyPassword: "secreto2",
  });
  assert.deepEqual(lines, [
    "# Firma de release inyectada por scripts/android-prepare.mjs (no versionar).",
    "RELEASE_STORE_FILE=release.keystore",
    "RELEASE_STORE_PASSWORD=secreto",
    "RELEASE_KEY_ALIAS=photos",
    "RELEASE_KEY_PASSWORD=secreto2",
  ]);
  assert.throws(
    () => gradlePropertiesForSigning({ alias: "", storePassword: "x", keyPassword: "y" }),
    /firma incompleta/,
  );
});

test("looksLikeKeystore distingue JKS/PKCS12 de un blob corrupto", () => {
  assert.equal(looksLikeKeystore(Buffer.from("feedfeed", "hex")), true);
  assert.equal(looksLikeKeystore(Buffer.from("3082012345", "hex")), true);
  assert.equal(looksLikeKeystore(Buffer.from("<html>404", "utf8")), false);
  assert.equal(looksLikeKeystore(Buffer.alloc(0)), false);
});

test("cadena completa: inyectar firma y versión sobre la plantilla real", () => {
  const patched = setVersion(injectSigningConfig(GRADLE), parseTagVersion("v1.3.0"));
  assert.match(patched, /versionCode 10300/);
  assert.match(patched, /versionName "1\.3\.0"/);
  assert.match(patched, /signingConfig signingConfigs\.release/);
});
