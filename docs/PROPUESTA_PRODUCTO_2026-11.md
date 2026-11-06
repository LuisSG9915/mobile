# Propuesta de producto — De respaldo a biblioteca (nov 2026)

> **Qué es este documento.** Una propuesta de producto, no un cambio del tablero.
> La fuente de verdad sigue siendo [`PLAN_MEJORAS.md`](PLAN_MEJORAS.md): H1 abierto ⇒ no se abre
> feature nuevo. Por eso separo **pulido de honestidad** (se puede hacer ya, son bugs y promesas
> incumplidas) de **apuestas de producto** (backlog post-H1).
>
> **Supuestos respetados:** producto personal, Android + web, cuota dura de 10 GB, sin iOS público,
> sin colaboración multiusuario. Todo lo que sigue cabe en esas decisiones.
>
> **Ejecución del tramo 1:** guion para Gemini 3.8 Flash en
> [`GEMINI_3_8_FLASH_PULIDO_2026-11.md`](GEMINI_3_8_FLASH_PULIDO_2026-11.md) y puerta de
> verificación en [`scripts/gemini-gate-pulido.mjs`](../scripts/gemini-gate-pulido.mjs).

---

## 1. Lectura ejecutiva

Photos ya tiene más producto del que aparenta: galería híbrida, cola nativa y web, dedup SHA-256,
álbumes, shares, mapa, recuerdos, búsqueda FTS5, etiquetado con IA, limpiador de ráfagas, editor,
optimizador de compartición por presets y visor con EXIF. La base técnica es seria y el ahorro
estructural (R2 sin egress, Worker sin binarios, procesamiento en el cliente) es una ventaja real.

El problema no es falta de features. Es que **la biblioteca promete más de lo que cumple en cuatro
momentos que deciden la confianza**: restaurar, verificar, compartir y entender el espacio. Y hay
funciones que existen a medias, con una UI que las presenta como completas. Eso es peor que no
tenerlas: el usuario descubre la mentira en el peor momento.

La tesis de esta propuesta:

> **Photos no compite por subir archivos; compite por ser el lugar donde tu biblioteca se entiende,
> se recupera y se comparte sin perder calidad.** La ventaja no es copiar a Google Fotos en
> reconocimiento facial o edición avanzada —eso es caro y nos haría perder privacidad—, sino hacer
> visible la confianza y convertir los datos que ya tenemos (fecha, GPS, EXIF, tags, thumbhash) en
> momentos de producto.

Cinco apuestas, en orden:

| # | Apuesta | Qué cambia para el usuario | Esfuerzo |
|---|---------|----------------------------|:--------:|
| A | **Confianza visible** | “Sé que mis fotos están, puedo recuperarlas y la app no me miente” | M–L |
| B | **Encontrar sin buscar** | “Escribo lo que recuerdo y aparece; también el texto de una captura” | M |
| C | **Viajes y recuerdos** | “Mi biblioteca me devuelve cosas, no solo las guarda” | M |
| D | **Compartir sin perder calidad** | “El enlace que comparto es real y caduca cuando digo” | S–M |
| E | **Cada byte cuenta** | “Sé qué ocupa, qué puedo borrar y cuánto me queda” | M |
| F | **Plataforma** (habilitador) | Web instalable, accesible, traducible y mantenible | M–L |

---

## 2. Lo que ya es diferencial (no tocar)

- **Cero egress y binarios fuera del Worker.** El PUT prefirmado y las claves por usuario son la
  decisión correcta; cualquier feature nueva debe respetarla.
- **Cola con dos implementaciones y contrato compartido** (`processor.ts` / `processor.web.ts`),
  dedup exacto y journal multipart. Es la base de la confianza.
- **Optimizador de compartición por presets** (`ShareMediaModal`, `share-optimizer`, `video-optimizer`):
  pocas apps personales explican “por qué Meta te recomprime”. Es un diferenciador narrativo.
