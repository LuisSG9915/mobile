import type { TimelineItem } from "@photos/shared";
import { FlashList } from "@shopify/flash-list";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { CloudOff, Play } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../api/client";
import { t } from "../../i18n/es";
import { useQueueEvents } from "../../lib/events";
import { formatDuration, monthLabel } from "../../lib/format";
import { useSettings } from "../../lib/store";
import { getPendingItems, type QueueItem } from "../../queue/db";
import { EmptyState } from "../../ui";

type FeedRow =
  | { type: "header"; key: string; label: string }
  | { type: "remote"; key: string; item: TimelineItem }
  | { type: "pending"; key: string; item: QueueItem };

export default function GalleryScreen() {
  const { width } = useWindowDimensions();
  const columns = useSettings((s) => s.gridColumns);
  const cell = width / columns;
  const tick = useQueueEvents((s) => s.tick);
  // La cola (initializeQueue en web) y el runner viven en (tabs)/_layout.tsx
  // via useQueueSession + useBackupRunner.

  const query = useInfiniteQuery({
    queryKey: ["timeline"],
    queryFn: ({ pageParam }) => api.timeline(pageParam, 60),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const feed = useMemo<FeedRow[]>(() => {
    void tick; // re-ejecuta el memo cuando la cola local cambia
    const rows: FeedRow[] = [];
    const pending = getPendingItems(200);
    if (pending.length) {
      rows.push({ type: "header", key: "h-pending", label: t.backup.pendingHere });
      for (const p of pending) rows.push({ type: "pending", key: `p-${p.asset_id}`, item: p });
    }
    let lastMonth = "";
    for (const page of query.data?.pages ?? []) {
      for (const item of page.items) {
        const m = monthLabel(item.takenAt);
        if (m !== lastMonth) {
          lastMonth = m;
          rows.push({ type: "header", key: `h-${m}`, label: m });
        }
        rows.push({ type: "remote", key: item.id, item });
      }
    }
    return rows;
  }, [query.data, tick]);

  const sticky = useMemo(
    () => feed.map((r, i) => (r.type === "header" ? i : -1)).filter((i) => i >= 0),
    [feed],
  );

  const isEmpty =
    !query.isPending && (query.data?.pages[0]?.items.length ?? 0) === 0 && feed.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top"]}>
      {isEmpty ? (
        <EmptyState
          title={t.gallery.emptyTitle}
          body={t.gallery.emptyBody}
          actionLabel={t.gallery.emptyAction}
          action={() => router.push("/(tabs)/backup")}
        />
      ) : (
        <FlashList
          data={feed}
          keyExtractor={(r) => r.key}
          numColumns={columns}
          stickyHeaderIndices={sticky}
          getItemType={(r) => r.type}
          overrideItemLayout={(layout, item) => {
            if (item.type === "header") layout.span = columns;
          }}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          onEndReachedThreshold={0.8}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
            />
          }
          renderItem={({ item }) => {
            if (item.type === "header") {
              return (
                <View className="px-3 pt-4 pb-2 bg-neutral-50 dark:bg-black">
                  <Text className="text-lg font-bold text-neutral-900 dark:text-white">
                    {item.label}
                  </Text>
                </View>
              );
            }
            if (item.type === "pending") {
              return (
                <View
                  style={{ width: cell, height: cell }}
                  className="bg-neutral-200 dark:bg-neutral-800 items-center justify-center"
                >
                  <CloudOff size={22} color="#a3a3a3" />
                  <Text className="text-[10px] text-neutral-500 mt-1">
                    {t.gallery.pendingBadge}
                  </Text>
                </View>
              );
            }
            const m = item.item;
            return (
              <Pressable
                accessibilityLabel={m.mediaType === "video" ? "video" : "foto"}
                onPress={() => router.push(`/media/${m.id}`)}
                style={{ width: cell, height: cell }}
              >
                <Image
                  source={{ uri: m.thumbUrl }}
                  placeholder={{ thumbhash: m.thumbhash }}
                  contentFit="cover"
                  transition={200}
                  recyclingKey={m.id}
                  style={{ width: "100%", height: "100%" }}
                />
                {m.mediaType === "video" ? (
                  <View className="absolute bottom-1 right-1 flex-row items-center bg-black/60 rounded-md px-1.5 py-0.5 gap-1">
                    <Play size={10} color="#fff" />
                    <Text className="text-white text-[10px] font-medium">
                      {formatDuration(m.durationMs) ?? ""}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
