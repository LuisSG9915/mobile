import type { TimelineFilter } from "@photos/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Timeline remoto paginado, compartido entre la galería híbrida y el visor
 * (carrusel): misma queryKey → la página del visor se monta sobre la caché
 * ya cargada por la cuadrícula. El filtro forma parte de la queryKey — cada
 * chip de la galería tiene su propia caché paginada.
 */
export function useTimeline(filter: TimelineFilter = "all") {
  return useInfiniteQuery({
    queryKey: ["timeline", filter],
    queryFn: ({ pageParam }) => api.timeline(pageParam, 60, filter),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