- **Búsqueda FTS5 + etiquetas IA + lugares + EXIF.** Hay más materia prima de la que la UI usa.
- **Diseño de estados de sync** (`SyncBadge`, anillo, banner): la app ya “habla” de la cola.

La propuesta construye sobre esto; no propone reescribir el núcleo.

---

## 3. Hallazgos verificables: lo que promete y no cumple

Estos son los “pulir” concretos. Todos tienen evidencia en código y se pueden cerrar sin abrir H3.

| ID | Hallazgo | Evidencia | Impacto | Esf. |
|----|----------|-----------|:-------:|:----:|
| **P-01** | **El “enlace público” del visor no es público ni respeta la caducidad.** Copia la URL prefirmada actual (TTL 12 h); el selector 24 h/7 d/30 d/Nunca es cosmético; en nativo no hay clipboard y solo se muestra un toast de éxito. | [`ShareMediaModal.tsx:262-281`](../apps/mobile/src/ui/ShareMediaModal.tsx), [`media/[id].tsx:1795-1817`](../apps/mobile/src/app/media/%5Bid%5D.tsx), TTL en [`constants.ts:50-52`](../packages/shared/src/constants.ts) | **Alto** (seguridad + confianza) | S |
| **P-02** | **El editor es asimétrico.** En nativo guarda en el carrete y espera al siguiente escaneo; en web encola al instante. La UI ofrece 9:16, pero el editor web solo implementa 1:1, 4:3 y 16:9 (9:16 cae a 1:1). | [`image-editor.ts:72-87`](../apps/mobile/src/lib/image-editor.ts), [`image-editor.web.ts:39-76`](../apps/mobile/src/lib/image-editor.web.ts), [`PhotoEditorModal.tsx:20-26`](../apps/mobile/src/ui/PhotoEditorModal.tsx) | Alto | S |
| **P-03** | **La papelera muestra como máximo 100 elementos y no pagina.** La API soporta cursor; la UI no lo usa. Tampoco hay “restaurar todo” ni deshacer. | [`trash.tsx:15`](../apps/mobile/src/app/trash.tsx), default 100 en [`media.ts:184-188`](../apps/api/src/routes/media.ts) | Medio | S |
| **P-04** | **El mapa no agrupa pines y en web probablemente no carga.** Pide 500 elementos por página y pinta un pin por foto; el CSP de `public/_headers` no permite `basemaps.cartocdn.com` en `img-src`, así que las teselas se bloquean en producción web. | [`map.tsx:63-68`](../apps/mobile/src/app/map.tsx), [`map.tsx:289`](../apps/mobile/src/app/map.tsx), [`public/_headers`](../apps/mobile/public/_headers) | Medio–Alto | S–M |
| **P-05** | **El “limpiador de similares” agrupa por tiempo, no por similitud.** Solo junta fotos a ≤3 s; dos copias de la misma foto con minutos de diferencia nunca aparecen. | [`cleaner.ts:69-88`](../apps/api/src/routes/cleaner.ts) | Medio | M |
| **P-06** | **No hay flujo de restauración.** Existe descarga por elemento, selección y ZIP de álbum, pero no “restaurar mi biblioteca en este teléfono” con cola, progreso y verificación. Es el momento de verdad de una app de respaldo. | [`download-many.ts`](../apps/mobile/src/lib/download-many.ts), [`settings.tsx`](../apps/mobile/src/app/(tabs)/settings.tsx) | **Alto** | M–L |
| **P-07** | **La integridad solo se comprueba antes de borrar la copia local.** No hay “verificar mi biblioteca” ni informe de objetos faltantes. | [`free-space.ts:37-120`](../apps/mobile/src/lib/free-space.ts) | Alto | M |
| **P-08** | **Hay endpoints de lote sin UI:** etiquetado IA en lote y geocodificación en lote. El cliente los expone; ninguna pantalla los llama. | [`client.ts:217`](../apps/mobile/src/api/client.ts), [`client.ts:345`](../apps/mobile/src/api/client.ts) | Bajo | S |
| **P-09** | **i18n a medias:** un solo diccionario (`es.ts`) y textos hardcodeados en pantallas clave (“Sesión revocada”, “Datos exportados”, confirmaciones, avisos). No hay selector de idioma. | [`settings.tsx:49-153`](../apps/mobile/src/app/(tabs)/settings.tsx), [`backup.tsx:60`](../apps/mobile/src/app/(tabs)/backup.tsx), [`es.ts`](../apps/mobile/src/i18n/es.ts) | Medio (crecimiento) | M |
| **P-10** | **Accesibilidad escasa:** 77 props de accesibilidad en 17 archivos; el visor (1.830 líneas) tiene 10. `Button` no expone estado deshabilitado/cargando; las celdas no anuncian selección. | [`ui/index.tsx:42-47`](../apps/mobile/src/ui/index.tsx), [`media/[id].tsx`](../apps/mobile/src/app/media/%5Bid%5D.tsx) | Medio | M |
| **P-11** | **HEIC en web:** está en `ALLOWED_EXTENSIONS`, pero `createImageBitmap` no lo decodifica en Chrome/Edge; el archivo se rechaza con “este navegador no puede leer el formato”. | [`constants.ts:1-12`](../packages/shared/src/constants.ts), [`web/thumb.ts:25-30`](../apps/mobile/src/web/thumb.ts) | Medio | M |
| **P-12** | **Deuda de mantenibilidad:** visor 1.830 líneas, galería 1.274, `uploads.ts` 1.194; lógica de red, UI y estado en el mismo archivo. | [`media/[id].tsx`](../apps/mobile/src/app/media/%5Bid%5D.tsx), [`index.tsx`](../apps/mobile/src/app/(tabs)/index.tsx), [`uploads.ts`](../apps/api/src/routes/uploads.ts) | Medio (velocidad) | M |
| **P-13** | **Cumplimiento de geocodificación:** `geocode-batch` puede encadenar muchas llamadas a Nominatim/BigDataCloud sin throttling explícito; la política de Nominatim es ~1 req/s y atribución. | [`geo.ts`](../apps/api/src/lib/geo.ts), [`locations.ts:248-279`](../apps/api/src/routes/locations.ts) | Medio (legal/ops) | S |
| **P-14** | **Faltan capacidades de plataforma:** sin notificaciones (ni “respaldo terminado” ni “en este día”), sin share target del sistema, sin manifiesto/service worker PWA. | [`package.json`](../apps/mobile/package.json), [`public/`](../apps/mobile/public) | Medio | M |

