import type { TimelineItem } from "@photos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { Download, Heart, Info, Trash2, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  type AlertButton,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../../api/client";
import { t } from "../../i18n/es";
import { formatBytes, formatDateTime, formatDuration } from "../../lib/format";
import { deleteLocalCopy, hasLocalCopy } from "../../lib/free-space";
import { saveDownload } from "../../lib/save-download";
import { useSettings } from "../../lib/store";
import { useTimeline } from "../../lib/timeline";
import { Button } from "../../ui";

function ZoomableImage({
  uri,
  thumbhash,
  active,
}: {
  uri: string;
  thumbhash: string;
  active: boolean;
}) {
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // Al pasar de página el zoom vuelve a 1: al volver atrás la foto no queda ampliada.
  useEffect(() => {
    if (active) return;
    scale.value = 1;
    saved.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
  }, [active, scale, saved, tx, ty, savedTx, savedTy]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(5, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
      if (scale.value <= 1) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .onUpdate((e) => {
      if (saved.value > 1) {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = saved.value > 1 ? 1 : 2.5;
      saved.value = next;
      scale.value = withTiming(next);
      if (next === 1) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View style={[{ flex: 1 }, style]}>
        <Image
          source={{ uri }}
          placeholder={{ thumbhash }}
          contentFit="contain"
          style={{ flex: 1 }}
          transition={150}
        />
      </Animated.View>
    </GestureDetector>
  );
}

function VideoPage({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />;
}

function ThumbPage({ item }: { item: TimelineItem }) {
  return (
    <Image
      source={{ uri: item.thumbUrl }}
      placeholder={{ thumbhash: item.thumbhash }}
      contentFit="contain"
      style={{ flex: 1 }}
      transition={150}
    />
  );
}

/**
 * Página del carrusel: muestra la miniatura al instante y pide el original
 * (URL prefirmada) solo cuando la página está activa o es adyacente — así
 * deslizar se siente inmediato sin precargar toda la biblioteca.
 */
function MediaPage({ item, active, near }: { item: TimelineItem; active: boolean; near: boolean }) {
  const detail = useQuery({
    queryKey: ["media", item.id],
    queryFn: () => api.mediaDetail(item.id),
    enabled: near,
    // Las URLs prefirmadas duran PRESIGN_TTL_SECONDS (15 min); reutilizar un
    // minuto evita refetch al ir y volver entre fotos.
    staleTime: 60_000,
  });
  const originalUrl = detail.data?.originalUrl;

  if (item.mediaType === "video") {
    // El player solo existe en la página activa (es pesado); las demás
    // páginas de video muestran su miniatura.
    return active && originalUrl ? <VideoPage uri={originalUrl} /> : <ThumbPage item={item} />;
  }
  return originalUrl ? (
    <ZoomableImage uri={originalUrl} thumbhash={item.thumbhash} active={active} />
  ) : (
    <ThumbPage item={item} />
  );
}

export default function MediaViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const [showInfo, setShowInfo] = useState(false);
  // El carrusel respeta el filtro activo de la galería (favoritos incluidos).
  const filter = useSettings((s) => s.timelineFilter);
  const timeline = useTimeline(filter);
  const items = useMemo(() => timeline.data?.pages.flatMap((p) => p.items) ?? [], [timeline.data]);

  // Carrusel solo cuando el timeline ya resolvió y contiene el id pedido; si
  // el elemento vive en una página aún no cargada, cae a la vista única.
  const foundIndex = items.findIndex((i) => i.id === id);
  const carousel = !timeline.isPending && foundIndex >= 0;
  // activeIndex = última página a la que se deslizó; antes de deslizar es la del id.
  const [scrolledIndex, setScrolledIndex] = useState<number | null>(null);
  const activeIndex = scrolledIndex ?? Math.max(0, foundIndex);
  const activeId = carousel ? (items[activeIndex]?.id ?? id) : id;

  const detail = useQuery({
    queryKey: ["media", activeId],
    queryFn: () => api.mediaDetail(activeId),
    enabled: !!activeId,
    staleTime: 60_000,
  });
  const d = detail.data;

  const isFav =
    items[activeIndex]?.id === activeId ? items[activeIndex]?.isFavorite : (d?.isFavorite ?? false);

  const fav = useMutation({
    mutationFn: api.toggleFavorite,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["timeline"] });
      void qc.invalidateQueries({ queryKey: ["media", activeId] });
    },
  });

  const del = useMutation({
    mutationFn: api.deleteMedia,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["timeline"] });
      void qc.invalidateQueries({ queryKey: ["trash"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      toast(t.viewer.movedToTrash, {
        action: {
          label: t.viewer.undo,
          onClick: () =>
            void api.restoreMedia(activeId).then(() => {
              void qc.invalidateQueries({ queryKey: ["timeline"] });
              void qc.invalidateQueries({ queryKey: ["trash"] });
              void qc.invalidateQueries({ queryKey: ["stats"] });
            }),
        },
      });
      router.back();
    },
  });

  const [downloading, setDownloading] = useState(false);
  const onDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const { url, filename } = await api.downloadMedia(activeId);
      await saveDownload(url, filename);
      toast.success(t.viewer.downloadDone);
    } catch {
      toast.error(t.viewer.downloadFailed);
    } finally {
      setDownloading(false);
    }
  };

  const onDeleteLocal = async () => {
    const ok = await deleteLocalCopy(activeId);
    if (ok) toast.success(t.viewer.deleteLocalDone);
    else toast(t.viewer.deleteLocalNone);
  };

  const onDeletePress = () => {
    // Web no tiene copia local que borrar: directo a la papelera (con deshacer).
    if (Platform.OS === "web") {
      del.mutate(activeId);
      return;
    }
    const buttons: AlertButton[] = [{ text: "Cancelar", style: "cancel" }];
    if (hasLocalCopy(activeId)) {
      buttons.push({ text: t.viewer.deleteLocal, onPress: () => void onDeleteLocal() });
    }
    buttons.push({
      text: t.viewer.moveToTrash,
      style: "destructive",
      onPress: () => del.mutate(activeId),
    });
    Alert.alert(t.viewer.deleteTitle, undefined, buttons);
  };

  const showSpinner = detail.isPending && !carousel;

  return (
    <SafeAreaView className="flex-1 bg-black" edges={["top", "bottom"]}>
      <View className="flex-row justify-between px-4 py-2 z-10">
        <Pressable onPress={() => router.back()} accessibilityLabel="cerrar" hitSlop={12}>
          <X color="#fff" size={26} />
        </Pressable>
        <View className="flex-row gap-5">
          <Pressable
            onPress={() => fav.mutate(activeId)}
            disabled={fav.isPending}
            accessibilityLabel={t.viewer.favorite}
            hitSlop={12}
          >
            <Heart color="#fff" size={24} fill={isFav ? "#f43f5e" : "none"} />
          </Pressable>
          <Pressable
            onPress={() => void onDownload()}
            disabled={downloading}
            accessibilityLabel={t.viewer.download}
            hitSlop={12}
          >
            {downloading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Download color="#fff" size={24} />
            )}
          </Pressable>
          <Pressable
            onPress={() => setShowInfo(true)}
            accessibilityLabel={t.viewer.info}
            hitSlop={12}
          >
            <Info color="#fff" size={24} />
          </Pressable>
          <Pressable onPress={onDeletePress} accessibilityLabel={t.viewer.deleteTitle} hitSlop={12}>
            <Trash2 color="#fff" size={24} />
          </Pressable>
        </View>
      </View>

      <View className="flex-1">
        {carousel ? (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            testID="carousel"
            horizontal
            pagingEnabled
            snapToInterval={width}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={foundIndex}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            windowSize={3}
            initialNumToRender={3}
            extraData={activeIndex}
            onMomentumScrollEnd={(e) =>
              setScrolledIndex(Math.round(e.nativeEvent.contentOffset.x / width))
            }
            renderItem={({ item, index }) => (
              // Página con tamaño explícito: sin flex (en web flex-basis:0
              // colapsaría el width; sin height el contenido flex-1 mide 0).
              <View style={{ width, height: "100%" }}>
                <MediaPage
                  item={item}
                  active={index === activeIndex}
                  near={Math.abs(index - activeIndex) <= 1}
                />
              </View>
            )}
          />
        ) : showSpinner ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#fff" />
          </View>
        ) : !d ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-neutral-400">No encontrado</Text>
          </View>
        ) : d.mediaType === "video" ? (
          <VideoPage uri={d.originalUrl} />
        ) : (
          <ZoomableImage uri={d.originalUrl} thumbhash={d.thumbhash} active />
        )}
      </View>

      <Modal
        visible={showInfo}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInfo(false)}
      >
        <Pressable className="flex-1 bg-black/40" onPress={() => setShowInfo(false)} />
        <View className="bg-white dark:bg-neutral-900 rounded-t-3xl px-6 pt-4 pb-10">
          <View className="w-10 h-1.5 rounded-full bg-neutral-300 self-center mb-4" />
          <Text className="text-xl font-bold text-neutral-900 dark:text-white mb-4">
            {t.viewer.info}
          </Text>
          {d ? (
            <ScrollView className="gap-3 max-h-80">
              <InfoRow label={t.viewer.date} value={formatDateTime(d.takenAt)} />
              <InfoRow label={t.viewer.size} value={formatBytes(d.fileSize)} />
              <InfoRow label={t.viewer.dimensions} value={`${d.width} × ${d.height}`} />
              {d.durationMs != null ? (
                <InfoRow label={t.viewer.duration} value={formatDuration(d.durationMs) ?? "—"} />
              ) : null}
              <InfoRow label={t.viewer.type} value={d.mediaType === "video" ? "Video" : "Foto"} />
              <InfoRow label={t.viewer.file} value={`.${d.ext} · ${d.mimeType}`} />
              {d.latitude != null && d.longitude != null ? (
                <InfoRow
                  label={t.viewer.location}
                  value={`${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)}`}
                />
              ) : null}
              <InfoRow label={t.viewer.uploaded} value={formatDateTime(d.createdAt)} />
              <View className="mt-2">
                <Button
                  label={t.viewer.moveToTrash}
                  variant="danger"
                  onPress={() => {
                    setShowInfo(false);
                    del.mutate(d.id);
                  }}
                />
              </View>
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2 border-b border-neutral-100 dark:border-neutral-800">
      <Text className="text-sm text-neutral-500">{label}</Text>
      <Text className="text-sm font-medium text-neutral-900 dark:text-white">{value}</Text>
    </View>
  );
}
