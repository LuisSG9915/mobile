/**
 * Estado de vista al saltar a un mes (`?before=`), extraído de la pantalla
 * para poder probarlo sin React Native.
 *
 * - `loading-month`: hay un mes elegido y su query aún no resuelve. Se pinta un
 *   overlay opaco sobre la lista (que sigue montada, S1-4) para no enseñar el
 *   swap a medias que dejaba la cuadrícula en negro (FlashList 2.0.2).
 * - `loading`: carga inicial sin nada que mostrar (ni locales, ni cola) — con
 *   fotos locales ya en pantalla no se tapa la cuadrícula mientras llega el
 *   remoto.
 * - `empty-month`: el mes resolvió sin fotos → mensaje claro + "Volver a todas".
 * - `error`: falló la carga del mes → reintentar en vez de negro.
 * - `null`: hay datos (o aplica el empty-state genérico de la galería).
 */
export type MonthJumpView = "loading-month" | "loading" | "empty-month" | "error";

export function monthJumpView({
  hasMonthScope,
  isPending,
  isError,
  rowCount,
}: {
  hasMonthScope: boolean;
  isPending: boolean;
  isError: boolean;
  rowCount: number;
}): MonthJumpView | null {
  if (isPending) {
    if (hasMonthScope) return "loading-month";
    return rowCount === 0 ? "loading" : null;
  }
  if (!hasMonthScope) return null;
  if (isError) return "error";
  // `buildGalleryRows` intercala un encabezado por día: con fotos el mínimo es
  // 2 filas. Una sola fila es un encabezado huérfano (swap a medias) que se ve
  // como pantalla vacía; mejor el mensaje que un header suelto sin celdas.
  return rowCount <= 1 ? "empty-month" : null;
}
