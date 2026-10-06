import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Play } from "lucide-react-native";
import { memo, useMemo } from "react";
import { Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../../i18n/es";
import { formatDuration } from "../../lib/format";
import type { GalleryRow, HybridPhoto } from "../../lib/gallery";
import { useSettings } from "../../lib/store";
import { useHybridGallery } from "../../lib/use-hybrid-gallery";
import { EmptyState, SyncBadge } from "../../ui";

/**
 * Celda memoizada: los ticks de la cola regeneran los HybridPhoto, así que se
 * comparan solo los campos visibles — un badge que cambia re-renderiza su
 * celda sin tocar el resto de la cuadrícula.
 */
const PhotoCell = memo(
  function PhotoCell({ photo, size }: { photo: HybridPhoto; size: number }) {
    const uri = photo.localUri ?? photo.thumbUrl;
    return (
      <Pressable
        accessibilityLabel={photo.mediaType === "video" ? "video" : "foto"}
        onPress={() => {
          if (photo.remoteId) router.push(`/media/${photo.remoteId}`);
        }}
        style={{ width: size, height: size }}
        className="bg-neutral-200 dark:bg-neutral-800"
      >
        {uri ? (
          <Image
            source={{ uri }}
            placeholder={photo.thumbhash ? { thumbhash: photo.thumbhash } : undefined}
            contentFit="cover"
            transition={200}
            recyclingKey={photo.key}
            style={{ width: "100%", height: "100%" }}
          />
        ) : null}
        {photo.mediaType === "video" ? (
          <View className="absolute bottom-1 right-1 flex-row items-center bg-black/60 rounded-md px-1.5 py-0.5 gap-1">
            <Play size={10} color="#fff" />
            <Text className="text-white text-[10px] font-medium">
              {formatDuration(photo.durationMs) ?? ""}
            </Text>
          </View>
        ) : null}
        <SyncBadge status={photo.syncStatus} progress={photo.progress} />
      </Pressable>
    );
  },
  (prev, next) =>
    prev.size === next.size &&
    prev.photo.key === next.photo.key &&
    prev.photo.syncStatus === next.photo.syncStatus &&
    prev.photo.progress === next.photo.progress &&
    prev.photo.localUri === next.photo.localUri &&
    prev.photo.thumbUrl === next.photo.thumbUrl &&
    prev.photo.remoteId === next.photo.remoteId,
);

export default function GalleryScreen() {
  const { width } = useWindowDimensions();
  const columns = useSettings((s) => s.gridColumns);
  const cell = width / columns;
  // La cola (initializeQueue en web) y el runner viven en (tabs)/_layout.tsx
  // via useQueueSession + useBackupRunner.
  const { rows, query, refreshLocal } = useHybridGallery();

  const sticky = useMemo(
    () => rows.map((r, i) => (r.type === "header" ? i : -1)).filter((i) => i >= 0),
    [rows],
  );

  const isEmpty = !query.isPending && rows.length === 0;

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
        <FlashList<GalleryRow>
          data={rows}
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
              onRefresh={() => {
                void query.refetch();
                void refreshLocal();
              }}
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
            return <PhotoCell photo={item.photo} size={cell} />;
          }}
        />
      )}
    </SafeAreaView>
  );
}
