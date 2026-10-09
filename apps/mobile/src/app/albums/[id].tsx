import type { TimelineItem } from "@photos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import {
  ChevronLeft,
  Download,
  Edit2,
  FolderPlus,
  Heart,
  MoreVertical,
  Play,
  Plus,
  Share2,
  Trash2,
  X,
} from "lucide-react-native";
import { useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Share,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../../api/client";
import { t } from "../../i18n/es";
import { downloadMany } from "../../lib/download-many";
import { formatDuration } from "../../lib/format";
import { Button, EmptyState } from "../../ui";

export default function AlbumDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const albumId = typeof id === "string" ? id : "";
  const qc = useQueryClient();
  const { width } = useWindowDimensions();

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [menuVisible, setMenuVisible] = useState(false);
  const [addPhotosModalVisible, setAddPhotosModalVisible] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ["album", albumId],
    queryFn: () => api.albumDetail(albumId),
    enabled: Boolean(albumId),
  });

  const timelineQuery = useQuery({
    queryKey: ["timeline-for-album"],
    queryFn: () => api.timeline(undefined, 200),
    enabled: addPhotosModalVisible,
  });

  const album = query.data;

  // Mutación: editar título
  const updateMut = useMutation({
    mutationFn: (newTitle: string) => api.updateAlbum(albumId, { title: newTitle }),
    onSuccess: () => {
      setEditModalVisible(false);
      void qc.invalidateQueries({ queryKey: ["album", albumId] });
      void qc.invalidateQueries({ queryKey: ["albums"] });
      toast.success("Título actualizado");
    },
    onError: (err: Error) => toast.error(err.message || t.auth.genericError),
  });

  // Mutación: eliminar álbum
  const deleteMut = useMutation({
    mutationFn: () => api.deleteAlbum(albumId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["albums"] });
      toast.success("Álbum eliminado");
      router.back();
    },
    onError: (err: Error) => toast.error(err.message || t.auth.genericError),
  });

  // Mutación: compartir álbum
  const shareMut = useMutation({
    mutationFn: () => api.shareAlbum(albumId),
    onSuccess: async (data) => {
      void qc.invalidateQueries({ queryKey: ["album", albumId] });
      void qc.invalidateQueries({ queryKey: ["albums"] });

      let shareUrl = data.shareUrl;
      if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
        shareUrl = `${window.location.origin}/shared/album/${data.shareToken}`;
      }

      if (Platform.OS === "web") {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(shareUrl);
          toast.success(t.albums.shareLinkCopied);
        } else {
          window.prompt("Copia el enlace del álbum:", shareUrl);
        }
      } else {
        await Share.share({
          title: album?.title ?? t.albums.title,
          message: shareUrl,
          url: shareUrl,
        });
      }
    },
    onError: (err: Error) => toast.error(err.message || t.auth.genericError),
  });

  // Mutación: revocar compartir
  const unshareMut = useMutation({
    mutationFn: () => api.unshareAlbum(albumId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["album", albumId] });
      void qc.invalidateQueries({ queryKey: ["albums"] });
      toast.success("Enlace revocado");
    },
    onError: (err: Error) => toast.error(err.message || t.auth.genericError),
  });

  // Mutación: añadir fotos al álbum
  const addMediaMut = useMutation({
    mutationFn: (mediaIds: string[]) => api.addAlbumMedia(albumId, mediaIds),
    onSuccess: (_, vars) => {
      setAddPhotosModalVisible(false);
      setSelectedToAdd([]);
      void qc.invalidateQueries({ queryKey: ["album", albumId] });
      void qc.invalidateQueries({ queryKey: ["albums"] });
      toast.success(t.albums.photosAdded(vars.length));
    },
    onError: (err: Error) => toast.error(err.message || t.auth.genericError),
  });

  const handleDeleteAlbum = () => {
    setMenuVisible(false);
    if (Platform.OS === "web") {
      if (window.confirm(t.albums.deleteAlbumConfirm)) {
        deleteMut.mutate();
      }
    } else {
      Alert.alert(t.albums.deleteAlbum, t.albums.deleteAlbumConfirm, [
        { text: "Cancelar", style: "cancel" },
        { text: "Eliminar", style: "destructive", onPress: () => deleteMut.mutate() },
      ]);
    }
  };

  const handleUnshare = () => {
    setMenuVisible(false);
    if (Platform.OS === "web") {
      if (window.confirm(t.albums.unshareConfirm)) {
        unshareMut.mutate();
      }
    } else {
      Alert.alert(t.albums.unshare, t.albums.unshareConfirm, [
        { text: "Cancelar", style: "cancel" },
        { text: t.albums.unshare, style: "destructive", onPress: () => unshareMut.mutate() },
      ]);
    }
  };

  const [downloadingZip, setDownloadingZip] = useState(false);

  const handleDownloadAlbum = async () => {
    if (!album?.items?.length) {
      toast("El álbum no tiene fotos para descargar");
      return;
    }
    setMenuVisible(false);
    setDownloadingZip(true);
    toast(t.albums.downloadingZip);
    try {
      const zipTitle = (album.title || "album").replace(/[^a-zA-Z0-9_-]/g, "_");
      await downloadMany(
        album.items.map((i) => i.id),
        `${zipTitle}.zip`,
      );
      toast.success(t.albums.downloadZipDone);
    } catch (err: any) {
      toast.error(err.message || t.auth.genericError);
    } finally {
      setDownloadingZip(false);
    }
  };

  const numColumns = width > 768 ? 5 : 3;
  const gap = 3;
  const itemSize = (width - gap * (numColumns - 1)) / numColumns;

  const items = album?.items ?? [];
  const existingIds = new Set(items.map((i) => i.id));
  const availableToAdd = (timelineQuery.data?.items ?? []).filter((m) => !existingIds.has(m.id));

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top", "bottom"]}>
      {/* Barra superior */}
      <View className="flex-row items-center justify-between px-3 py-2 border-b border-neutral-200/50 dark:border-neutral-900">
        <View className="flex-row items-center gap-2 flex-1 mr-2">
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityLabel="Volver"
            className="p-1 rounded-full active:bg-neutral-200 dark:active:bg-neutral-800"
          >
            <ChevronLeft size={26} color="#737373" />
          </Pressable>
          <View className="flex-1">
            <Text className="text-lg font-bold text-neutral-900 dark:text-white" numberOfLines={1}>
              {album?.title ?? "Álbum"}
            </Text>
            <Text className="text-xs text-neutral-500">
              {t.albums.itemsCount(items.length)}
              {album?.isShared ? ` · ${t.albums.sharedBadge}` : ""}
            </Text>
          </View>
        </View>

        {/* Botones de acción */}
        <View className="flex-row items-center gap-1.5">
          <Pressable
            onPress={() => {
              setSelectedToAdd([]);
              setAddPhotosModalVisible(true);
            }}
            hitSlop={8}
            className="p-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 active:opacity-70"
            accessibilityLabel={t.albums.addPhotos}
          >
            <Plus size={20} color="#4f46e5" />
          </Pressable>

          <Pressable
            onPress={() => shareMut.mutate()}
            disabled={shareMut.isPending}
            hitSlop={8}
            className="p-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 active:opacity-70"
            accessibilityLabel={t.albums.share}
          >
            <Share2 size={20} color="#4f46e5" />
          </Pressable>

          <Pressable
            onPress={() => setMenuVisible(true)}
            hitSlop={8}
            className="p-2 rounded-xl active:bg-neutral-100 dark:active:bg-neutral-800"
            accessibilityLabel="Más opciones"
          >
            <MoreVertical size={20} color="#737373" />
          </Pressable>
        </View>
      </View>

      {/* Grid de fotos del álbum */}
      {items.length === 0 && !query.isPending ? (
        <View className="flex-1 justify-center px-6">
          <EmptyState
            title="Álbum vacío"
            body="Añade fotos para comenzar a organizar tus recuerdos en este álbum."
            actionLabel={t.albums.addPhotos}
            action={() => {
              setSelectedToAdd([]);
              setAddPhotosModalVisible(true);
            }}
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={numColumns}
          key={numColumns}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />
          }
          renderItem={({ item }: { item: TimelineItem }) => (
            <Pressable
              style={{ width: itemSize, height: itemSize, margin: gap / 2 }}
              onPress={() =>
                router.push({
                  pathname: "/media/[id]",
                  params: {
                    id: item.id,
                    albumId,
                    mediaType: item.mediaType,
                    durationMs: item.durationMs != null ? String(item.durationMs) : "",
                    width: String(item.width),
                    height: String(item.height),
                    thumbhash: item.thumbhash,
                  },
                })
              }
              className="bg-neutral-200 dark:bg-neutral-900 overflow-hidden"
              accessibilityRole="button"
            >
              <Image
                source={{ uri: item.thumbUrl }}
                placeholder={{ thumbhash: item.thumbhash }}
                style={{ width: "100%", height: "100%" }}
                contentFit="cover"
                transition={200}
              />
              {item.mediaType === "video" ? (
                <View className="absolute bottom-1 right-1 bg-black/60 backdrop-blur-md rounded-md px-1.5 py-0.5 flex-row items-center gap-1">
                  <Play size={10} color="#fff" fill="#fff" />
                  {item.durationMs ? (
                    <Text className="text-white text-[10px] font-medium">
                      {formatDuration(item.durationMs)}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {item.isFavorite ? (
                <View className="absolute bottom-1.5 left-1.5 bg-black/50 rounded-full p-1 shadow-sm">
                  <Heart size={12} color="#f43f5e" fill="#f43f5e" />
                </View>
              ) : null}
            </Pressable>
          )}
        />
      )}

      {/* Menú de opciones secundarias (Modal) */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-end md:justify-center md:items-center px-4 pb-6 md:pb-0"
          onPress={() => setMenuVisible(false)}
        >
          <View className="bg-white dark:bg-neutral-900 w-full max-w-sm rounded-3xl p-4 gap-2 border border-neutral-200 dark:border-neutral-800 shadow-xl">
            <Pressable
              className="flex-row items-center gap-3 px-4 py-3 rounded-2xl active:bg-neutral-100 dark:active:bg-neutral-800"
              onPress={() => {
                setMenuVisible(false);
                setEditedTitle(album?.title ?? "");
                setEditModalVisible(true);
              }}
            >
              <Edit2 size={18} color="#737373" />
              <Text className="text-base text-neutral-900 dark:text-white font-medium">
                {t.albums.editTitle}
              </Text>
            </Pressable>

            {album?.isShared ? (
              <Pressable
                className="flex-row items-center gap-3 px-4 py-3 rounded-2xl active:bg-neutral-100 dark:active:bg-neutral-800"
                onPress={handleUnshare}
              >
                <Share2 size={18} color="#f59e0b" />
                <Text className="text-base text-amber-600 dark:text-amber-500 font-medium">
                  {t.albums.unshare}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              className="flex-row items-center gap-3 px-4 py-3 rounded-2xl active:bg-neutral-100 dark:active:bg-neutral-800"
              onPress={handleDownloadAlbum}
              disabled={downloadingZip || !items.length}
            >
              <Download size={18} color="#4f46e5" />
              <Text className="text-base text-neutral-900 dark:text-white font-medium">
                {t.albums.downloadZip}
              </Text>
            </Pressable>

            <Pressable
              className="flex-row items-center gap-3 px-4 py-3 rounded-2xl active:bg-neutral-100 dark:active:bg-neutral-800"
              onPress={handleDeleteAlbum}
            >
              <Trash2 size={18} color="#ef4444" />
              <Text className="text-base text-red-600 font-medium">{t.albums.deleteAlbum}</Text>
            </Pressable>

            <Pressable
              className="items-center py-2.5 mt-1 border-t border-neutral-100 dark:border-neutral-800"
              onPress={() => setMenuVisible(false)}
            >
              <Text className="text-neutral-500 font-medium">Cerrar</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Modal: Editar título */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View className="flex-1 bg-black/50 justify-center items-center px-6">
          <View className="bg-white dark:bg-neutral-900 w-full max-w-sm rounded-3xl p-6 gap-4 border border-neutral-200 dark:border-neutral-800 shadow-xl">
            <Text className="text-xl font-bold text-neutral-900 dark:text-white">
              {t.albums.editTitle}
            </Text>
            <TextInput
              className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-base text-neutral-900 dark:text-white"
              value={editedTitle}
              onChangeText={setEditedTitle}
              autoFocus
              maxLength={100}
            />
            <View className="flex-row gap-2 pt-1">
              <View className="flex-1">
                <Button
                  label="Cancelar"
                  variant="ghost"
                  size="sm"
                  onPress={() => setEditModalVisible(false)}
                />
              </View>
              <View className="flex-1">
                <Button
                  label="Guardar"
                  size="sm"
                  onPress={() => {
                    const trimmed = editedTitle.trim();
                    if (trimmed) updateMut.mutate(trimmed);
                  }}
                  loading={updateMut.isPending}
                  disabled={!editedTitle.trim()}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Añadir fotos al álbum */}
      <Modal
        visible={addPhotosModalVisible}
        animationType="slide"
        onRequestClose={() => setAddPhotosModalVisible(false)}
      >
        <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top", "bottom"]}>
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <View className="flex-row items-center gap-2">
              <FolderPlus size={20} color="#4f46e5" />
              <Text className="text-lg font-bold text-neutral-900 dark:text-white">
                {t.albums.addPhotos}
              </Text>
            </View>
            <Pressable
              onPress={() => setAddPhotosModalVisible(false)}
              hitSlop={12}
              accessibilityLabel="Cerrar"
            >
              <X size={22} color="#737373" />
            </Pressable>
          </View>

          {availableToAdd.length === 0 ? (
            <View className="flex-1 justify-center px-6">
              <Text className="text-center text-neutral-500">
                Todas las fotos de tu biblioteca ya están en este álbum.
              </Text>
            </View>
          ) : (
            <FlatList
              data={availableToAdd}
              keyExtractor={(item) => item.id}
              numColumns={numColumns}
              key={numColumns}
              renderItem={({ item }: { item: TimelineItem }) => {
                const isSelected = selectedToAdd.includes(item.id);
                return (
                  <Pressable
                    style={{ width: itemSize, height: itemSize, margin: gap / 2 }}
                    onPress={() => {
                      setSelectedToAdd((prev) =>
                        prev.includes(item.id)
                          ? prev.filter((id) => id !== item.id)
                          : [...prev, item.id],
                      );
                    }}
                    className={`bg-neutral-200 dark:bg-neutral-900 overflow-hidden ${isSelected ? "opacity-80" : ""}`}
                  >
                    <Image
                      source={{ uri: item.thumbUrl }}
                      placeholder={{ thumbhash: item.thumbhash }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                    />
                    <View
                      className={`absolute top-2 right-2 w-6 h-6 rounded-full border-2 items-center justify-center ${isSelected ? "bg-accent border-white" : "bg-black/30 border-white/80"}`}
                    >
                      {isSelected ? <Text className="text-white text-xs font-bold">✓</Text> : null}
                    </View>
                  </Pressable>
                );
              }}
            />
          )}

          {selectedToAdd.length > 0 ? (
            <View className="p-4 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
              <Button
                label={`Añadir (${selectedToAdd.length})`}
                onPress={() => addMediaMut.mutate(selectedToAdd)}
                loading={addMediaMut.isPending}
              />
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
