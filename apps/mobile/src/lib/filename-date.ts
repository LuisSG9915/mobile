/**
 * Fecha de captura inferida del NOMBRE de archivo, para fotos sin EXIF ni DATE_TAKEN
 * (capturas, WhatsApp, descargas). La fecha de modificación cambia al copiar o editar y
 * manda fotos viejas a "Hoy"; el nombre que pone la cámara/app suele conservar la fecha real.
 *
 * Reconoce `IMG_20261120_203012.jpg`, `IMG-20261118-WA0003.jpg`, `PXL_20261120_203012345.jpg`,
 * `Screenshot_2026-11-20-20-30-12.png`, `Screenshot_20261120-203012.png`, `VID_20261120.mp4`.
 * Devuelve hora de pared como epoch-UTC (convención de takenAt, ver wall-clock.ts); null si no hay
 * una fecha válida (2000 ≤ año, no futura). Sin hora usa las 12:00 para no cruzar de día.
 */
const DATE_RE =
  /(?:^|\D)(20\d{2})[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])(?:[-_ T]?(\d{2})[-_.]?(\d{2})[-_.]?(\d{2})\d*)?(?!\d)/;

export function dateFromFilename(
  filename: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!filename) return null;
  const m = DATE_RE.exec(filename);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss] = m;
  let h = 12;
  let min = 0;
  let sec = 0;
  if (hh !== undefined && +hh < 24 && +mi < 60 && +ss < 60) {
    h = +hh;
    min = +mi;
    sec = +ss;
  }
  const ts = Date.UTC(+y, +mo - 1, +d, h, min, sec);
  // Fecha imposible (31 de febrero → rueda al mes siguiente) o futura: se descarta.
  if (new Date(ts).getUTCDate() !== +d) return null;
  if (ts > nowMs + 24 * 3600_000) return null;
  return ts;
}
