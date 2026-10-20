import "../../global.css";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ErrorBoundaryProps, Stack } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, Share, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Toaster } from "sonner-native";
import { useSession } from "../auth/client";
import { queryClient } from "../lib/query-client";
import {
  appBuild,
  appVersion,
  captureException,
  initTelemetry,
  setTelemetryUser,
} from "../lib/telemetry";
import { registerBackupTask } from "../queue/background";

initTelemetry();

function RootNavigator() {
  const { data: session, isPending } = useSession();
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    setTelemetryUser(userId);
  }, [userId]);

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator color="#4f46e5" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="media/[id]"
          options={{
            presentation: "transparentModal",
            animation: "fade",
            contentStyle: { backgroundColor: "transparent" },
          }}
        />
        <Stack.Screen name="trash" options={{ presentation: "modal" }} />
        <Stack.Screen name="cleaner" />
        <Stack.Screen name="map" />
        <Stack.Screen name="search" />
        <Stack.Screen name="admin" />
        <Stack.Screen name="albums/[id]" />
      </Stack.Protected>
      <Stack.Screen name="shared/album/[token]" />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void registerBackupTask();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <BottomSheetModalProvider>
            <RootNavigator />
            <Toaster />
          </BottomSheetModalProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Error boundary global de Expo Router: un throw de render deja de ser una
 * pantalla en blanco. No toca la cola ni los archivos locales.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  const shareDiagnostics = () => {
    const build = appBuild();
    void Share.share({
      message: [
        `Photos ${appVersion()}${build ? ` (${build})` : ""}`,
        `${error.name}: ${error.message}`,
        error.stack ?? "",
      ].join("\n"),
    }).catch(() => {});
  };

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-black px-8">
      <Text className="text-2xl font-bold text-neutral-900 dark:text-white text-center">
        Algo salió mal
      </Text>
      <Text className="text-sm text-neutral-500 text-center mt-3">
        La app encontró un error inesperado. Tus fotos y respaldos no se modificaron.
      </Text>
      <Text className="text-xs text-neutral-400 text-center mt-2" numberOfLines={4}>
        {error.message}
      </Text>
      <Pressable
        onPress={retry}
        accessibilityRole="button"
        className="mt-6 px-6 py-3 rounded-full bg-accent active:opacity-80"
      >
        <Text className="text-white font-semibold">Reintentar</Text>
      </Pressable>
      <Pressable
        onPress={shareDiagnostics}
        accessibilityRole="button"
        className="mt-3 px-6 py-3 rounded-full border border-neutral-300 dark:border-neutral-700 active:opacity-80"
      >
        <Text className="text-neutral-700 dark:text-neutral-300 font-semibold">
          Compartir diagnóstico
        </Text>
      </Pressable>
    </View>
  );
}