---

## 4. Principios para elegir

1. **La confianza se demuestra, no se declara.** Cada promesa visual debe tener una prueba
   reproducible (test, endpoint, captura). Si no la tiene, se oculta o se marca “beta”.
2. **La ventaja es el cliente.** Miniatura, hash, preview, editor, optimización y (pronto) pHash se
   calculan en el dispositivo. El Worker sigue sin tocar binarios.
3. **Los datos que ya existen primero.** Antes de añadir una tabla, preguntar qué se puede hacer con
   `takenAt`, GPS, EXIF, tags, `thumbhash` y `sha256`.
4. **Una apuesta = un momento de usuario.** No “mejorar la búsqueda”: “encontrar el recibo de luz en
   5 segundos”. Cada ficha debe nombrar el momento.
5. **Nada de features nuevos con H1 abierto.** Lo único que se toca ya son bugs de honestidad y
   accesibilidad; el resto entra después de la release y el restore drill.

---

## 5. Las cinco apuestas

### A. Confianza visible — “mi biblioteca está, y puedo recuperarla”

**Insight.** El usuario no compra “almacenamiento”; compra la certeza de que no perderá fotos. Hoy
la app muestra progreso de subida, pero no responde a la pregunta que de verdad importa: *¿puedo
recuperar todo esto en un teléfono nuevo?*

