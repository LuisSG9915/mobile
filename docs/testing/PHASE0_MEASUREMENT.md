# Phase 0 — Measurement Checklist (Android Upload Reliability)

Objetivo: capturar baseline de rendimiento y fiabilidad de la subida en Android **antes** de tocar la estrategia. Los números resultantes gobiernan las decisiones de concurrencia, watchdog, backoff y memoria.

## Entorno

- Dispositivo físico Android (gama media, p. ej. Huawei LMR-LX9 o equivalente), API 34/35/36.
- Build dev-client (`npx expo run:android` o EAS profile `development`).
- Red: Wi-Fi estable y LTE (tethering); probar también offline→online.
- App en primer plano y minimizada; Doze activo para el caso de background.
- Logcat filtrado: `adb logcat -s ReactNativeJS:* | grep '\[queue\]'`.

## Preparación

1. Vaciar la cola y reiniciar la app.
2. Encolar un lote controlado de 50 fotos (≤5 MB c/u) y uno de 500.
3. Asegurar que `EXPO_PUBLIC_API_URL` apunta al API de producción o staging.
4. Abrir Android Studio Profiler (CPU + Memory) o Perfetto.

## Métricas a capturar

| Métrica | Cómo medirla | Objetivo de registro |
|---|---|---|
| Tiempo total de pasada (50 fotos) | Timestamps `processQueue:start` → `processQueue:done` | ms |
| Tiempo total de pasada (500 fotos) | Idem | ms |
| Tiempo por item (hashing) | `processItem:start` → cambio de estado a `uploading_thumb`/`uploading_original` | ms/item |
| Tiempo por item (upload) | estado `uploading_*` → `completing`/`done` | ms/item |
| Cadencia de progreso | intervalo entre `publishByteTick` (log o UI) | ms (objetivo ≤1000 ms) |
| Stalls (watchdog) | contador de `[queue] stall:watchdog` | count por pasada |
| Fallos por item | contador de `[queue] item:fail` con status/code | count por pasada |
| Peak RSS | Android Studio Profiler / Perfetto | MB |
| Tasa de éxito | done+duplicate / total | % (objetivo ≥99%) |
| Tiempo de arranque en frío | `processQueue:start` desde launch | ms |
| Comportamiento minimizado | notificación de progreso, pausa, reanudación | observación |
| Topología de proceso | `adb shell dumpsys activity` / logs | same-process vs. separate |

## Casos de prueba

1. **50 fotos, Wi-Fi, primer plano** — baseline principal.
2. **500 fotos, Wi-Fi, primer plano** — estrés de memoria y watchdog.
3. **50 fotos, LTE** — latencia de red y backoff.
4. **50 fotos, offline → online mid-pasada** — reanudación y retry.
5. **App minimizada durante pasada** — foreground service, notificación, Doze.
6. **Kill mid-upload (multipart)** — recuperación vía `recoverInterrupted` y resume de partes.
7. **Sesión expirada mid-pasada** — estado "auth required" y requeue.
8. **Cola con duplicados** — dedup SHA-256, sin PUTs para duplicados.

## Salida esperada

Registrar los números en `docs/decisions.md` o en una nota fechada. Estos datos gobiernan:
- Concurrencia de items (subir/bajar `UPLOAD_CONCURRENCY`).
- Umbral del watchdog (30 s no-byte-flow vs. 90 s SLO).
- Cap de backoff (actual 2 h; candidato 30 min).
- Presupuesto de memoria (provisional 256 MiB).
- Necesidad de lease cross-process, durable outbox, part-completion bitmap.

## Gate de salida de Phase 0

- [ ] Baseline documentado (100 MB/500 MB Wi-Fi+LTE, peak RSS, stall rate, progress cadence).
- [ ] Veredicto de topología de proceso (same vs. separate).
- [ ] Decisión de part size (5 MiB vs. 16 MiB).
- [ ] Decisión de crear `backoff.ts` (solo si retry storms medidos).
- [ ] Decisión de lease cross-process (solo si procesos separados).