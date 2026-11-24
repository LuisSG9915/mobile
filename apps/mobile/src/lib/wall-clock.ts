/**
 * Convención de fechas de captura: el EXIF no lleva zona horaria, así que `takenAt`
 * guarda la hora de pared como si fuera UTC (ver `parseExifDate` en queue/processor.ts)
 * y todo se agrupa/muestra con `getUTC*`.
 *
 * Las marcas de tiempo del sistema (MediaStore: DATE_TAKEN, DATE_MODIFIED) son epoch
 * real. Para compararlas o mostrarlas junto a las de EXIF hay que pasarlas a hora de
 * pared; si no, en UTC-6 una captura de las 20:00 cae en el día siguiente.
 */
export function toWallClockUtc(epochMs: number): number {
  return epochMs - new Date(epochMs).getTimezoneOffset() * 60_000;
}
