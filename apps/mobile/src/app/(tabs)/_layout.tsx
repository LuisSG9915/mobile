import { Image } from "expo-image";
import { Tabs } from "expo-router";
import { CloudUpload, Folder, Images, Settings } from "lucide-react-native";
import { useEffect } from "react";
import { ActivityIndicator, AppState, Platform, Text, useColorScheme, View } from "react-native";
import { useSession } from "../../auth/client";
import { t } from "../../i18n/es";
import { useQueueEvents } from "../../lib/events";
import { kvGet, kvSet, setLastScanTs } from "../../queue/db";
import { useSyncProgressAuto } from "../../queue/progress";
import { useBackupRunner } from "../../queue/runner";
import { useQueueSession } from "../../queue/session";
import { repairRestoredLinks } from "../../restore/link";

export default function TabsLayout() {
  const scheme = useColorScheme();
  // En web abre IndexedDB por usuario y suspende la cola si la sesión cae;
  // en nativo fija el dueño (user_id) de la cola SQLite.
  const { ready, error } = useQueueSession();
  useBackupRunner(ready);
  const { data: session } = useSession();
  const sessionUserId = session?.user?.id;
  // Enlaza con su remoto los archivos restaurados que se encolaron como nuevos (fecha de hoy).
  useEffect(() => {
    if (!ready || !sessionUserId) return;
    if (repairRestoredLinks(sessionUserId) > 0) useQueueEvents.getState().emit();
    // Una sola vez: forzar un escaneo completo para recalcular las fechas de lo ya encolado
    // (reglas de fecha nuevas: hora de pared y fecha del nombre de archivo).
    const flag = `dates_v2:${sessionUserId}`;
    if (kvGet(flag) !== "1") {
      setLastScanTs(0);
      kvSet(flag, "1");
    }
  }, [ready, sessionUserId]);
  // Proyección reactiva de la cola para el anillo del avatar y la barra de Respaldo.
  useSyncProgressAuto();

  // Al minimizar, liberar el caché de bitmaps en memoria: Android recorta el
  // proceso bajo presión (TRIM_MEMORY) y ~200 MB de Glide inflan el PSS.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") void Image.clearMemoryCache().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  if (Platform.OS === "web" && error) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black px-6">
        <Text className="text-base text-neutral-700 dark:text-neutral-300 text-center">
          {error}
        </Text>
      </View>
    );
  }
  if (Platform.OS === "web" && !ready) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black gap-3">
        <ActivityIndicator color="#4f46e5" />
        <Text className="text-sm text-neutral-500">{t.queue.preparing}</Text>
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#4f46e5",
        tabBarInactiveTintColor: "#a3a3a3",
        // Sin esto la barra queda blanca sobre el tema oscuro.
        tabBarStyle: {
          backgroundColor: scheme === "dark" ? "#0a0a0a" : "#ffffff",
          borderTopColor: scheme === "dark" ? "#262626" : "#e5e5e5",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.tabs.photos,
          tabBarIcon: ({ color, size }) => <Images color={color} size={size} />,
          tabBarAccessibilityLabel: t.tabs.photos,
        }}
      />
      <Tabs.Screen
        name="albums"
        options={{
          title: t.tabs.albums,
          tabBarIcon: ({ color, size }) => <Folder color={color} size={size} />,
          tabBarAccessibilityLabel: t.tabs.albums,
        }}
      />
      <Tabs.Screen
        name="backup"
        options={{
          title: t.tabs.backup,
          tabBarIcon: ({ color, size }) => <CloudUpload color={color} size={size} />,
          tabBarAccessibilityLabel: t.tabs.backup,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t.tabs.settings,
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
          tabBarAccessibilityLabel: t.tabs.settings,
        }}
      />
    </Tabs>
  );
}
