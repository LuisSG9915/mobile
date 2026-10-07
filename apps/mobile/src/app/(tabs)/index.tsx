import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Check, Download, Play, Trash2, X } from "lucide-react-native";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  type GestureResponderEvent,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../../api/client";
import { t } from "../../i18n/es";
import { downloadMany } from "../../lib/download-many";
import { formatDuration } from "../../lib/format";
import type { GalleryRow, HybridPhoto } from "../../lib/gallery";
import { buildGridGeometry, HEADER_HEIGHT, hitTestPhoto } from "../../lib/grid-geometry";
import { useSettings } from "../../lib/store";
import { useHybridGallery } from "../../lib/use-hybrid-gallery";
import { EmptyState, SyncBadge } from "../../ui";
import { FastScrubber } from "../../ui/FastScrubber";
import { SyncStatusAvatar } from "../../ui/SyncStatusAvatar";

const isWeb = Platform.OS === "web";

// Densidades del pinch-to-zoom: detalle (1), normal (3), compacta (5).
const DENSITY_LEVELS = [1, 3, 5];

function pinchLevel(columns: number, dir: -1 | 1): number {
  let i = 0;
  for (let j = 1; j < DENSITY_LEVELS.length; j++) {
    if (Math.abs(DENSITY_LEVELS[j] - columns) < Math.abs(DENSITY_LEVELS[i] - columns)) i = j;
  }
  return DENSITY_LEVELS[Math.min(DENSITY_LEVELS.length - 1, Math.max(0, i + dir))];
}

type CellProps = {
  photo: HybridPhoto;
  size: number;
  selecting: boolean;
  selected: boolean;
  onPress: (photo: HybridPhoto) => void;
  onLongPress: (photo: HybridPhoto) => void;
};

/**
 * Celda memoizada: los ticks de la cola regeneran los HybridPhoto, así que se
 * comparan solo los campos visibles — un badge que cambia re-renderiza su
 * celda sin tocar el resto de la cuadrícula.
 */
