import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../api/client";

/**
 * Timeline remoto paginado, compartido entre la galería híbrida y el visor
 * (carrusel): misma queryKey → la página del visor se monta sobre la caché
 * ya cargada por la cuadrícula.
 */
export function useTimeline() {
  return useInfiniteQuery({
    queryKey: ["timeline"],
    queryFn: ({ pageParam }) => api.timeline(pageParam, 60),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
