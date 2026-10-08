import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import {
  Calendar,
  Check,
  Download,
  Folder,
  FolderPlus,
  Heart,
  MapPin,
  Play,
  Search,
  Trash2,
  X,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  type GestureResponderEvent,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
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
import { type AlbumFilter, useHybridGallery } from "../../lib/use-hybrid-gallery";
import { EmptyState, SelectAlbumsModal, SyncBadge } from "../../ui";
import { AddToAlbumModal } from "../../ui/AddToAlbumModal";
import { FastScrubber } from "../../ui/FastScrubber";
import { MemoriesBar } from "../../ui/MemoriesBar";
import { SyncStatusAvatar } from "../../ui/SyncStatusAvatar";

const isWeb = Platform.OS === "web";

// Densidades del pinch-to-zoom: detalle (1), normal (3), compacta (5).
const DENSITY_LEVELS = [1, 3, 5];

const FILTER_KEYS = [
  ["all", t.gallery.filterAll],
  ["photos", t.gallery.filterPhotos],
  ["videos", t.gallery.filterVideos],
  ["favorites", t.gallery.filterFavorites],
  ["screenshots", t.gallery.filterScreenshots],
  ["documents", t.gallery.filterDocuments],
] as const;

/** "2026-10" → "octubre de 2026" (dateGroup es UTC; forzamos timeZone). */
const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("es", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

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
        {photo.remote?.isFavorite ? (
          <View className="absolute bottom-1.5 left-1.5 bg-black/50 rounded-full p-1 shadow-sm">
            <Heart size={12} color="#f43f5e" fill="#f43f5e" />
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
    prev.photo.remoteId === next.photo.remoteId &&
    prev.photo.remote?.isFavorite === next.photo.remote?.isFavorite,
);

export default function GalleryScreen() {
  const { width } = useWindowDimensions();
  const columns = useSettings((s) => s.gridColumns);
  const setGridColumns = useSettings((s) => s.setGridColumns);
  const timelineFilter = useSettings((s) => s.timelineFilter);
  const setTimelineFilter = useSettings((s) => s.setTimelineFilter);
  const cell = width / columns;
  const [albumFilter, setAlbumFilter] = useState<AlbumFilter | null>(null);
  const [albumModalOpen, setAlbumModalOpen] = useState(false);
  // La cola (initializeQueue en web) y el runner viven en (tabs)/_layout.tsx
  // via useQueueSession + useBackupRunner.
  const { photos, rows, query, refreshLocal } = useHybridGallery(timelineFilter, albumFilter);

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
  const [addToAlbumOpen, setAddToAlbumOpen] = useState(false);
  // Salto temporal: mes elegido en el modal; el efecto de abajo va trayendo
  // páginas del timeline hasta localizar la primera foto de ese mes.
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpYm, setJumpYm] = useState<string | null>(null);
  const months = useQuery({
    queryKey: ["timeline-months"],
    queryFn: api.timelineMonths,
    enabled: jumpOpen,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!jumpYm) return;
    let idx = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.type === "photo" && new Date(r.photo.takenAt).toISOString().slice(0, 7) === jumpYm) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      let target = idx;
      for (let i = idx; i >= 0; i--) {
        if (rows[i].type === "header") {
          target = i;
          break;
        }
      }
      listRef.current?.scrollToIndex({ index: target, animated: true });
      setJumpYm(null);
    } else if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    } else if (!query.hasNextPage) {
      setJumpYm(null);
    }
  }, [jumpYm, rows, query.hasNextPage, query.isFetchingNextPage]);

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
      } else {
        router.push({
          pathname: "/media/[id]",
          params: {
            id: photo.remoteId ?? photo.key,
            localUri: photo.localUri ?? "",
            mediaType: photo.mediaType,
            syncStatus: photo.syncStatus,
            takenAt: String(photo.takenAt),
            width: String(photo.width),
            height: String(photo.height),
            durationMs: photo.durationMs != null ? String(photo.durationMs) : "",
            thumbhash: photo.thumbhash ?? "",
          },
        });
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
            onPress={() => setAddToAlbumOpen(true)}
            accessibilityLabel={t.albums.addToAlbum}
            hitSlop={8}
            disabled={!remoteSel.length || busyAction}
          >
            <FolderPlus size={20} color={remoteSel.length ? "#4f46e5" : "#d4d4d4"} />
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
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => router.push("/map")}
              accessibilityLabel={t.map.title}
              hitSlop={8}
              className="p-1 rounded-full active:bg-neutral-200 dark:active:bg-neutral-800"
            >
              <MapPin size={21} color="#737373" />
            </Pressable>
            <Pressable
              onPress={() => router.push("/search")}
              accessibilityLabel={t.search.title}
              hitSlop={8}
              className="p-1 rounded-full active:bg-neutral-200 dark:active:bg-neutral-800"
            >
              <Search size={21} color="#737373" />
            </Pressable>
            <SyncStatusAvatar />
          </View>
        </View>
      )}
      {selected ? null : (
        <View className="flex-row items-center px-4 pb-3">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-1"
            contentContainerStyle={{ gap: 8, paddingRight: 8 }}
          >
            {FILTER_KEYS.map(([f, label]) => (
              <Pressable
                key={f}
                onPress={() => setTimelineFilter(f)}
                accessibilityLabel={label}
                accessibilityRole="button"
                className={`px-3 py-1.5 rounded-full border ${
                  timelineFilter === f
                    ? "bg-accent border-accent"
                    : "border-neutral-300 dark:border-neutral-700"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    timelineFilter === f ? "text-white" : "text-neutral-600 dark:text-neutral-300"
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            onPress={() => setAlbumModalOpen(true)}
            accessibilityLabel={t.albums.filterByAlbum}
            hitSlop={8}
            className="pl-2"
          >
            <Folder size={20} color={albumFilter ? "#4f46e5" : "#737373"} />
          </Pressable>
          <Pressable
            onPress={() => setJumpOpen(true)}
            accessibilityLabel={t.gallery.jumpToMonth}
            hitSlop={8}
            className="pl-2"
          >
            <Calendar size={20} color="#737373" />
          </Pressable>
        </View>
      )}
      {albumFilter ? (
        <View className="flex-row items-center justify-between mx-4 mb-2 px-3 py-1.5 rounded-xl bg-accent/10 border border-accent/20">
          <View className="flex-row items-center gap-2 flex-1 mr-2">
            <Folder size={15} color="#4f46e5" />
            <Text className="text-xs font-semibold text-accent" numberOfLines={1}>
              Álbum: {albumFilter.title}
            </Text>
          </View>
          <Pressable
            onPress={() => setAlbumFilter(null)}
            hitSlop={8}
            accessibilityLabel="Quitar filtro de álbum"
          >
            <X size={15} color="#4f46e5" />
          </Pressable>
        </View>
      ) : null}
      {selected || timelineFilter !== "all" || albumFilter ? null : <MemoriesBar />}
      {isEmpty ? (
        <EmptyState
          title={albumFilter ? "Álbum sin fotos" : t.gallery.emptyTitle}
          body={
            albumFilter ? "Este álbum no tiene fotos o videos disponibles." : t.gallery.emptyBody
          }
          actionLabel={albumFilter ? "Ver todas las fotos" : t.gallery.emptyAction}
          action={albumFilter ? () => setAlbumFilter(null) : () => router.push("/(tabs)/backup")}
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
              drawDistance={Math.round(width * 2)}
              removeClippedSubviews={Platform.OS !== "web"}
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
      <Modal
        visible={jumpOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setJumpOpen(false)}
      >
        <Pressable className="flex-1 bg-black/40" onPress={() => setJumpOpen(false)} />
        <View className="bg-white dark:bg-neutral-900 rounded-t-3xl px-6 pt-4 pb-8 max-h-[60%]">
          <View className="w-10 h-1.5 rounded-full bg-neutral-300 self-center mb-4" />
          <Text className="text-xl font-bold text-neutral-900 dark:text-white mb-2">
            {t.gallery.jumpToMonth}
          </Text>
          <FlatList
            data={months.data?.months ?? []}
            keyExtractor={(m) => m.month}
            ListEmptyComponent={
              <Text className="text-sm text-neutral-500 py-6 text-center">
                {months.isPending ? "…" : t.gallery.jumpEmpty}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                className="flex-row justify-between items-center py-3 border-b border-neutral-100 dark:border-neutral-800"
                onPress={() => {
                  setJumpOpen(false);
                  setJumpYm(item.month);
                }}
              >
                <Text className="text-base text-neutral-900 dark:text-white capitalize">
                  {monthLabel(item.month)}
                </Text>
                <Text className="text-sm text-neutral-500">{item.count}</Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>

      <AddToAlbumModal
        visible={addToAlbumOpen}
        mediaIds={remoteSel.map((p) => p.remoteId as string)}
        onClose={() => setAddToAlbumOpen(false)}
        onSuccess={() => setSelected(null)}
      />

      <SelectAlbumsModal
        visible={albumModalOpen}
        activeFilter={albumFilter}
        onSelect={setAlbumFilter}
        onClose={() => setAlbumModalOpen(false)}
      />
    </SafeAreaView>
  );
}
