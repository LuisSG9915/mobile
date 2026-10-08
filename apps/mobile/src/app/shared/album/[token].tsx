import type { PublicAlbumItem } from "@photos/shared";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Download,
  Link as LinkIcon,
  Play,
  Share2,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../../../api/client";
import { t } from "../../../i18n/es";
import { formatDuration } from "../../../lib/format";
import { downloadPublicAlbum } from "../../../lib/public-download";
import { saveDownload } from "../../../lib/save-download";
import { EmptyState } from "../../../ui";

function NativePublicVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={{ flex: 1, width: "100%", height: "100%" }}
      contentFit="contain"
      nativeControls
    />
  );
}

function PublicVideoPlayer({ uri }: { uri: string }) {
  if (Platform.OS === "web") {
    return (
      <View
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* biome-ignore lint/a11y/useMediaCaption: videos personales subidos por el usuario */}
        <video
          src={uri}
          controls
          autoPlay
          playsInline
          style={{
            maxWidth: "100%",
            maxHeight: "80vh",
            width: "auto",
            height: "auto",
            objectFit: "contain",
          }}
        />
      </View>
    );
  }
  return <NativePublicVideo uri={uri} />;
}

export default function SharedAlbumScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const shareToken = typeof token === "string" ? token : "";
  const { width } = useWindowDimensions();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [isDownloadingSingle, setIsDownloadingSingle] = useState(false);

  const query = useQuery({
    queryKey: ["public-album", shareToken],
    queryFn: () => api.publicSharedAlbum(shareToken),
    enabled: Boolean(shareToken),
  });

  const album = query.data;
  const items = album?.items ?? [];
  const selectedPhoto = selectedIndex !== null ? (items[selectedIndex] ?? null) : null;

  const numColumns = width > 1200 ? 6 : width > 900 ? 5 : width > 600 ? 4 : 3;
  const gap = 4;
  const itemSize = (width - gap * (numColumns - 1)) / numColumns;

  // Navegación por teclado en la versión web
  useEffect(() => {
    if (Platform.OS !== "web" || selectedIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setSelectedIndex((curr) => (curr !== null && curr > 0 ? curr - 1 : curr));
      } else if (e.key === "ArrowRight") {
        setSelectedIndex((curr) => (curr !== null && curr < items.length - 1 ? curr + 1 : curr));
      } else if (e.key === "Escape") {
        setSelectedIndex(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, items.length]);

  const handleDownloadAll = async () => {
    if (!album || !items.length || isDownloadingAll) return;
    setIsDownloadingAll(true);
    toast(t.albums.downloadingZip);
    try {
      await downloadPublicAlbum(album.title, items);
      toast.success(t.albums.downloadZipDone);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.viewer.downloadFailed;
      toast.error(msg);
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const handleDownloadSingle = async (item: PublicAlbumItem) => {
    if (isDownloadingSingle) return;
    setIsDownloadingSingle(true);
    try {
      const ext = item.mediaType === "video" ? "mp4" : "jpg";
      const filename = `${item.id}.${ext}`;
      await saveDownload(item.downloadUrl || item.originalUrl, filename);
      toast.success(t.viewer.downloadDone);
    } catch {
      toast.error(t.viewer.downloadFailed);
    } finally {
      setIsDownloadingSingle(false);
    }
  };

  const handleShareLink = async () => {
    let url = "";
    if (Platform.OS === "web" && typeof window !== "undefined") {
      url = window.location.href;
    } else {
      url = `https://photos-web.luis-sg9915.workers.dev/shared/album/${shareToken}`;
    }

    if (Platform.OS === "web") {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast.success(t.albums.shareLinkCopied);
      } else {
        window.prompt("Enlace del álbum compartido:", url);
      }
    } else {
      await Share.share({
        title: album?.title ?? t.albums.publicViewTitle,
        message: url,
        url,
      });
    }
  };

  const goPrev = useCallback(() => {
    setSelectedIndex((curr) => (curr !== null && curr > 0 ? curr - 1 : curr));
  }, []);

  const goNext = useCallback(() => {
    setSelectedIndex((curr) => (curr !== null && curr < items.length - 1 ? curr + 1 : curr));
  }, [items.length]);

  if (query.isPending) {
    return (
      <SafeAreaView className="flex-1 bg-neutral-900 items-center justify-center">
        <ActivityIndicator size="large" color="#4f46e5" />
      </SafeAreaView>
    );
  }

  if (query.isError || !album) {
    return (
      <SafeAreaView className="flex-1 bg-neutral-900 items-center justify-center px-6">
        <EmptyState
          title="Álbum no disponible"
          body="Este enlace ha expirado, ha sido revocado o la dirección no es válida."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-neutral-950 text-white" edges={["top", "bottom"]}>
      {/* Cabecera elegante tipo Google Photos / Cloud Gallery */}
      <View className="px-6 py-5 border-b border-neutral-800 bg-neutral-900/60 backdrop-blur-md">
        <View className="flex-row flex-wrap items-center justify-between gap-4">
          <View className="flex-1 min-w-[200px]">
            <View className="flex-row items-center gap-2 mb-1.5">
              <View className="bg-accent/20 p-1.5 rounded-lg">
                <Share2 size={16} color="#6366f1" />
              </View>
              <Text className="text-xs uppercase font-bold text-indigo-400 tracking-wider">
                {t.albums.publicViewTitle}
              </Text>
            </View>
            <Text
              className="text-2xl md:text-3xl font-extrabold text-white tracking-tight"
              numberOfLines={2}
            >
              {album.title}
            </Text>
            <Text className="text-xs md:text-sm text-neutral-400 mt-1">
              {t.albums.itemsCount(album.mediaCount)} ·{" "}
              {new Date(album.createdAt).toLocaleDateString("es", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </Text>
          </View>

          {/* Acciones principales del álbum */}
          <View className="flex-row items-center gap-2.5">
            <Pressable
              onPress={handleShareLink}
              hitSlop={8}
              className="flex-row items-center gap-2 px-3.5 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-700 border border-neutral-700 transition"
              accessibilityLabel="Copiar enlace"
            >
              <LinkIcon size={16} color="#cbd5e1" />
              <Text className="text-xs font-semibold text-neutral-200">Enlace</Text>
            </Pressable>

            <Pressable
              onPress={handleDownloadAll}
              disabled={isDownloadingAll || items.length === 0}
              hitSlop={8}
              className={`flex-row items-center gap-2 px-4 py-2.5 rounded-xl transition ${
                isDownloadingAll || items.length === 0
                  ? "bg-accent/50 opacity-70"
                  : "bg-accent hover:bg-accent-hover active:bg-accent-hover"
              }`}
              accessibilityLabel="Descargar álbum completo"
            >
              {isDownloadingAll ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Archive size={16} color="#fff" />
              )}
              <Text className="text-xs font-bold text-white">
                {isDownloadingAll ? t.albums.downloadingZip : t.albums.downloadZip}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Grid de fotos y videos */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={numColumns}
        key={numColumns}
        contentContainerStyle={{ padding: gap / 2 }}
        renderItem={({ item, index }: { item: PublicAlbumItem; index: number }) => (
          <Pressable
            style={{ width: itemSize, height: itemSize, margin: gap / 2 }}
            onPress={() => setSelectedIndex(index)}
            className="bg-neutral-900 rounded-lg overflow-hidden group border border-neutral-850 hover:border-accent/40 active:opacity-90 transition"
          >
            <Image
              source={{ uri: item.thumbUrl }}
              placeholder={{ thumbhash: item.thumbhash }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              transition={200}
            />
            {item.mediaType === "video" ? (
              <View className="absolute bottom-1.5 right-1.5 bg-black/75 backdrop-blur-md rounded-md px-1.5 py-0.5 flex-row items-center gap-1">
                <Play size={10} color="#fff" fill="#fff" />
                {item.durationMs ? (
                  <Text className="text-white text-[10px] font-semibold">
                    {formatDuration(item.durationMs)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Pressable>
        )}
      />

      {/* Visor modal interactivo y responsivo */}
      <Modal
        visible={selectedPhoto !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedIndex(null)}
      >
        <SafeAreaView className="flex-1 bg-black/95 justify-between" edges={["top", "bottom"]}>
          {/* Barra superior de controles del visor */}
          <View className="flex-row justify-between items-center px-4 py-3 z-20 bg-gradient-to-b from-black/80 to-transparent">
            <View className="flex-row items-center gap-3">
              <Pressable
                onPress={() => setSelectedIndex(null)}
                hitSlop={12}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 transition"
                accessibilityLabel={t.albums.publicViewerClose}
              >
                <X size={20} color="#fff" />
              </Pressable>

              {selectedIndex !== null ? (
                <Text className="text-xs font-semibold text-neutral-300">
                  {t.albums.publicViewerCounter(selectedIndex + 1, items.length)}
                </Text>
              ) : null}
            </View>

            {selectedPhoto ? (
              <Pressable
                onPress={() => handleDownloadSingle(selectedPhoto)}
                disabled={isDownloadingSingle}
                hitSlop={12}
                className="flex-row items-center gap-2 bg-white/15 hover:bg-white/25 active:bg-white/30 px-3.5 py-1.5 rounded-full transition"
                accessibilityLabel="Descargar elemento actual"
              >
                {isDownloadingSingle ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Download size={15} color="#fff" />
                )}
                <Text className="text-white text-xs font-semibold">
                  {t.albums.publicViewerDownloadOne}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Área principal de visualización con soporte completo para fotos y videos */}
          <View className="flex-1 items-center justify-center relative px-2">
            {/* Flecha anterior */}
            {selectedIndex !== null && selectedIndex > 0 ? (
              <Pressable
                onPress={goPrev}
                hitSlop={16}
                className="absolute left-3 z-20 p-2.5 rounded-full bg-black/60 hover:bg-black/90 text-white backdrop-blur-md transition active:scale-95"
                accessibilityLabel={t.albums.publicViewerPrev}
              >
                <ChevronLeft size={26} color="#fff" />
              </Pressable>
            ) : null}

            {/* Renderizado de video o imagen */}
            {selectedPhoto ? (
              selectedPhoto.mediaType === "video" ? (
                <PublicVideoPlayer uri={selectedPhoto.originalUrl} />
              ) : (
                <Image
                  source={{ uri: selectedPhoto.originalUrl }}
                  placeholder={{ thumbhash: selectedPhoto.thumbhash }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="contain"
                  transition={150}
                />
              )
            ) : null}

            {/* Flecha siguiente */}
            {selectedIndex !== null && selectedIndex < items.length - 1 ? (
              <Pressable
                onPress={goNext}
                hitSlop={16}
                className="absolute right-3 z-20 p-2.5 rounded-full bg-black/60 hover:bg-black/90 text-white backdrop-blur-md transition active:scale-95"
                accessibilityLabel={t.albums.publicViewerNext}
              >
                <ChevronRight size={26} color="#fff" />
              </Pressable>
            ) : null}
          </View>

          {/* Tira inferior de miniaturas (filmstrip) para salto directo */}
          {items.length > 1 ? (
            <View className="py-2.5 px-3 bg-black/70 backdrop-blur-md border-t border-white/10 z-20">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, alignItems: "center" }}
              >
                {items.map((it, idx) => {
                  const isCurrent = idx === selectedIndex;
                  return (
                    <Pressable
                      key={it.id}
                      onPress={() => setSelectedIndex(idx)}
                      className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition ${
                        isCurrent
                          ? "border-accent scale-105 shadow-md"
                          : "border-transparent opacity-60 hover:opacity-100"
                      }`}
                    >
                      <Image
                        source={{ uri: it.thumbUrl }}
                        style={{ width: "100%", height: "100%" }}
                        contentFit="cover"
                      />
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
