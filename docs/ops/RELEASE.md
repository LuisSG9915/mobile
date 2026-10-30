# Release de la app (APK + `/version`)

Una release es **un tag, un binario y una nota fechada**. No es un commit con
`## [Unreleased]` lleno ni un workflow en verde: `v1.0.9` y `v1.1.0` quedaron
etiquetadas y publicadas **sin APK** porque el job `Release APK` falló y nada lo
impidió. La compuerta que lo evita está en `scripts/lib/release-audit.mjs`.

El binario lo produce **Gradle**, no EAS: el plan gratuito de EAS está agotado y
era la causa real de las dos releases vacías. La preparación de firma y versión
está en `scripts/android-prepare.mjs`.

## 1. Antes de etiquetar (local)

```bash
# 1. Fechea las notas: los bullets de [Unreleased] se mueven a la versión nueva.
#    La compuerta falla si [Unreleased] no queda vacía o si la sección no tiene fecha ni notas.
pnpm lint:fix && pnpm typecheck && pnpm test:all

# 2. Preflight en seco (no crea nada):
pnpm release:check --tag v1.2.0 --allow-dirty

# 3. Árbol limpio y commit de la release:
git add -A && git commit -m "release: v1.2.0"

# 4. Preflight real (sin --allow-dirty):
pnpm release:check --tag v1.2.0
```

La compuerta comprueba, en este orden:

| # | Regla | Por qué |
|---|---|---|
| 1 | tag `vMAJOR.MINOR.PATCH` y **sin crear** | una release no se re-publica |
| 2 | árbol limpio | el tag debe describir un commit, no cambios a medias |
| 3 | `CHANGELOG.md` con `## [X.Y.Z] - YYYY-MM-DD` y ≥1 nota | una versión sin notas no dice qué cambió |
| 4 | `[Unreleased]` **vacía** (solo en local; en CI se audita con `--allow-existing` y esas notas son de la release siguiente) | notas sin fechar no viajan en una release |
| 5 | el deploy inyecta `APP_VERSION` y `GIT_SHA` | si no, `/version` miente (`dev`/`unknown`) |
| 6 | el workflow de APK se dispara con tags `v*` | un tag debe producir binario |
| 7 | migraciones del journal con su `.sql` | el deploy remoto fallaría a mitad |

`--allow-existing` audita un tag ya publicado (útil para diagnosticar).
`--json` devuelve `{ ok, tag, problems, notes }` para scripts.

## 2. Firma: una sola keystore de release

El `versionCode` sale del tag (`v1.2.3` → `10203`) y el APK se firma con una
keystore propia. **Debe ser siempre la misma**: si cambia, Android rechaza la
actualización y Obtainium no puede instalar la versión nueva encima.

```bash
# Una vez, en local (keytool viene con el JDK):
keytool -genkeypair -v -storetype PKCS12 \
  -keystore photos-release.keystore -alias photos \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Photos, O=Personal, C=MX"

# Secretos en GitHub (nunca al repo):
base64 -i photos-release.keystore | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD   # contraseña del almacén
gh secret set ANDROID_KEY_ALIAS           # photos
gh secret set ANDROID_KEY_PASSWORD        # contraseña de la clave

# El .apk y el .keystore no se versionan (*.apk ya está en .gitignore).
```

Variables que usa el build: `vars.EXPO_PUBLIC_API_URL` (repo variable),
`secrets.EXPO_PUBLIC_SENTRY_DSN` y `secrets.SENTRY_AUTH_TOKEN` (opcionales).

Prueba local sin escribir nada (valida las plantillas de prebuild):

```bash
cd apps/mobile && npx expo prebuild --platform android --clean --no-install && cd ../..
node scripts/android-prepare.mjs --tag v1.2.0 --dry-run
```

Compilar el APK en local (necesita JDK 17+ y Android SDK; solo arquitecturas de
teléfono — los emuladores usan dev-client):

```bash
export ANDROID_KEYSTORE_BASE64=$(base64 -i photos-release.keystore | tr -d '\n')
export ANDROID_KEYSTORE_PASSWORD=... ANDROID_KEY_ALIAS=photos ANDROID_KEY_PASSWORD=...
node scripts/android-prepare.mjs --tag v1.2.0
EXPO_PUBLIC_API_URL=https://photos-api.luis-sg9915.workers.dev \
  apps/mobile/android/gradlew -p apps/mobile/android assembleRelease \
  -PreactNativeArchitectures=arm64-v8a
# → apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

## 3. Etiquetar y publicar

```bash
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin main --tags
```

El push del tag dispara `.github/workflows/release-apk.yml`:

1. **Preflight** (`release-check --tag … --allow-existing`): un tag mal preparado
   falla en segundos, no después de 15 minutos de Gradle.
2. `expo prebuild` (CNG) + `android-prepare` (firma y versión).
3. `./gradlew assembleRelease --no-daemon` con `pipefail` y el log subido como
   artifact `gradle-build-<tag>` (también cuando falla).
4. **Verificación del APK**: existe y empieza por `PK` (un ZIP real, no un HTML
   de error).
5. Checklist nativo → `prerelease` o estable.
6. Publica la release, la **actualiza** si ya existía (`--clobber`), y falla si el
   activo publicado no trae `.apk`.

## 4. Verificar la release (post-publicación)

```bash
gh release view v1.2.0 --json assets --jq '[.assets[].name]'

curl -s https://photos-api.luis-sg9915.workers.dev/version
# → { "version": "<APP_VERSION>", "commit": "<GIT_SHA>" }
```

El APK compilado con `arm64-v8a` + `armeabi-v7a` pesa ~70 MB; los emuladores
(x86/x86_64) quedan fuera a propósito.

En el móvil, la versión visible viene del binario (`appVersion()`/`appBuild()` en
`apps/mobile/src/lib/telemetry.ts`), así que `versionName`/`versionCode` del tag
son los que se ven en la app.

## 5. Si el build falla

El tag ya está publicado: no se borra ni se re-etiqueta (la compuerta lo impide).
Se **re-ejecuta** el workflow sobre el mismo tag:

```bash
gh workflow run release-apk.yml -f tag=v1.2.0
```

Fallos típicos y dónde mirar:

| Síntoma | Causa | Arreglo |
|---|---|---|
| `android-prepare: falta ANDROID_KEYSTORE_BASE64` | secreto sin crear | §2 |
| `no se encontró 'signingConfigs {'` | la plantilla de prebuild cambió | ajustar `scripts/lib/android-release.mjs` + sus tests |
| Gradle falla en `:app:bundleReleaseJsAndAssets` | falta `EXPO_PUBLIC_API_URL` | repo variable |
| `An organization ID or slug is required` | falta `SENTRY_ORG`/`SENTRY_PROJECT` (o token) | repo variables + `SENTRY_DISABLE_AUTO_UPLOAD` |
| APK instalado no actualiza | keystore distinta | restaurar la keystore original |
| Release existe sin APK | build anterior fallido | re-ejecutar: el paso de release actualiza |

## 6. Rollback

Un binario malo no se "des-publica": se publica la versión siguiente con el fix
(y el `versionCode` del tag debe ser mayor). Para el API/web y para D1 existe
`.github/workflows/rollback.yml` (ver [ROLLBACK.md](ROLLBACK.md)): exige escribir
`ROLLBACK` como confirmación, usa el environment `production` y restaura D1 a una
**base nueva** (nunca sobre la viva).
