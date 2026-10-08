import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import {
  Cloud,
  CloudOff,
  Folder,
  FolderPlus,
  Plus,
  Share2,
  Smartphone,
  X,
} from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../../api/client";
import { t } from "../../i18n/es";
import { type DeviceAlbum, listLocalAlbums } from "../../lib/local-assets";
import { useSettings } from "../../lib/store";
import { scanLibrary } from "../../queue/scanner";
import { Button } from "../../ui";

const isWeb = Platform.OS === "web";

type TabMode = "all" | "cloud" | "device";

export default function AlbumsScreen() {
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const [modalVisible, setModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [activeTab, setActiveTab] = useState<TabMode>("all");

  const setAlbumFilter = useSettings((s) => s.setAlbumFilter);
  const isAlbumSynced = useSettings((s) => s.isAlbumSynced);
  const toggleAlbumSync = useSettings((s) => s.toggleAlbumSync);
  const syncAllAlbums = useSettings((s) => s.syncAllAlbums);
  const syncNoAlbums = useSettings((s) => s.syncNoAlbums);
  const syncedAlbumIds = useSettings((s) => s.syncedAlbumIds);

  // Consulta de álbumes en la nube
  const cloudQuery = useQuery({
    queryKey: ["albums"],
    queryFn: api.albums,
  });

  // Consulta de álbumes locales (solo nativo)
  const localQuery = useQuery({
    queryKey: ["local-albums"],
    queryFn: listLocalAlbums,
    enabled: !isWeb,
  });

  const createMut = useMutation({
    mutationFn: (title: string) => api.createAlbum({ title }),
    onSuccess: (newAlbum) => {
      setModalVisible(false);
      setNewTitle("");
      void qc.invalidateQueries({ queryKey: ["albums"] });
      toast.success(`Álbum "${newAlbum.title}" creado`);
      router.push({ pathname: "/albums/[id]", params: { id: newAlbum.id } });
    },
    onError: (err: Error) => {
      toast.error(err.message || t.auth.genericError);
    },
  });

  const cloudAlbums = cloudQuery.data?.albums ?? [];
  const localAlbums = localQuery.data ?? [];
  const allLocalIds = useMemo(() => localAlbums.map((a) => a.id), [localAlbums]);

  const numColumns = width > 768 ? 4 : 2;
  const gap = 14;
  const horizontalPadding = 16;
  const itemWidth = (width - horizontalPadding * 2 - gap * (numColumns - 1)) / numColumns;

  // Conteo de sincronizados
  const syncedCount = useMemo(() => {
    if (syncedAlbumIds === null) return localAlbums.length;
    return localAlbums.filter((a) => syncedAlbumIds.includes(a.id)).length;
  }, [localAlbums, syncedAlbumIds]);

  const allAreSynced = localAlbums.length > 0 && syncedCount === localAlbums.length;

  const handleToggleSync = (album: DeviceAlbum) => {
    const currentlySynced = isAlbumSynced(album.id);
    toggleAlbumSync(album.id, allLocalIds);
    if (!currentlySynced) {
      toast.success(t.albums.syncEnabledToast(album.title));
      void scanLibrary({ forceScan: true });
    } else {
      toast.info(t.albums.syncDisabledToast(album.title));
    }
  };

  const handleToggleAllSync = () => {
    if (allAreSynced) {
      syncNoAlbums();
      toast.info(t.albums.syncNoneAction);
    } else {
      syncAllAlbums();
      toast.success(t.albums.syncAllAction);
      void scanLibrary({ forceScan: true });
    }
  };

  const handleOpenLocalAlbum = (album: DeviceAlbum) => {
    setAlbumFilter({ type: "local", albumId: album.id, title: album.title });
    toast.success(`${t.albums.viewInGallery}: ${album.title}`);
    router.push("/(tabs)");
  };

  const handleCreate = () => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    createMut.mutate(trimmed);
  };

  const onRefresh = async () => {
    await Promise.all([cloudQuery.refetch(), !isWeb ? localQuery.refetch() : Promise.resolve()]);
  };

  const showCloudSection = activeTab === "all" || activeTab === "cloud";
  const showDeviceSection = activeTab === "all" || activeTab === "device";

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top"]}>
      {/* Cabecera superior */}
      <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
        <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
          {t.albums.title}
        </Text>
        <Pressable
          onPress={() => setModalVisible(true)}
          className="flex-row items-center gap-1.5 bg-accent px-3.5 py-2 rounded-xl"
          accessibilityRole="button"
          accessibilityLabel={t.albums.createTitle}
        >
          <Plus size={18} color="#fff" />
          <Text className="text-white font-semibold text-sm">{t.albums.createAction}</Text>
        </Pressable>
      </View>

      {/* Pestañas de filtrado (Segmented Control) */}
      {!isWeb ? (
        <View className="flex-row items-center px-5 py-2.5 gap-2">
          <Pressable
            onPress={() => setActiveTab("all")}
            className={`px-3.5 py-1.5 rounded-full border ${
              activeTab === "all"
                ? "bg-accent border-accent"
                : "border-neutral-300 dark:border-neutral-700 bg-transparent"
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                activeTab === "all" ? "text-white" : "text-neutral-600 dark:text-neutral-300"
              }`}
            >
              {t.albums.tabAll}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab("cloud")}
            className={`flex-row items-center gap-1.5 px-3.5 py-1.5 rounded-full border ${
              activeTab === "cloud"
                ? "bg-accent border-accent"
                : "border-neutral-300 dark:border-neutral-700 bg-transparent"
            }`}
          >
            <Cloud size={13} color={activeTab === "cloud" ? "#fff" : "#737373"} />
            <Text
              className={`text-xs font-semibold ${
                activeTab === "cloud" ? "text-white" : "text-neutral-600 dark:text-neutral-300"
              }`}
            >
              {t.albums.tabCloud} ({cloudAlbums.length})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab("device")}
            className={`flex-row items-center gap-1.5 px-3.5 py-1.5 rounded-full border ${
              activeTab === "device"
                ? "bg-accent border-accent"
                : "border-neutral-300 dark:border-neutral-700 bg-transparent"
            }`}
          >
            <Smartphone size={13} color={activeTab === "device" ? "#fff" : "#737373"} />
            <Text
              className={`text-xs font-semibold ${
                activeTab === "device" ? "text-white" : "text-neutral-600 dark:text-neutral-300"
              }`}
            >
              {t.albums.tabDevice} ({localAlbums.length})
            </Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: horizontalPadding,
          paddingBottom: 60,
          gap: 28,
        }}
        refreshControl={
          <RefreshControl
            refreshing={cloudQuery.isRefetching || localQuery.isRefetching}
            onRefresh={onRefresh}
          />
        }
      >
        {/* SECCIÓN 1: Álbumes en la nube */}
        {showCloudSection ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Cloud size={18} color="#4f46e5" />
                <Text className="text-lg font-bold text-neutral-900 dark:text-white">
                  {t.albums.cloudAlbums}
                </Text>
                <View className="bg-neutral-200 dark:bg-neutral-800 px-2 py-0.5 rounded-full">
                  <Text className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    {cloudAlbums.length}
                  </Text>
                </View>
              </View>
            </View>

            {cloudAlbums.length === 0 && !cloudQuery.isPending ? (
              <View className="p-6 rounded-2xl bg-neutral-100 dark:bg-neutral-900/60 items-center justify-center border border-dashed border-neutral-300 dark:border-neutral-800">
                <FolderPlus size={36} color="#a3a3a3" />
                <Text className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mt-2">
                  {t.albums.empty}
                </Text>
                <Text className="text-xs text-neutral-500 text-center mt-1 mb-3">
                  {t.albums.emptyHint}
                </Text>
                <Button
                  label={t.albums.createTitle}
                  size="sm"
                  onPress={() => setModalVisible(true)}
                />
              </View>
            ) : (
              <View className="flex-row flex-wrap" style={{ gap }}>
                {cloudAlbums.map((item) => (
                  <Pressable
                    key={item.id}
                    style={{ width: itemWidth }}
                    className="gap-2"
                    onPress={() =>
                      router.push({ pathname: "/albums/[id]", params: { id: item.id } })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                  >
                    {/* Portada */}
                    <View
                      style={{ width: itemWidth, height: itemWidth }}
                      className="rounded-2xl overflow-hidden bg-neutral-200 dark:bg-neutral-800 items-center justify-center border border-neutral-200/60 dark:border-neutral-800"
                    >
                      {item.coverThumbUrl ? (
                        <Image
                          source={{ uri: item.coverThumbUrl }}
                          placeholder={
                            item.coverThumbhash ? { thumbhash: item.coverThumbhash } : undefined
                          }
                          style={{ width: "100%", height: "100%" }}
                          contentFit="cover"
                          transition={200}
                        />
                      ) : (
                        <Folder size={40} color="#a3a3a3" />
                      )}

                      {/* Badge de compartido */}
                      {item.isShared ? (
                        <View className="absolute top-2 right-2 bg-black/60 backdrop-blur-md rounded-full px-2 py-0.5 flex-row items-center gap-1">
                          <Share2 size={11} color="#fff" />
                          <Text className="text-white text-[10px] font-medium">
                            {t.albums.sharedBadge}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Título y Conteo */}
                    <View className="px-0.5">
                      <Text
                        className="text-base font-semibold text-neutral-900 dark:text-white"
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      <Text className="text-xs text-neutral-500">
                        {t.albums.itemsCount(item.mediaCount)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {/* SECCIÓN 2: Álbumes del dispositivo (solo mobile) */}
        {showDeviceSection ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Smartphone size={18} color="#059669" />
                <Text className="text-lg font-bold text-neutral-900 dark:text-white">
                  {t.albums.deviceAlbums}
                </Text>
                <View className="bg-neutral-200 dark:bg-neutral-800 px-2 py-0.5 rounded-full">
                  <Text className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    {localAlbums.length}
                  </Text>
                </View>
              </View>

              {!isWeb && localAlbums.length > 0 ? (
                <Pressable
                  onPress={handleToggleAllSync}
                  className="px-2.5 py-1 rounded-lg bg-neutral-200 dark:bg-neutral-800"
                  accessibilityRole="button"
                >
                  <Text className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    {allAreSynced ? t.albums.syncNoneAction : t.albums.syncAllAction}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {/* Subtítulo informativo del estado de sincronización */}
            {!isWeb && localAlbums.length > 0 ? (
              <Text className="text-xs text-neutral-500">
                {t.albums.syncedAlbumsCount(syncedCount, localAlbums.length)} • Toca la nube para
                activar o pausar el respaldo
              </Text>
            ) : null}

            {isWeb ? (
              <View className="p-5 rounded-2xl bg-neutral-100 dark:bg-neutral-900/60 items-center justify-center border border-neutral-200 dark:border-neutral-800">
                <Smartphone size={32} color="#a3a3a3" />
                <Text className="text-xs text-neutral-500 text-center mt-2">
                  {t.albums.deviceWebNotice}
                </Text>
              </View>
            ) : localAlbums.length === 0 && !localQuery.isPending ? (
              <View className="p-6 rounded-2xl bg-neutral-100 dark:bg-neutral-900/60 items-center justify-center border border-dashed border-neutral-300 dark:border-neutral-800">
                <Smartphone size={36} color="#a3a3a3" />
                <Text className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mt-2">
                  {t.albums.emptyDevice}
                </Text>
                <Text className="text-xs text-neutral-500 text-center mt-1">
                  {t.albums.emptyDeviceHint}
                </Text>
              </View>
            ) : (
              <View className="flex-row flex-wrap" style={{ gap }}>
                {localAlbums.map((item) => {
                  const synced = isAlbumSynced(item.id);
                  return (
                    <Pressable
                      key={item.id}
                      style={{ width: itemWidth }}
                      className="gap-2"
                      onPress={() => handleOpenLocalAlbum(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title}, ${synced ? "respaldándose" : "pausado"}`}
                    >
                      {/* Portada del álbum local */}
                      <View
                        style={{ width: itemWidth, height: itemWidth }}
                        className="rounded-2xl overflow-hidden bg-neutral-200 dark:bg-neutral-800 items-center justify-center border border-neutral-200/60 dark:border-neutral-800"
                      >
                        {item.coverUri ? (
                          <Image
                            source={{ uri: item.coverUri }}
                            style={{ width: "100%", height: "100%" }}
                            contentFit="cover"
                            transition={200}
                          />
                        ) : (
                          <Folder size={40} color="#a3a3a3" />
                        )}

                        {/* Botón interactivo de Sincronización en la portada */}
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            handleToggleSync(item);
                          }}
                          hitSlop={6}
                          accessibilityLabel={
                            synced ? t.albums.syncStatusActive : t.albums.syncStatusPaused
                          }
                          className={`absolute top-2 right-2 rounded-full px-2.5 py-1 flex-row items-center gap-1 shadow-md ${
                            synced ? "bg-emerald-600/90" : "bg-black/75"
                          }`}
                        >
                          {synced ? (
                            <>
                              <Cloud size={12} color="#fff" />
                              <Text className="text-white text-[10px] font-bold">
                                {t.albums.syncStatusActive}
                              </Text>
                            </>
                          ) : (
                            <>
                              <CloudOff size={12} color="#fca5a5" />
                              <Text className="text-neutral-300 text-[10px] font-semibold">
                                {t.albums.syncStatusPaused}
                              </Text>
                            </>
                          )}
                        </Pressable>
                      </View>

                      {/* Título y Conteo de elementos */}
                      <View className="px-0.5">
                        <Text
                          className="text-base font-semibold text-neutral-900 dark:text-white"
                          numberOfLines={1}
                        >
                          {item.title}
                        </Text>
                        <Text className="text-xs text-neutral-500">
                          {t.albums.itemsCount(item.assetCount)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>

      {/* Modal para crear nuevo álbum */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View className="flex-1 bg-black/50 justify-center items-center px-6">
          <View className="bg-white dark:bg-neutral-900 w-full max-w-sm rounded-3xl p-6 gap-4 border border-neutral-200 dark:border-neutral-800 shadow-xl">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2.5">
                <FolderPlus size={22} color="#4f46e5" />
                <Text className="text-xl font-bold text-neutral-900 dark:text-white">
                  {t.albums.createTitle}
                </Text>
              </View>
              <Pressable
                onPress={() => setModalVisible(false)}
                hitSlop={12}
                accessibilityLabel="Cerrar"
              >
                <X size={20} color="#a3a3a3" />
              </Pressable>
            </View>

            <TextInput
              className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-base text-neutral-900 dark:text-white"
              placeholder={t.albums.createPrompt}
              placeholderTextColor="#a3a3a3"
              value={newTitle}
              onChangeText={setNewTitle}
              autoFocus
              maxLength={100}
              onSubmitEditing={handleCreate}
              returnKeyType="done"
            />

            <View className="flex-row gap-2 pt-1">
              <View className="flex-1">
                <Button
                  label="Cancelar"
                  variant="ghost"
                  size="sm"
                  onPress={() => setModalVisible(false)}
                />
              </View>
              <View className="flex-1">
                <Button
                  label={t.albums.createAction}
                  size="sm"
                  onPress={handleCreate}
                  loading={createMut.isPending}
                  disabled={!newTitle.trim()}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