**MVP.**
1. **Restaurar en este dispositivo**: wizard con “todo / por año / por álbum”, cola de descargas
   reanudable (misma tabla de cola, tipo `download`), progreso, verificación SHA-256 al guardar y
   detección de duplicados locales.
2. **Verificar biblioteca**: job por muestreo o completo que compara D1 con `HEAD` en R2; informe
   con faltantes, tamaño y última verificación; botón “Verificar ahora” en Ajustes.
3. **Recibo de respaldo**: resumen semanal local (“12 fotos, 340 MB, 0 fallos; última copia hace 2
   días”) y notificación local. Sin servidor de push ni datos personales.
4. **Estado honesto de segundo plano** (H1.9): copy de Android igual a `noteIos`, retirar el permiso
   huérfano y distinguir “subiendo” de “en pausa por el sistema”.

**Por qué nosotros.** Ya existe la cola, el hash, el `HEAD` y la verificación remota; falta
convertirlos en una experiencia de recuperación.

**Esfuerzo.** M–L (A1 es el grueso). **Métrica.** % de bibliotecas con copia <7 días y verificación
pasada; restore drill exitoso; tiempo a “primer restore” <10 min.

**Riesgo.** Descargar 10 GB en un móvil es lento y consume datos: por defecto, solo Wi-Fi, por
rangos, y con pausa/reanudación visible.

---

### B. Encontrar sin buscar — “escribo lo que recuerdo”

**Insight.** La búsqueda actual es buena para etiquetas y pies de foto, pero el usuario recuerda
*contenido*: “el recibo del hotel”, “la foto del pizarrón”, “el vuelo de julio”. Hoy no hay OCR ni
lenguaje natural.

**MVP.**
1. **OCR de capturas y documentos** (opt-in): al subir una captura/documento, un modelo de visión de
   Workers AI extrae texto; se guarda una columna `ocr_text` y se indexa en FTS5. Buscar “recibo”,
   “IBAN”, “vuelo” encuentra la imagen. El texto se borra con el medio y se excluye del export si el
   usuario lo pide.
2. **Consulta natural sin IA**: parser local de “playa 2023”, “videos >50 MB”, “cámara Canon”,
   “favoritos de octubre” → parámetros existentes de `/v1/search`. Cero coste, cero latencia.
3. **Filtros de fotógrafo**: cámara, lente, ISO y focal (ya están en D1 y se muestran en el visor),
   más “capturas”, “documentos” y “sin ubicación”.
4. **Búsquedas guardadas**: “Capturas >10 MB”, “Videos sin favoritos”, “Todo de Canon” como chips
   persistentes.

**Por qué nosotros.** Ya pagamos etiquetado IA y ya tenemos FTS5; el OCR es el puente que falta
entre “foto” y “documento”.

**Esfuerzo.** M. **Métrica.** CTR de resultados, tasa de búsquedas con 0 resultados, búsquedas
semanales por usuario activo.

**Riesgo.** Coste/latencia de visión y privacidad de documentos. Mitigación: solo capturas/documentos
por defecto, opt-in para el resto, límite por usuario/día y borrado del texto con el medio.

---

### C. Viajes y recuerdos — “mi biblioteca me devuelve cosas”

**Insight.** `MemoriesBar` ya muestra “En este día”, pero es una vista pasiva y a menudo vacía. Los
datos para algo mucho mejor ya están: GPS, ciudad, fechas, tags, favoritos.

**MVP.**
1. **Viajes automáticos**: agrupar por hueco temporal (>12 h) y distancia; “Viaje a Oaxaca · 12–18
   oct · 143 fotos”; portada, mapa y álbum generado. Sin configuración.
