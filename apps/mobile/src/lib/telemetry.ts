import * as Sentry from "@sentry/react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Telemetría de errores. Sin EXPO_PUBLIC_SENTRY_DSN el SDK no se inicializa:
 * la app funciona igual y no se envía nada. El DSN se inyecta en build
 * (EAS env o .env local); nunca se hardcodea.
 */
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** Versión real del binario (la gestiona EAS), no la de app.json. */
export function appVersion(): string {
  if (Platform.OS === "web") return Constants.expoConfig?.version ?? "0.0.0";
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "0.0.0";
}

/** versionCode/buildNumber del binario; null en web. */
export function appBuild(): string | null {
  if (Platform.OS === "web") return null;
  return Application.nativeBuildVersion ?? null;
}

export function initTelemetry(): void {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    environment:
      process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? (__DEV__ ? "development" : "production"),
    release: `com.photosR2.app@${appVersion()}+${appBuild() ?? "0"}`,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}

export function captureException(error: unknown): void {
  if (!DSN) return;
  Sentry.captureException(error);
}

/** Solo el id: nunca email ni rutas de fotos. */
export function setTelemetryUser(userId: string | null): void {
  if (!DSN) return;
  Sentry.setUser(userId ? { id: userId } : null);
}
