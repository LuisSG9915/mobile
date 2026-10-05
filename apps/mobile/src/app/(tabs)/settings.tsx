import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronRight, Trash2 } from "lucide-react-native";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../api/client";
import { signOut, useSession } from "../../auth/client";
import { t } from "../../i18n/es";
import { formatBytes, formatRelative } from "../../lib/format";
import { Button, Card } from "../../ui";

export default function SettingsScreen() {
  const { data: session } = useSession();
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats });

  const logout = () => {
    Alert.alert(t.auth.logout, t.auth.logoutConfirm, [
      { text: "Cancelar", style: "cancel" },
      {
        text: t.auth.logout,
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/welcome");
        },
      },
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
                width: `${Math.min(100, ((stats.data?.totalBytes ?? 0) / (10 * 1024 * 1024 * 1024)) * 100)}%`,
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
