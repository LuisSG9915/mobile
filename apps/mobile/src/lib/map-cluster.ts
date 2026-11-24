export type ClusterInput<T> = { item: T; screenX: number; screenY: number };

export type Cluster<T> = {
  /** Elemento que se dibuja como portada del grupo. */
  item: T;
  /** Cantidad de elementos agrupados (1 = pin individual). */
  count: number;
  screenX: number;
  screenY: number;
};

/**
 * Agrupa marcadores por celdas de cuadrícula en pantalla. `preferredId` (el pin
 * seleccionado) gana como portada de su celda para no desaparecer al agrupar.
 * La posición del grupo es el centroide de sus miembros.
 */
export function clusterMarkers<T extends { id: string }>(
  markers: ClusterInput<T>[],
  cellPx: number,
  preferredId?: string | null,
): Cluster<T>[] {
  const cells = new Map<
    string,
    { cover: ClusterInput<T>; count: number; sx: number; sy: number }
  >();
  for (const m of markers) {
    const key = `${Math.floor(m.screenX / cellPx)}:${Math.floor(m.screenY / cellPx)}`;
    const cell = cells.get(key);
    if (!cell) {
      cells.set(key, { cover: m, count: 1, sx: m.screenX, sy: m.screenY });
      continue;
    }
    cell.count++;
    cell.sx += m.screenX;
    cell.sy += m.screenY;
    if (preferredId && m.item.id === preferredId) cell.cover = m;
  }
  return [...cells.values()].map((c) => ({
    item: c.cover.item,
    count: c.count,
    screenX: c.count === 1 ? c.cover.screenX : c.sx / c.count,
    screenY: c.count === 1 ? c.cover.screenY : c.sy / c.count,
  }));
}
