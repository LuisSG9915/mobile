import type { Bindings } from "../env";

export type ApiMetricData = {
  userId?: string;
  durationMs?: number;
  bytes?: number;
  status?: string;
  type?: "single" | "multipart" | string;
  [key: string]: unknown;
};

/**
 * Registra métricas operativas de subidas y rendimiento.
 * Emite a Cloudflare Analytics Engine si el binding está presente, o log estructurado
 * en consola salvo en entorno de pruebas ("test").
 */
export function recordApiMetric(env: Bindings, name: string, data: ApiMetricData): void {
  try {
    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        blobs: [
          name,
          data.userId ?? null,
          data.status ?? null,
          typeof data.type === "string" ? data.type : null,
        ],
        doubles: [data.durationMs ?? 0, data.bytes ?? 0],
        indexes: [name],
      });
    } else if (env.ENVIRONMENT !== "test") {
      console.log(
        JSON.stringify({
          metric: name,
          ...data,
          timestamp: Date.now(),
        }),
      );
    }
  } catch {
    // La telemetría nunca debe interrumpir el flujo crítico de la petición
  }
}