const PhotoCell = memo(
  function PhotoCell({ photo, size, selecting, selected, onPress, onLongPress }: CellProps) {
    const uri = photo.localUri ?? photo.thumbUrl;
    return (
      <Pressable
        accessibilityLabel={photo.mediaType === "video" ? "video" : "foto"}
        onPress={() => onPress(photo)}
        onLongPress={() => onLongPress(photo)}
        delayLongPress={350}
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
        {selected ? <View className="absolute inset-0 bg-accent/40" /> : null}
        {photo.mediaType === "video" ? (
          <View className="absolute bottom-1 right-1 flex-row items-center bg-black/60 rounded-md px-1.5 py-0.5 gap-1">
            <Play size={10} color="#fff" />
            <Text className="text-white text-[10px] font-medium">
              {formatDuration(photo.durationMs) ?? ""}
            </Text>
          </View>
        ) : null}
        {selecting ? (
          <View
            className={`absolute top-1 right-1 w-5 h-5 rounded-full border-2 items-center justify-center ${
              selected ? "bg-accent border-accent" : "border-white/80 bg-black/20"
            }`}
          >
            {selected ? <Check size={12} color="#fff" /> : null}
          </View>
        ) : null}
        <SyncBadge status={photo.syncStatus} progress={photo.progress} />
      </Pressable>
    );
  },
  (prev, next) =>
    prev.size === next.size &&
    prev.selecting === next.selecting &&
    prev.selected === next.selected &&
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
  const setGridColumns = useSettings((s) => s.setGridColumns);
  const cell = width / columns;
  // La cola (initializeQueue en web) y el runner viven en (tabs)/_layout.tsx
  // via useQueueSession + useBackupRunner.
  const { photos, rows, query, refreshLocal } = useHybridGallery();

  const listRef = useRef<FlashListRef<GalleryRow>>(null);
  const gridRef = useRef<View>(null);
  const gridPage = useRef({ x: 0, y: 0 });
  const scrollY = useRef(0);
  const lastHitRow = useRef(-1);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  // Ref espejo para que las celdas memoizadas lean el modo actual sin stale
  // closures (los callbacks estables no pueden capturar `selected` directo).
  const selectedRef = useRef<Set<string> | null>(null);
  selectedRef.current = selected;
  const [dragSelecting, setDragSelecting] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  const sticky = useMemo(
    () => rows.map((r, i) => (r.type === "header" ? i : -1)).filter((i) => i >= 0),
    [rows],
  );
  const geometry = useMemo(() => buildGridGeometry(rows, columns, cell), [rows, columns, cell]);
  const remoteSel = useMemo(
    () => photos.filter((p) => selected?.has(p.key) && p.remoteId),
    [photos, selected],
  );

  // ---- gestos ----

  const applyPinch = useCallback(
    (dir: -1 | 1) => setGridColumns(pinchLevel(columns, dir)),
    [columns, setGridColumns],
  );
  const pinch = useMemo(
    () =>
      Gesture.Pinch().onEnd((e) => {
        if (e.scale > 1.2) runOnJS(applyPinch)(-1);
        else if (e.scale < 0.8) runOnJS(applyPinch)(1);
      }),
    [applyPinch],
  );

  const hitFromTouch = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.pageX - gridPage.current.x;
    const y = e.nativeEvent.pageY - gridPage.current.y + scrollY.current;
    const idx = hitTestPhoto(geometry, rows, x, y, columns, cell);
    if (idx == null || idx === lastHitRow.current) return;
    lastHitRow.current = idx;
    const row = rows[idx];
    if (row?.type !== "photo") return;
    setSelected((prev) => new Set(prev ?? []).add(row.key));
  };

  const beginSelect = useCallback((photo: HybridPhoto) => {
    lastHitRow.current = -1;
    setSelected((prev) => new Set(prev ?? []).add(photo.key));
    setDragSelecting(true);
  }, []);

  const togglePhoto = useCallback((key: string) => {
    setSelected((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next.size ? next : null;
    });
  }, []);

  const toggleDay = (headerRowIndex: number) => {
    setSelected((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      const keys: string[] = [];
      for (let i = headerRowIndex + 1; i < rows.length && rows[i].type === "photo"; i++) {
        keys.push(rows[i].key);
      }
      const allIn = keys.length > 0 && keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allIn) next.delete(k);
        else next.add(k);
      }
      return next.size ? next : null;
    });
  };

  const onCellPress = useCallback(
    (photo: HybridPhoto) => {
      if (selectedRef.current) {
        togglePhoto(photo.key);
      } else if (photo.remoteId) {
        router.push(`/media/${photo.remoteId}`);
      }
    },
    [togglePhoto],
  );

  // ---- acciones de la barra contextual ----

  const downloadSelected = async () => {
    if (busyAction || !remoteSel.length) return;
    setBusyAction(true);
    try {
      await downloadMany(remoteSel.map((p) => p.remoteId as string));
      toast.success(t.gallery.downloadedN(remoteSel.length));
      setSelected(null);
    } catch {
      toast.error(t.viewer.downloadFailed);
    } finally {
      setBusyAction(false);
    }
  };

  const deleteSelected = () => {
    if (busyAction || !remoteSel.length) return;
    const n = remoteSel.length;
    const ids = remoteSel.map((p) => p.remoteId as string);
    const run = async () => {
      setBusyAction(true);
      try {
        await Promise.all(ids.map((id) => api.deleteMedia(id)));
        toast.success(t.gallery.deletedN(n));
        setSelected(null);
        void query.refetch();
      } catch {
        toast.error(t.auth.genericError);
      } finally {
        setBusyAction(false);
      }
    };
    if (isWeb) {
      if (window.confirm(t.gallery.deleteConfirm(n))) void run();
      return;
    }
    Alert.alert(t.gallery.deleteAction, t.gallery.deleteConfirm(n), [
      { text: "Cancelar", style: "cancel" },
      { text: t.gallery.deleteAction, style: "destructive", onPress: () => void run() },
    ]);
  };

  const isEmpty = !query.isPending && rows.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top"]}>
      {selected ? (
        <View className="flex-row items-center gap-3 px-4 pt-2 pb-3">
          <Pressable
            onPress={() => setSelected(null)}
            accessibilityLabel={t.gallery.cancelSelection}
            hitSlop={8}
          >
            <X size={22} color="#525252" />
          </Pressable>
          <Text className="text-lg font-semibold text-neutral-900 dark:text-white flex-1">
            {t.gallery.selectedN(selected.size)}
          </Text>
          <Pressable
            onPress={() => void downloadSelected()}
            accessibilityLabel={t.gallery.downloadAction}
            hitSlop={8}
            disabled={!remoteSel.length || busyAction}
          >
            <Download size={20} color={remoteSel.length ? "#4f46e5" : "#d4d4d4"} />
          </Pressable>
          <Pressable
            onPress={deleteSelected}
            accessibilityLabel={t.gallery.deleteAction}
            hitSlop={8}
            disabled={!remoteSel.length || busyAction}
          >
            <Trash2 size={20} color={remoteSel.length ? "#dc2626" : "#d4d4d4"} />
          </Pressable>
        </View>
      ) : (
        <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
          <Text className="text-2xl font-bold text-neutral-900 dark:text-white">
            {t.tabs.photos}
          </Text>
          <SyncStatusAvatar />
        </View>
      )}
      {isEmpty ? (
        <EmptyState
          title={t.gallery.emptyTitle}
          body={t.gallery.emptyBody}
          actionLabel={t.gallery.emptyAction}
          action={() => router.push("/(tabs)/backup")}
        />
      ) : (
        <GestureDetector gesture={pinch}>
          <View
            ref={gridRef}
            className="flex-1"
            onLayout={() => {
              gridRef.current?.measureInWindow((x, y) => {
                gridPage.current = { x, y };
              });
            }}
            onTouchMove={dragSelecting ? hitFromTouch : undefined}
            onTouchEnd={() => setDragSelecting(false)}
            onTouchCancel={() => setDragSelecting(false)}
          >
            <FlashList<GalleryRow>
              ref={listRef}
              data={rows}
              keyExtractor={(r) => r.key}
              numColumns={columns}
              stickyHeaderIndices={sticky}
              scrollEnabled={!dragSelecting}
              getItemType={(r) => r.type}
              overrideItemLayout={(layout, item) => {
                if (item.type === "header") layout.span = columns;
              }}
              onScroll={(e) => {
                scrollY.current = e.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={16}
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
              renderItem={({ item, index }) => {
                if (item.type === "header") {
                  return (
                    <Pressable
                      onPress={selected ? () => toggleDay(index) : undefined}
                      disabled={!selected}
                      className="px-3 bg-neutral-50 dark:bg-black justify-center"
                      style={{ height: HEADER_HEIGHT }}
                    >
                      <Text className="text-base font-bold text-neutral-900 dark:text-white">
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                }
                return (
                  <PhotoCell
                    photo={item.photo}
                    size={cell}
                    selecting={!!selected}
                    selected={!!selected?.has(item.photo.key)}
                    onPress={onCellPress}
                    onLongPress={beginSelect}
                  />
                );
              }}
            />
            {rows.length > 20 ? (
              <FastScrubber
                geometry={geometry}
                rows={rows}
                onScrub={(i) => listRef.current?.scrollToIndex({ index: i, animated: false })}
              />
            ) : null}
          </View>
        </GestureDetector>
      )}
    </SafeAreaView>
  );
}