2. **Álbumes inteligentes** (solo lectura al principio): reglas guardadas tipo “Favoritos 2025”,
   “Capturas”, “Videos >100 MB”, “Todo de Canon”. Se recalculan solos; el usuario puede convertirlos
   en álbum estático.
3. **Recap**: “Tu año en 20 fotos” curado con favoritos, variedad de fechas/lugares, exclusión de
   capturas/documentos y sin duplicados; exportable como historia 9:16 (reutiliza el player y los
   presets que ya existen).
4. **Notificación local** de “En este día”/recap semanal, con opt-in y hora elegida.

**Por qué nosotros.** Es la apuesta creativa con mejor relación coste/emoción: no requiere nueva
infraestructura, solo consultas y una buena curaduría.

**Esfuerzo.** M. **Métrica.** Recuerdos abiertos/semana, álbumes creados desde un viaje, shares
originados en recuerdos, retención D30.

**Riesgo.** Curaduría mala = “esto no es un recuerdo”. Empezar con reglas conservadoras y permitir
“no me interesa”.

---

### D. Compartir sin perder calidad — “el enlace es real”

**Insight.** El optimizador por presets es un diferenciador real, pero el “enlace público” del visor
es una promesa falsa (P-01). Además, compartir desde otra app hacia Photos no existe.

**MVP.**
1. **Enlaces reales por foto**: token propio, caducidad efectiva (24 h/7 d/30 d/nunca), descarga
   opcional, revocación y límite de visitas. Misma UI, backend honesto. Mientras no exista, ocultar
   el bloque o etiquetarlo “beta”.
2. **Controles de share de álbum visibles**: caducidad, permitir descarga y revocar (la API ya los
   tiene; la UI no los expone completos).
3. **Share target del sistema**: “Compartir → Photos” desde WhatsApp/Galería/Cámara; encola al
   instante. Es la feature que más reduce fricción en el uso diario.
4. **Compartir en lote con preset**: seleccionar 20 fotos y “optimizar para WhatsApp/Historias” en
   una sola cola, con progreso y carpeta destino.

**Por qué nosotros.** Ya tenemos el optimizer, la cola y los presets; falta el contrato social del
enlace.

**Esfuerzo.** S–M (enlaces), M (share target nativo). **Métrica.** Enlaces creados, visitas,
descargas, shares por usuario/mes.

**Riesgo.** Seguridad de enlaces públicos: token largo, rate limit, `noindex`, `allowDownload`
explícito y revocación inmediata. Ya hay precedente en álbumes.

---

### E. Cada byte cuenta — “sé qué ocupa y qué puedo borrar”

**Insight.** La cuota es dura (10 GB) y la app solo muestra “usados”. El usuario no sabe si lo que
ocupa son vídeos, la papelera, miniaturas o duplicados. El limpiador actual solo detecta ráfagas.

**MVP.**
1. **Desglose de almacenamiento**: por tipo (originales, miniaturas, previews, papelera), por año y
   top 20 archivos; gráfico simple y acciones.
2. **Asesor de espacio**: recomendaciones accionables (“vaciar papelera: 1,2 GB”, “18 vídeos >100 MB
   sin favoritos: 3,4 GB”, “capturas duplicadas: 240 MB”), con previsualización y confirmación.
3. **Dedup perceptual real**: calcular un hash visual (dHash/pHash) desde el `thumbhash` que ya se
   guarda al subir; agrupar similares por distancia de Hamming, no por tiempo; sugerir “conservar la
   de mayor resolución/favorita”. Esto convierte el limpiador en lo que su nombre promete.
4. **Pronóstico de cuota**: “a este ritmo te quedan ~43 días”; aviso al 80/90 %.

**Por qué nosotros.** El `thumbhash` ya está en cada fila; el hash perceptual es casi gratis y no
sale del dispositivo.

**Esfuerzo.** M. **Métrica.** GB liberados por usuario, % de papelera vaciada, % de usuarios <80 %
de cuota, reducción de “cuota llena” como motivo de abandono.

