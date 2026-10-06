import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { router } from "expo-router";
import { AlertCircle, Cloud, CloudCheck, CloudOff, CloudUpload, Play } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../../i18n/es";
import { formatDuration } from "../../lib/format";
import type { GalleryRow, HybridPhoto } from "../../lib/gallery";
import { useSettings } from "../../lib/store";
import { useHybridGallery } from "../../lib/use-hybrid-gallery";
import { EmptyState } from "../../ui";

/** Indicador mínimo de estado (el SyncBadge completo es Fase 2). */
function StatusGlyph({ photo }: { photo: HybridPhoto }) {
  const icon = { size: 14, color: "#fff" } as const;
  let glyph: React.ReactNode;
  let label: string | null = null;
  switch (photo.syncStatus) {
    case "SYNCED":
      glyph = <CloudCheck {...icon} />;
      break;
    case "REMOTE_ONLY":
      glyph = <Cloud {...icon} />;
      break;
    case "SYNCING":
      glyph = <CloudUpload {...icon} />;
      label = photo.progress != null ? `${Math.round(photo.progress * 100)}%` : null;
      break;
    case "PENDING":
      glyph = <CloudUpload {...icon} />;
      break;
    case "FAILED":
      glyph = <AlertCircle {...icon} />;
      break;
    case "LOCAL_ONLY":
      glyph = <CloudOff {...icon} />;
      break;
  }
  return (
    <View className="absolute bottom-1 left-1 flex-row items-center bg-black/60 rounded-md px-1.5 py-0.5 gap-1">
      {glyph}
      {label ? <Text className="text-white text-[10px] font-medium">{label}</Text> : null}
    </View>
  );
}

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
      <StatusGlyph photo={photo} />
    </Pressable>
  );
}

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
