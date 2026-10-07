import { STORAGE_QUOTA_BYTES } from "@photos/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronRight, HardDrive, Trash2 } from "lucide-react-native";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../../api/client";
import { useSession } from "../../auth/client";
import { t } from "../../i18n/es";
import { useQueueEvents } from "../../lib/events";
import { formatBytes, formatRelative } from "../../lib/format";
import { freeSyncedSpace, getSyncedLocal } from "../../lib/free-space";
import { performLogout } from "../../queue/logout";
import { Button, Card } from "../../ui";

const isWeb = Platform.OS === "web";

export default function SettingsScreen() {
  const { data: session } = useSession();
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  useQueueEvents((s) => s.tick); // re-render al liberar/cambiar la cola

  // En web no hay copia local que liberar (el blob se borra al terminar).
  const syncedLocal = isWeb ? { assetIds: [], totalBytes: 0 } : getSyncedLocal();

  const freeSpace = () => {
    const { assetIds, totalBytes } = getSyncedLocal();
    if (!assetIds.length) return;
    const size = formatBytes(totalBytes);
    Alert.alert(t.backup.freeSpace, t.backup.freeSpaceConfirm(assetIds.length, size), [
      { text: "Cancelar", style: "cancel" },
      {
        text: t.backup.freeSpace,
        style: "destructive",
        onPress: () => {
          void freeSyncedSpace().then((n) => {
            if (n > 0) toast.success(t.backup.freed(n, size));
          });
        },
      },
    ]);
  };

  const doLogout = async () => {
    // Capturar antes de que la sesión desaparezca: performLogout lo usa para
    // borrar los pendientes locales del usuario en web (wipeUserQueue).
    const userId = session?.user?.id ?? "";
    await performLogout(userId);
    router.replace("/welcome");
  };

  const logout = () => {
    // Alert.alert no existe en react-native-web
    if (Platform.OS === "web") {
      if (window.confirm(t.auth.logoutConfirmWeb)) void doLogout();
      return;
    }
    Alert.alert(t.auth.logout, t.auth.logoutConfirm, [
      { text: "Cancelar", style: "cancel" },
      { text: t.auth.logout, style: "destructive", onPress: () => void doLogout() },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top"]}>
      <ScrollView contentContainerClassName="px-5 py-6 gap-5">
        <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
          {t.settings.title}
        </Text>

        <Card className="gap-1">
          <Text className="text-xs font-semibold text-neutral-400 uppercase">
            {t.settings.account}
          </Text>
          <Text className="text-lg font-semibold text-neutral-900 dark:text-white mt-1">
            {session?.user.name}
          </Text>
          <Text className="text-sm text-neutral-500">{session?.user.email}</Text>
        </Card>

        <Card className="gap-3">
          <Text className="text-xs font-semibold text-neutral-400 uppercase">
            {t.settings.storage}
          </Text>
          <View className="h-2.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
            <View
              className="h-full bg-accent rounded-full"
              style={{
                width: `${Math.min(100, ((stats.data?.totalBytes ?? 0) / (stats.data?.quotaBytes ?? STORAGE_QUOTA_BYTES)) * 100)}%`,
              }}
            />
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-neutral-600 dark:text-neutral-300">
              {t.settings.storageUsed(formatBytes(stats.data?.totalBytes ?? 0))}
            </Text>
            <Text className="text-sm text-neutral-500">
              {t.settings.photosBackedUp(stats.data?.count ?? 0)}
            </Text>
          </View>
          {stats.data?.lastUploadAt ? (
            <Text className="text-xs text-neutral-400">
              {t.backup.lastBackup(formatRelative(stats.data.lastUploadAt))}
            </Text>
          ) : null}
        </Card>

        {syncedLocal.assetIds.length > 0 ? (
          <Card className="gap-3">
            <View className="flex-row items-center gap-2">
              <HardDrive size={16} color="#4f46e5" />
              <Text className="text-base font-semibold text-neutral-900 dark:text-white">
                {t.settings.freeSpace}
              </Text>
            </View>
            <Text className="text-sm text-neutral-500">
              {t.settings.freeSpaceHint(formatBytes(syncedLocal.totalBytes))}
            </Text>
            <Button label={t.settings.freeSpaceAction} variant="ghost" onPress={freeSpace} />
          </Card>
        ) : null}

        <Pressable onPress={() => router.push("/trash")} accessibilityRole="button">
          <Card className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <Trash2 size={18} color="#a3a3a3" />
              <View>
                <Text className="text-base font-semibold text-neutral-900 dark:text-white">
                  {t.settings.trash}
                </Text>
                <Text className="text-xs text-neutral-500">{t.trash.body}</Text>
              </View>
            </View>
            <ChevronRight size={18} color="#a3a3a3" />
          </Card>
        </Pressable>

        <Button label={t.auth.logout} variant="ghost" onPress={logout} />

        <Text className="text-xs text-neutral-400 text-center">
          {t.settings.version} 1.0.0 · Photos
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