**Riesgo.** Borrar de más. Nunca borrar automáticamente; siempre papelera + confirmación + deshacer.

---

## 6. Habilitadores de plataforma

No son “features” que se vean, pero sin ellos las apuestas se caen:

| ID | Habilitador | Por qué ahora | Esf. |
|----|-------------|---------------|:----:|
| **F1** | **PWA instalable + shell offline** | Web ya es primera clase; hoy no se puede instalar ni abrir sin red. Manifest, service worker, caché de miniaturas y cola visible. | M |
| **F2** | **i18n completa (es/en)** | Cerrar P-09, extraer textos, selector de idioma y formatos de fecha/número. Es requisito para crecer fuera de LATAM. | M |
| **F3** | **Accesibilidad** | TalkBack/VoiceOver, roles, labels, `accessibilityState`, dynamic type, reduce motion y contraste en las 5 pantallas clave. | M |
| **F4** | **Refactor de monolitos** | Extraer hooks y componentes del visor/galería/`uploads.ts`; congelar el comportamiento con tests antes de tocar. | M |
| **F5** | **E2E nativo y cobertura** | Maestro/Detox para onboarding, permiso limitado, 30 MB, kill/resume, restore; umbral de cobertura en módulos críticos. | M–L |
| **F6** | **Presupuesto de rendimiento** | Cold start, FPS de scroll, p95 de timeline, MB/s de subida y tamaño de miniatura como criterios de release. | S |

---

## 7. Priorización

### 7.1 Matriz impacto / esfuerzo

```
Impacto
  alto │  A1 restore      A2 integridad     B1 OCR
       │  E1 desglose     D1 enlaces        C1 viajes
       │  F1 PWA          E3 dedup          C3 recap
  medio│  P-01..P-04      F2 i18n           D2 share target
       │  P-09/P-10       F3 a11y           F5 E2E nativo
  bajo │  P-08            F6 perf           -
       └────────────────────────────────────────────────
           S                M                  L     Esfuerzo
```

### 7.2 Secuencia

**Ahora (0–2 semanas, dentro de H1; solo pulido y honestidad):**
P-01 (ocultar o arreglar el enlace), P-02 (paridad del editor), P-03 (papelera paginada),
P-04 (CSP del mapa + clustering básico), P-09/P-10 (textos y a11y de las acciones principales),
P-11 (versión y permiso huérfano), P-13 (throttle de geocodificación).

**Después de cerrar H1 (semanas 3–6):**
A1 restaurar, A2 verificar, A3 recibo, E1 desglose, E2 asesor, D1 enlaces reales, D3 controles de
share de álbum, C2 álbumes inteligentes (solo lectura).

**Semanas 7–10:**
B1 OCR, B2 consulta natural, B3 filtros de fotógrafo, C1 viajes, C3 recap, F1 PWA, E3 dedup
perceptual.

**Semanas 11–14:**
F2 i18n en, F3 a11y, F4 refactor del visor, F5 E2E nativo, D2 share target.

**Después (3–6 meses):**
Live Photos/Motion Photos, HEIC en web con decodificador WASM, widget “En este día”, export ZIP
completo, iOS si se decide.

---

## 8. Roadmap de 90 días (post-H1)

