import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2 },
  },
});

export const MEDIA_LIFECYCLE_QUERY_KEYS = [
  ["storage"],
  ["user-storage"],
  ["timeline"],
  ["timeline-months"],
  ["trash"],
  ["albums"],
  ["search"],
  ["locations"],
  ["memories"],
] as const;

/**
 * Invalida simultáneamente las queries afectadas por mutaciones en el ciclo de vida
 * de un medio (borrado, restauración, vaciado de papelera o limpieza).
 */
export async function invalidateMediaLifecycleQueries(
  qc: QueryClient = queryClient,
): Promise<void> {
  await Promise.all(
    MEDIA_LIFECYCLE_QUERY_KEYS.map((queryKey) =>
      qc.invalidateQueries({ queryKey }).catch(() => {}),
    ),
  );
}
