/**
 * Tope de parámetros vinculados por consulta en D1: 100 (ver
 * https://developers.cloudflare.com/d1/platform/limits/). Las rutas que
 * reciben listas del cliente deben consultar en trozos menores.
 */
export const D1_PARAM_LIMIT = 100;

/** Tamaño seguro por lote para `inArray` con una sola columna (deja margen a otras condiciones). */
export const IN_ARRAY_CHUNK = 50;

export function chunk<T>(items: readonly T[], size = IN_ARRAY_CHUNK): T[][] {
  if (size <= 0) throw new Error("chunk: size must be positive");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Ejecuta `fn` por cada trozo y concatena los arrays resultado. Pensado para
 * `db.select(...).where(inArray(col, trozo))`.
 */
export async function mapInChunks<T, R>(
  items: readonly T[],
  fn: (slice: T[]) => Promise<R[]>,
  size = IN_ARRAY_CHUNK,
): Promise<R[]> {
  const out: R[] = [];
  for (const slice of chunk(items, size)) {
    out.push(...(await fn(slice)));
  }
  return out;
}