| Semana | Entregable | Criterio de salida |
|:------:|------------|--------------------|
| 1–2 | Pulido P-01…P-04, P-09…P-11, P-13 | `pnpm lint`, `typecheck`, `test` verdes; CSP del mapa probado en web; enlace del visor honesto o real |
| 3–4 | Restaurar A1 + Verificar A2 | Restaurar 100 fotos en un dispositivo limpio; informe de integridad con 0 faltantes; test de reanudación |
| 5–6 | Desglose E1 + Asesor E2 + Enlaces D1 | `/storage/breakdown` con tests; enlace caduca de verdad; descarga opcional revocable |
| 7–8 | OCR B1 + filtros B3 + álbumes inteligentes C2 | Buscar texto de una captura; filtro por cámara; álbum “Favoritos 2025” se recalcula |
| 9–10 | Viajes C1 + Recap C3 + PWA F1 | Un viaje detectado y abierto; recap 9:16 compartible; app instalable y shell offline |
| 11–12 | Dedup E3 + i18n F2 + a11y F3 | Similaridad real agrupa copias con 10 min de diferencia; inglés completo; auditoría a11y de 5 pantallas |
| 13–14 | E2E nativo F5 + refactor F4 | Kill/resume y restore en CI; visor <800 líneas sin regresiones |

**Regla de salida:** cada semana cierra con evidencia enlazada (test, captura, workflow), no con un
`[x]` en un documento.

---

## 9. Métricas

**North Star:** *% de bibliotecas verificadas* = usuarios con última copia <7 días **y** verificación
de integridad pasada **y** al menos un restore de prueba exitoso.

| Área | Métrica | Objetivo |
|------|---------|:--------:|
| Activación | Primer backup completo <5 min | ≥80 % |
| Confianza | Upload success / 5xx | ≥99 % / <0,5 % |
| Confianza | Restore exitoso en drill | 100 % |
| Integridad | Faltantes detectados y reparados | 0 sin resolver >7 días |
| Descubrimiento | Búsquedas con clic tras resultado | ≥40 % |
| Descubrimiento | Búsquedas con 0 resultados | <15 % |
| Memoria | Recuerdos abiertos / semana | ≥25 % de activos |
| Compartir | Shares por usuario / mes | +30 % tras enlaces reales |
| Espacio | GB liberados / usuario / mes | medir y fijar |
| Calidad | Crash-free sessions | ≥99,5 % |
| Calidad | Cobertura módulos críticos | ≥80 % |

Instrumentación: eventos sin PII en Workers Analytics Engine (o logs estructurados) para
`backup_completed`, `restore_started/completed`, `search_performed` (solo conteo y filtros),
`share_created`, `memory_opened`, `cleanup_completed`. Nada de contenido ni coordenadas.

---

## 10. Primeros tickets listos para tomar

1. **`fix(share)` — Enlace honesto.** Ocultar el bloque “Enlace público” hasta que exista token real,
   o implementar `POST /v1/media/{id}/share` con `expiresIn`, `allowDownload` y `revoke`. Añadir
   `expo-clipboard` para nativo. *AC:* el enlace copiado caduca de verdad; revocar devuelve 404; test
   de API y E2E web.
2. **`fix(web)` — CSP del mapa.** Añadir `https://*.basemaps.cartocdn.com` a `img-src`; test que
   carga una tesela en `next`/Playwright. *AC:* el mapa pinta en producción web.
3. **`fix(editor)` — Paridad.** Implementar 9:16 en web; en nativo encolar la edición al instante
   (o mostrar “se respaldará al escanear”). *AC:* mismo resultado en web y Android; test de
   proporciones.
4. **`fix(trash)` — Paginación.** `useInfiniteQuery` con cursor, “Restaurar todo”, deshacer.
   *AC:* 250 elementos en papelera, todos visibles y restaurables.
5. **`feat(a11y)` — Acciones principales.** `accessibilityState` en `Button`, labels en celdas
   (seleccionada/no), acciones del visor y del banner. *AC:* TalkBack recorre galería → visor →
   descargar sin saltos.
6. **`feat(api)` — `/v1/user/storage/breakdown`.** Por tipo, por año, top 20 y papelera; tests con
   datos sembrados. *AC:* suma cuadra con `usedBytes`.
7. **`feat(cleaner)` — dHash.** Columna `visual_hash`, cálculo desde `thumbhash` al subir, endpoint
   de clusters por Hamming, “conservar mejor”. *AC:* dos copias con 10 min de diferencia se agrupan;
   no hay falsos positivos en un set de 100 fotos.
