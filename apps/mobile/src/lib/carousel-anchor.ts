/**
 * Índice activo del carrusel anclado a la IDENTIDAD del elemento, no a una posición.
 *
 * La lista del visor (galería híbrida) cambia mientras está abierto: llegan páginas remotas, los
 * assets locales terminan de cargar, la cola enlaza elementos con su remoto. Con un índice guardado,
 * cualquier inserción por delante hacía que la misma posición mostrara OTRA foto o video.
 * `anchorKey` es la `key` del elemento que el usuario está viendo (null antes de deslizar).
 */
export function resolveActiveIndex(
  keys: readonly string[],
  anchorKey: string | null,
  foundIndex: number,
): number {
  if (anchorKey !== null) {
    const i = keys.indexOf(anchorKey);
    if (i >= 0) return i;
  }
  return foundIndex >= 0 ? foundIndex : 0;
}
