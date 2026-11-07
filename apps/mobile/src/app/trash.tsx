import { TRASH_RETENTION_DAYS, type TrashItem } from "@photos/shared";
import { FlashList } from "@shopify/flash-list";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { ActivityIndicator, Alert, Platform, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../api/client";
import { t } from "../i18n/es";
import { invalidateMediaLifecycleQueries } from "../lib/query-client";
import { Button, EmptyState } from "../ui";

export default function TrashScreen() {
  const qc = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ["trash"],
    queryFn: ({ pageParam }) => api.trash({ cursor: pageParam, limit: 100 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const restore = useMutation({
    mutationFn: api.restoreMedia,
    onSuccess: () => {
      toast.success(t.trash.restored);
      void invalidateMediaLifecycleQueries(qc);
    },
  });

  const emptyTrashMut = useMutation({
    mutationFn: async () => {
      let totalDeleted = 0;
      let hasMore = true;
      while (hasMore) {
        const res = await api.emptyTrash();
        totalDeleted += res.deletedCount;
        hasMore = res.hasMore ?? false;
        if (res.deletedCount === 0) break;
      }
      return { ok: true as const, deletedCount: totalDeleted };
    },
    onSuccess: () => {
      toast.success(t.trash.emptySuccess);
      void invalidateMediaLifecycleQueries(qc);
    },
    onError: (err: Error) => toast.error(err.message || t.auth.genericError),
  });

  const handleEmptyTrash = () => {
    if (Platform.OS === "web") {
      if (window.confirm(t.trash.emptyConfirm)) {
        emptyTrashMut.mutate();
      }
    } else {
      Alert.alert(t.trash.emptyAction, t.trash.emptyConfirm, [
        { text: "Cancelar", style: "cancel" },
        { text: t.trash.emptyAction, style: "destructive", onPress: () => emptyTrashMut.mutate() },
      ]);
    }
  };

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  /** Días que le quedan al elemento antes de la purga definitiva (mín. 1). */
  const daysLeft = (item: TrashItem) =>
    Math.max(
      1,
      Math.ceil((item.deletedAt + TRASH_RETENTION_DAYS * 86_400_000 - Date.now()) / 86_400_000),
    );

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top", "bottom"]}>
      <View className="px-5 py-4 flex-row items-center justify-between">
        <View className="gap-1 flex-1 pr-3">
          <Text className="text-2xl font-bold text-neutral-900 dark:text-white">
            {t.trash.title}
          </Text>
          <Text className="text-sm text-neutral-500">{t.trash.body}</Text>
        </View>
        {items.length > 0 ? (
          <Button
            size="sm"
            variant="danger"
            label={t.trash.emptyAction}
            loading={emptyTrashMut.isPending}
            onPress={handleEmptyTrash}
          />
        ) : null}
      </View>
      {items.length === 0 && !query.isLoading ? (
        <EmptyState title={t.trash.empty} />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(i) => i.id}
          // FlashList 2.0.2 recicla celdas cuando la lista se vacía y se vuelve
          // a llenar (N → 0 → N): el layout anterior queda pegado y pinta en
          // blanco. Remontar en la transición vacío↔no-vacío evita el artefacto
          // sin resetear el scroll en restauraciones individuales.
          key={items.length === 0 ? "empty" : "list"}
          numColumns={1}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) {
              void query.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <View className="py-4 items-center justify-center">
                <ActivityIndicator size="small" />
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching && !query.isFetchingNextPage}
              onRefresh={() => void query.refetch()}
            />
          }
          renderItem={({ item }) => (
            <View className="flex-row items-center px-5 py-2 gap-3">
              <Image
                source={{ uri: item.thumbUrl }}
                placeholder={{ thumbhash: item.thumbhash }}
                style={{ width: 64, height: 64, borderRadius: 12 }}
                contentFit="cover"
              />
              <View className="flex-1">
                <Text className="text-sm font-medium text-neutral-900 dark:text-white">
                  {item.mediaType === "video" ? "Video" : "Foto"}
                </Text>
                <Text className="text-xs text-neutral-500">{t.trash.daysLeft(daysLeft(item))}</Text>
              </View>
              <View className="min-w-[100px]">
                <Button
                  size="sm"
                  label={t.trash.restore}
                  variant="ghost"
                  onPress={() => restore.mutate(item.id)}
                />
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