8. **`feat(restore)` — Cola de descarga.** Tipo `download` en la cola, reanudable, verificación
   SHA-256, solo Wi-Fi por defecto. *AC:* matar la app a mitad y reanudar sin duplicar.
9. **`feat(web)` — PWA.** `manifest.json`, service worker de shell, caché de miniaturas, banner de
   instalación. *AC:* Lighthouse PWA instalable; recarga offline muestra la galería cacheada.
10. **`chore(i18n)` — Extracción.** Mover textos hardcodeados a `es.ts`, añadir `en.ts` y selector.
    *AC:* `rg 'toast\.(success|error|info)\("'` sin resultados en `app/`.

---

## 11. Lo que no haría ahora (y por qué)

| Idea | Por qué no | Cuándo revisar |
|------|------------|----------------|
| Álbumes colaborativos / familia | Cambia permisos, cuotas y shares; la decisión vigente es personal | H3.4 + threat model |
| Reconocimiento facial en la nube | Privacidad y coste; el valor no compensa el riesgo | Solo on-device, si alguna vez |
| Editor avanzado (curvas, capas) | No es nuestra ventaja; el móvil ya tiene editor | Nunca como prioridad |
| Transcodificación de vídeo en el Worker | Rompe la regla de “el Worker no toca binarios”; coste de CPU | Si hay demanda medida |
| iOS publicada | Requiere cuenta, QA y soporte; Android + web primero | H3.4 |
| Live Photos / Motion Photos | Cambia modelo de media, dedup y visor | Tras restore y dedup |
| “IA generativa” de imágenes | No es el trabajo de una biblioteca personal | No |
| Multiusuario con cuotas compartidas | Rediseño de `user_storage_stats` y auth | H3.4 |

---

## 12. Riesgos de la propuesta

| Riesgo | Prob. | Impacto | Mitigación |
|--------|:-----:|:-------:|------------|
| Scope creep: abrir features con H1 abierto | Alta | Alto | Este documento no toca el tablero; solo P-01…P-04 son “ahora” |
| Coste/latencia de OCR y etiquetado | Media | Medio | Opt-in, límite por usuario/día, modelo pequeño, cola por lotes |
| Restore lento o costoso en datos móviles | Alta | Medio | Solo Wi-Fi, por rangos, pausa/reanudación, progreso honesto |
| Enlaces públicos mal asegurados | Media | Alto | Token largo, rate limit, `noindex`, revocación, `allowDownload` explícito |
| Migraciones de OCR/pHash | Media | Medio | Columnas nullable, backfill por lotes, rollback documentado |
| Geocodificación fuera de política | Media | Medio | Throttle 1 req/s, caché por celda, atribución y fallback propio |
| Deuda de monolitos frena las apuestas | Alta | Medio | Refactor del visor antes de A1/C3; tests de contrato primero |
| Métricas sin privacidad | Baja | Alto | Sin contenido ni coordenadas; solo conteos y tipos |

---

## 13. Cierre

Si tuviera que elegir **una sola cosa** para los próximos 30 días, sería **A1 + A2: restaurar y
verificar**. Es lo que convierte “app de fotos con nube” en “respaldo en el que confío”, y además
obliga a cerrar la deuda de la cola, la verificación y el estado honesto que H1 ya persigue.

Si tuviera que elegir **una sola apuesta creativa** para los próximos 90 días, sería **C1 + C3:
viajes y recap**. Es la que más emoción produce por unidad de esfuerzo, usa datos que ya tenemos y
diferencia el producto sin competir con Google Fotos en presupuesto de IA.

Y antes de cualquiera de las dos: **P-01**. Un enlace que dice caducar y no caduca es exactamente el
tipo de detalle que destruye la confianza que todo lo demás intenta construir.
