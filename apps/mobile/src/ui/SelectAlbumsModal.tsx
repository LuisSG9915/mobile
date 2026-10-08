import type { AlbumItem } from "@photos/shared";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Check, Folder, Layers, Smartphone, X } from "lucide-react-native";
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { t } from "../i18n/es";
import { type DeviceAlbum, listLocalAlbums } from "../lib/local-assets";
import type { AlbumFilter } from "../lib/use-hybrid-gallery";

type Props = {
  visible: boolean;
  activeFilter: AlbumFilter | null;
  onSelect: (filter: AlbumFilter | null) => void;
  onClose: () => void;
};

export function SelectAlbumsModal({ visible, activeFilter, onSelect, onClose }: Props) {
  const isWeb = Platform.OS === "web";

  // Álbumes en la nube
  const cloudAlbumsQuery = useQuery({
    queryKey: ["albums"],
    queryFn: api.albums,
    enabled: visible,
  });

  // Álbumes locales del dispositivo (solo en nativo)
  const localAlbumsQuery = useQuery({
    queryKey: ["local-albums"],
    queryFn: listLocalAlbums,
    enabled: visible && !isWeb,
  });

  const cloudAlbums = cloudAlbumsQuery.data?.albums ?? [];
  const localAlbums = localAlbumsQuery.data ?? [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50" onPress={onClose} />
      <View className="bg-white dark:bg-neutral-900 rounded-t-3xl max-h-[75%] border-t border-neutral-200 dark:border-neutral-800">
        <SafeAreaView edges={["bottom"]}>
          {/* Encabezado */}
          <View className="flex-row items-center justify-between px-5 pt-4 pb-3 border-b border-neutral-100 dark:border-neutral-800">
            <View>
              <Text className="text-xl font-bold text-neutral-900 dark:text-white">
                {t.albums.filterByAlbum}
              </Text>
              <Text className="text-xs text-neutral-500 mt-0.5">
                Elige qué fotos y videos mostrar en el scroll
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Cerrar">
              <X size={22} color="#737373" />
            </Pressable>
          </View>

          <FlatList
            className="px-4 py-2"
            data={["ALL", "LOCAL_HEADER", ...localAlbums, "CLOUD_HEADER", ...cloudAlbums]}
            keyExtractor={(item, index) =>
              typeof item === "string" ? `${item}-${index}` : item.id
            }
            renderItem={({ item }) => {
              if (item === "ALL") {
                const isSelected = activeFilter == null;
                return (
                  <Pressable
                    onPress={() => {
                      onSelect(null);
                      onClose();
                    }}
                    className={`flex-row items-center justify-between p-3.5 my-1 rounded-2xl ${
                      isSelected
                        ? "bg-accent/10 border border-accent/30"
                        : "active:bg-neutral-100 dark:active:bg-neutral-800"
                    }`}
                  >
                    <View className="flex-row items-center gap-3">
                      <View className="w-10 h-10 rounded-xl bg-accent/20 items-center justify-center">
                        <Layers size={20} color="#4f46e5" />
                      </View>
                      <View>
                        <Text className="text-base font-semibold text-neutral-900 dark:text-white">
                          {t.albums.allAlbums}
                        </Text>
                        <Text className="text-xs text-neutral-500">
                          Todo tu carrete y fotos sincronizadas
                        </Text>
                      </View>
                    </View>
                    {isSelected ? <Check size={18} color="#4f46e5" /> : null}
                  </Pressable>
                );
              }

              if (item === "LOCAL_HEADER") {
                if (isWeb || localAlbums.length === 0) return null;
                return (
                  <View className="flex-row items-center gap-2 mt-4 mb-1.5 px-2">
                    <Smartphone size={15} color="#737373" />
                    <Text className="text-xs font-bold text-neutral-500 uppercase tracking-wider">
                      {t.albums.deviceAlbums}
                    </Text>
                  </View>
                );
              }

              if (item === "CLOUD_HEADER") {
                if (cloudAlbums.length === 0) return null;
                return (
                  <View className="flex-row items-center gap-2 mt-4 mb-1.5 px-2">
                    <Folder size={15} color="#737373" />
                    <Text className="text-xs font-bold text-neutral-500 uppercase tracking-wider">
                      {t.albums.cloudAlbums}
                    </Text>
                  </View>
                );
              }

              // Álbum local
              if (
                typeof item === "object" &&
                item !== null &&
                "assetCount" in item &&
                !("mediaCount" in item)
              ) {
                const local = item as DeviceAlbum;
                const isSelected =
                  activeFilter?.type === "local" && activeFilter.albumId === local.id;
                return (
                  <Pressable
                    onPress={() => {
                      onSelect({ type: "local", albumId: local.id, title: local.title });
                      onClose();
                    }}
                    className={`flex-row items-center justify-between p-3 my-0.5 rounded-2xl ${
                      isSelected
                        ? "bg-accent/10 border border-accent/30"
                        : "active:bg-neutral-100 dark:active:bg-neutral-800"
                    }`}
                  >
                    <View className="flex-row items-center gap-3 flex-1">
                      <View className="w-10 h-10 rounded-xl bg-neutral-200 dark:bg-neutral-800 items-center justify-center">
                        <Folder size={20} color="#737373" />
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-base font-medium text-neutral-900 dark:text-white"
                          numberOfLines={1}
                        >
                          {local.title}
                        </Text>
                        <Text className="text-xs text-neutral-500">
                          {t.albums.itemsCount(local.assetCount)}
                        </Text>
                      </View>
                    </View>
                    {isSelected ? <Check size={18} color="#4f46e5" /> : null}
                  </Pressable>
                );
              }

              // Álbum en la nube
              if (typeof item === "object" && item !== null && "mediaCount" in item) {
                const cloud = item as AlbumItem;
                const isSelected =
                  activeFilter?.type === "remote" && activeFilter.albumId === cloud.id;
                return (
                  <Pressable
                    onPress={() => {
                      onSelect({ type: "remote", albumId: cloud.id, title: cloud.title });
                      onClose();
                    }}
                    className={`flex-row items-center justify-between p-3 my-0.5 rounded-2xl ${
                      isSelected
                        ? "bg-accent/10 border border-accent/30"
                        : "active:bg-neutral-100 dark:active:bg-neutral-800"
                    }`}
                  >
                    <View className="flex-row items-center gap-3 flex-1">
                      <View className="w-10 h-10 rounded-xl bg-neutral-200 dark:bg-neutral-800 overflow-hidden items-center justify-center">
                        {cloud.coverThumbUrl ? (
                          <Image
                            source={{ uri: cloud.coverThumbUrl }}
                            placeholder={
                              cloud.coverThumbhash ? { thumbhash: cloud.coverThumbhash } : undefined
                            }
                            style={{ width: "100%", height: "100%" }}
                            contentFit="cover"
                          />
                        ) : (
                          <Folder size={20} color="#737373" />
                        )}
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-base font-medium text-neutral-900 dark:text-white"
                          numberOfLines={1}
                        >
                          {cloud.title}
                        </Text>
                        <Text className="text-xs text-neutral-500">
                          {t.albums.itemsCount(cloud.mediaCount)}
                        </Text>
                      </View>
                    </View>
                    {isSelected ? <Check size={18} color="#4f46e5" /> : null}
                  </Pressable>
                );
              }

              return null;
            }}
            ListFooterComponent={
              cloudAlbumsQuery.isPending || localAlbumsQuery.isPending ? (
                <View className="py-6 items-center">
                  <ActivityIndicator color="#4f46e5" />
                </View>
              ) : null
            }
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}
