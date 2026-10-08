import { ADMIN_EMAIL } from "@photos/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { useSession } from "../auth/client";
import { t } from "../i18n/es";
import { formatBytes } from "../lib/format";

/**
 * Panel de administración de R2 (fase 6). Solo llega quien ya es admin
 * (la entrada en Ajustes está condicionada por email) y el API re-valida
 * contra ADMIN_EMAIL del Worker — esta pantalla es solo la vista.
 */
export default function AdminScreen() {
  const { data: session } = useSession();
  const isAdmin = Boolean(ADMIN_EMAIL && session?.user.email === ADMIN_EMAIL);
  const query = useQuery({
    queryKey: ["admin-storage"],
    queryFn: api.adminStorage,
    enabled: isAdmin,
  });
  const data = query.data;

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top", "bottom"]}>
      <View className="flex-row items-center px-4 py-3 gap-2">
        <Pressable onPress={() => router.back()} accessibilityLabel="volver" hitSlop={12}>
          <ChevronLeft size={26} color="#737373" />
        </Pressable>
        <Text className="text-2xl font-bold text-neutral-900 dark:text-white">{t.admin.title}</Text>
      </View>

      {!isAdmin ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-base text-neutral-500">{t.admin.restricted}</Text>
        </View>
      ) : (
        <FlatList
          data={data?.rows ?? []}
          keyExtractor={(r) => r.email}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
            />
          }
          ListHeaderComponent={
            <View className="flex-row px-5 py-2 border-b border-neutral-200 dark:border-neutral-800">
              <Text className="flex-1 text-xs font-semibold text-neutral-400 uppercase">
                {t.admin.email}
              </Text>
              <Text className="w-20 text-right text-xs font-semibold text-neutral-400 uppercase">
                {t.admin.used}
              </Text>
              <Text className="w-14 text-right text-xs font-semibold text-neutral-400 uppercase">
                {t.admin.count}
              </Text>
              <Text className="w-16 text-right text-xs font-semibold text-neutral-400 uppercase">
                {t.admin.quota}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View className="flex-row items-center px-5 py-3 border-b border-neutral-100 dark:border-neutral-900">
              <Text className="flex-1 text-sm text-neutral-900 dark:text-white" numberOfLines={1}>
                {item.email}
              </Text>
              <Text className="w-20 text-right text-sm text-neutral-600 dark:text-neutral-300">
                {formatBytes(item.usedBytes)}
              </Text>
              <Text className="w-14 text-right text-sm text-neutral-600 dark:text-neutral-300">
                {item.mediaCount}
              </Text>
              <Text className="w-16 text-right text-sm text-neutral-600 dark:text-neutral-300">
                {item.usedPercent}%
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text className="text-sm text-neutral-500 text-center py-8">
              {query.isPending ? "…" : t.admin.empty}
            </Text>
          }
          ListFooterComponent={
            data ? (
              <View className="flex-row px-5 py-3">
                <Text className="flex-1 text-sm font-semibold text-neutral-900 dark:text-white">
                  {t.admin.total(data.userCount)}
                </Text>
                <Text className="text-sm font-semibold text-neutral-900 dark:text-white">
                  {formatBytes(data.totalUsedBytes)}
                </Text>
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}
