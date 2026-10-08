import type { TimelineItem } from "@photos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  Camera,
  Crop,
  Download,
  ExternalLink,
  FolderPlus,
  Heart,
  Info,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  type AlertButton,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../../api/client";
import { t } from "../../i18n/es";
import { formatBytes, formatDateTime, formatDuration } from "../../lib/format";
import { deleteLocalCopy, hasLocalCopy } from "../../lib/free-space";
import { saveDownload } from "../../lib/save-download";
import { useSettings } from "../../lib/store";
import { useTimeline } from "../../lib/timeline";
import { Button, PhotoEditorModal } from "../../ui";
import { AddToAlbumModal } from "../../ui/AddToAlbumModal";

function ZoomableImage({
  uri,
  thumbhash,
  active,
  onDismiss,
  onDoubleTap,
}: {
  uri: string;
  thumbhash: string;
  active: boolean;
  /** Swipe-down a escala 1 → cerrar el visor (fase 7). */
  onDismiss?: () => void;
  onDoubleTap?: () => void;
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
      } else if (Math.abs(e.translationY) > Math.abs(e.translationX)) {
        // A escala 1 un arrastre vertical es candidato a swipe-down: la foto
        // sigue al dedo y encoge; el swipe horizontal queda para el carrusel.
        ty.value = e.translationY;
        scale.value = Math.max(0.7, 1 - Math.abs(e.translationY) / 1000);
      }
    })
    .onEnd((e) => {
      if (saved.value > 1) {
        savedTx.value = tx.value;
        savedTy.value = ty.value;
        return;
      }
      if (onDismiss && (Math.abs(e.translationY) > 120 || Math.abs(e.velocityY) > 700)) {
        runOnJS(onDismiss)();
        return;
      }
      ty.value = withTiming(0);
      scale.value = withTiming(1);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (onDoubleTap) {
        runOnJS(onDoubleTap)();
      }
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
function MediaPage({
  item,
  active,
  near,
  onDismiss,
  onDoubleTap,
}: {
  item: TimelineItem;
  active: boolean;
  near: boolean;
  onDismiss?: () => void;
  onDoubleTap?: () => void;
}) {
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
    <ZoomableImage
      uri={originalUrl}
      thumbhash={item.thumbhash}
      active={active}
      onDismiss={onDismiss}
      onDoubleTap={onDoubleTap}
    />
  ) : (
    <ThumbPage item={item} />
  );
}

export default function MediaViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const [showInfo, setShowInfo] = useState(false);
  const [addToAlbumOpen, setAddToAlbumOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
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

  const [captionInput, setCaptionInput] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
  const [showAddTag, setShowAddTag] = useState(false);

  useEffect(() => {
    if (d) {
      setCaptionInput(d.caption ?? "");
    }
  }, [d]);

  const updateMeta = useMutation({
    mutationFn: (body: { caption?: string | null; tags?: string[] }) =>
      api.updateMedia(activeId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["media", activeId] });
      void qc.invalidateQueries({ queryKey: ["tags"] });
      void qc.invalidateQueries({ queryKey: ["search"] });
      toast.success("Información actualizada");
    },
    onError: (err: Error) => toast.error(err.message || t.auth.genericError),
  });

  const autoTagMutation = useMutation({
    mutationFn: () => api.autoTagMedia(activeId),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["media", activeId] });
      void qc.invalidateQueries({ queryKey: ["tags"] });
      void qc.invalidateQueries({ queryKey: ["search"] });
      if (res.tags.length > 0) {
        toast.success(t.viewer.autoTagSuccess);
      } else {
        toast.info(t.viewer.autoTagFailed);
      }
    },
    onError: (err: Error) => toast.error(err.message || t.viewer.autoTagFailed),
  });

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
  const onDismiss = () => router.back();

  const heartScale = useSharedValue(0);
  const heartOpacity = useSharedValue(0);

  const heartAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
    opacity: heartOpacity.value,
  }));

  const triggerHeartAnimation = () => {
    heartScale.value = 0;
    heartOpacity.value = 1;
    heartScale.value = withSequence(
      withSpring(1.3, { damping: 10, stiffness: 220 }),
      withDelay(300, withTiming(0, { duration: 250 })),
    );
    heartOpacity.value = withDelay(400, withTiming(0, { duration: 250 }));
  };

  const handleDoubleTap = () => {
    triggerHeartAnimation();
    if (!isFav) {
      fav.mutate(activeId);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-black" edges={["top", "bottom"]}>
      <View className="flex-row justify-between px-4 py-2 z-10">
        <Pressable onPress={() => router.back()} accessibilityLabel="cerrar" hitSlop={12}>
          <X color="#fff" size={26} />
        </Pressable>
        <View className="flex-row gap-5">
          {d?.mediaType === "photo" ? (
            <Pressable
              onPress={() => setEditorOpen(true)}
              accessibilityLabel={t.editor.title}
              hitSlop={12}
            >
              <Crop color="#fff" size={24} />
            </Pressable>
          ) : null}
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
          <Pressable
            onPress={() => setAddToAlbumOpen(true)}
            accessibilityLabel={t.albums.addToAlbum}
            hitSlop={12}
          >
            <FolderPlus color="#fff" size={24} />
          </Pressable>
          <Pressable onPress={onDeletePress} accessibilityLabel={t.viewer.deleteTitle} hitSlop={12}>
            <Trash2 color="#fff" size={24} />
          </Pressable>
        </View>
      </View>

      <View className="flex-1">
        {/* Corazón animado para gesto de doble toque */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              justifyContent: "center",
              alignItems: "center",
              zIndex: 50,
            },
            heartAnimatedStyle,
          ]}
        >
          <Heart size={96} color="#f43f5e" fill="#f43f5e" />
        </Animated.View>

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
                  onDismiss={onDismiss}
                  onDoubleTap={handleDoubleTap}
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
          <ZoomableImage
            uri={d.originalUrl}
            thumbhash={d.thumbhash}
            active
            onDismiss={onDismiss}
            onDoubleTap={handleDoubleTap}
          />
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
            <ScrollView className="gap-3 max-h-[480px]">
              {/* Sección de Pie de foto / Descripción */}
              <View className="py-2 border-b border-neutral-100 dark:border-neutral-800 gap-1.5">
                <Text className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                  {t.viewer.caption}
                </Text>
                <View className="flex-row items-center gap-2">
                  <TextInput
                    className="flex-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl px-3 py-2 text-sm text-neutral-900 dark:text-white"
                    placeholder={t.viewer.captionPlaceholder}
                    placeholderTextColor="#737373"
                    value={captionInput}
                    onChangeText={setCaptionInput}
                    maxLength={500}
                  />
                  {captionInput !== (d.caption ?? "") ? (
                    <Button
                      label={t.viewer.saveCaption}
                      size="sm"
                      loading={updateMeta.isPending}
                      onPress={() => updateMeta.mutate({ caption: captionInput.trim() || null })}
                    />
                  ) : null}
                </View>
              </View>

              {/* Sección de Etiquetas */}
              <View className="py-2 border-b border-neutral-100 dark:border-neutral-800 gap-2">
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    {t.viewer.tags}
                  </Text>
                  <View className="flex-row items-center gap-3">
                    <Pressable
                      onPress={() => autoTagMutation.mutate()}
                      disabled={autoTagMutation.isPending}
                      hitSlop={8}
                      className="flex-row items-center gap-1 active:opacity-70"
                    >
                      <Sparkles size={13} color="#6366f1" />
                      <Text className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        {autoTagMutation.isPending ? t.viewer.autoTagging : t.viewer.autoTag}
                      </Text>
                    </Pressable>
                    {!showAddTag ? (
                      <Pressable
                        onPress={() => setShowAddTag(true)}
                        hitSlop={8}
                        className="flex-row items-center gap-1"
                      >
                        <Plus size={14} color="#4f46e5" />
                        <Text className="text-xs font-medium text-accent">{t.viewer.addTag}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>

                {showAddTag ? (
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      className="flex-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl px-3 py-1.5 text-xs text-neutral-900 dark:text-white"
                      placeholder={t.viewer.tagPlaceholder}
                      placeholderTextColor="#737373"
                      value={newTagInput}
                      onChangeText={setNewTagInput}
                      autoFocus
                    />
                    <Button
                      label="+"
                      size="sm"
                      loading={updateMeta.isPending}
                      onPress={() => {
                        const trimmed = newTagInput.trim().toLowerCase();
                        if (trimmed && !d.tags.includes(trimmed)) {
                          updateMeta.mutate(
                            { tags: [...d.tags, trimmed] },
                            {
                              onSuccess: () => {
                                setNewTagInput("");
                                setShowAddTag(false);
                              },
                            },
                          );
                        } else {
                          setShowAddTag(false);
                        }
                      }}
                    />
                    <Pressable
                      onPress={() => {
                        setShowAddTag(false);
                        setNewTagInput("");
                      }}
                    >
                      <X size={18} color="#737373" />
                    </Pressable>
                  </View>
                ) : null}

                <View className="flex-row flex-wrap gap-1.5">
                  {d.tags.length === 0 ? (
                    <Text className="text-xs text-neutral-400">Sin etiquetas</Text>
                  ) : (
                    d.tags.map((tag) => (
                      <View
                        key={tag}
                        className="flex-row items-center gap-1 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-2.5 py-1 rounded-lg"
                      >
                        <Text className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                          #{tag}
                        </Text>
                        <Pressable
                          onPress={() =>
                            updateMeta.mutate({ tags: d.tags.filter((t) => t !== tag) })
                          }
                          hitSlop={6}
                        >
                          <X size={12} color="#737373" />
                        </Pressable>
                      </View>
                    ))
                  )}
                </View>
              </View>

              <InfoRow label={t.viewer.date} value={formatDateTime(d.takenAt)} />
              <InfoRow label={t.viewer.size} value={formatBytes(d.fileSize)} />
              <InfoRow label={t.viewer.dimensions} value={`${d.width} × ${d.height}`} />
              {d.durationMs != null ? (
                <InfoRow label={t.viewer.duration} value={formatDuration(d.durationMs) ?? "—"} />
              ) : null}
              <InfoRow label={t.viewer.type} value={d.mediaType === "video" ? "Video" : "Foto"} />
              <InfoRow label={t.viewer.file} value={`.${d.ext} · ${d.mimeType}`} />

              {/* Ficha técnica EXIF / Detalles de la cámara */}
              {d.cameraModel ||
              d.cameraMake ||
              d.fNumber != null ||
              d.focalLength != null ||
              d.iso != null ||
              d.exposureTime ? (
                <View className="py-2.5 px-3.5 my-1 rounded-2xl bg-neutral-100 dark:bg-neutral-800/80 border border-neutral-200/80 dark:border-neutral-700/80 gap-2">
                  <View className="flex-row items-center gap-2">
                    <Camera size={16} color="#6366f1" />
                    <Text className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                      {d.cameraMake ? `${d.cameraMake} ` : ""}
                      {d.cameraModel || t.viewer.camera}
                    </Text>
                  </View>
                  {d.lensModel ? (
                    <Text className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      {d.lensModel}
                    </Text>
                  ) : null}
                  <View className="flex-row flex-wrap gap-2 pt-1 border-t border-neutral-200/60 dark:border-neutral-700/60">
                    {d.focalLength != null ? (
                      <View className="bg-white dark:bg-neutral-900 px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700">
                        <Text className="text-[11px] font-medium text-neutral-800 dark:text-neutral-200">
                          {d.focalLength} mm
                        </Text>
                      </View>
                    ) : null}
                    {d.fNumber != null ? (
                      <View className="bg-white dark:bg-neutral-900 px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700">
                        <Text className="text-[11px] font-medium text-neutral-800 dark:text-neutral-200">
                          ƒ/{d.fNumber}
                        </Text>
                      </View>
                    ) : null}
                    {d.exposureTime ? (
                      <View className="bg-white dark:bg-neutral-900 px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700">
                        <Text className="text-[11px] font-medium text-neutral-800 dark:text-neutral-200">
                          {d.exposureTime}
                        </Text>
                      </View>
                    ) : null}
                    {d.iso != null ? (
                      <View className="bg-white dark:bg-neutral-900 px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700">
                        <Text className="text-[11px] font-medium text-neutral-800 dark:text-neutral-200">
                          ISO {d.iso}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}
              {d.latitude != null && d.longitude != null ? (
                <View className="py-2 border-b border-neutral-100 dark:border-neutral-800 gap-2">
                  <View className="flex-row justify-between items-center">
                    <Text className="text-sm text-neutral-500">{t.viewer.location}</Text>
                    <View className="items-end">
                      {d.locationName ? (
                        <Text className="text-sm font-semibold text-neutral-900 dark:text-white">
                          {d.locationName}
                        </Text>
                      ) : null}
                      <Text className="text-xs text-neutral-400">
                        {d.latitude.toFixed(4)}, {d.longitude.toFixed(4)}
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={() => {
                        setShowInfo(false);
                        router.push({
                          pathname: "/map",
                          params: { lat: String(d.latitude), lng: String(d.longitude) },
                        });
                      }}
                      className="flex-1 flex-row items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-accent/10 border border-accent/20 active:bg-accent/20"
                    >
                      <MapPin size={15} color="#4f46e5" />
                      <Text className="text-xs font-semibold text-accent">
                        {t.viewer.viewOnMap}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        const url =
                          Platform.OS === "ios"
                            ? `maps://?q=${d.latitude},${d.longitude}`
                            : `https://www.google.com/maps/search/?api=1&query=${d.latitude},${d.longitude}`;
                        void Linking.openURL(url);
                      }}
                      className="p-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 items-center justify-center active:opacity-70"
                      accessibilityLabel={t.viewer.openInMaps}
                    >
                      <ExternalLink size={16} color="#737373" />
                    </Pressable>
                  </View>
                </View>
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

      <AddToAlbumModal
        visible={addToAlbumOpen}
        mediaIds={[activeId]}
        onClose={() => setAddToAlbumOpen(false)}
      />

      {d && d.mediaType === "photo" ? (
        <PhotoEditorModal
          visible={editorOpen}
          uri={d.originalUrl}
          width={d.width}
          height={d.height}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["timeline"] });
            void qc.invalidateQueries({ queryKey: ["media", activeId] });
          }}
        />
      ) : null}
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
