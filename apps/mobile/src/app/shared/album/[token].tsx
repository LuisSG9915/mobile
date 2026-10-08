import type { PublicAlbumItem } from "@photos/shared";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { Download, Play, Share2, X } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../../api/client";
import { t } from "../../../i18n/es";
import { formatDuration } from "../../../lib/format";
import { EmptyState } from "../../../ui";

export default function SharedAlbumScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const shareToken = typeof token === "string" ? token : "";
  const { width } = useWindowDimensions();
  const [selectedPhoto, setSelectedPhoto] = useState<PublicAlbumItem | null>(null);

  const query = useQuery({
    queryKey: ["public-album", shareToken],
    queryFn: () => api.publicSharedAlbum(shareToken),
    enabled: Boolean(shareToken),
  });

  const album = query.data;

  const numColumns = width > 1024 ? 5 : width > 640 ? 4 : 3;
  const gap = 4;
  const itemSize = (width - gap * (numColumns - 1)) / numColumns;

  if (query.isPending) {
    return (
      <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black items-center justify-center">
        <ActivityIndicator size="large" color="#4f46e5" />
      </SafeAreaView>
    );
  }

  if (query.isError || !album) {
    return (
      <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black items-center justify-center px-6">
        <EmptyState
          title="Álbum no disponible"
          body="Este enlace ha expirado, ha sido revocado o la dirección no es válida."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top", "bottom"]}>
      {/* Cabecera pública */}
      <View className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-850 flex-row items-center justify-between">
        <View className="flex-1">
          <View className="flex-row items-center gap-2 mb-1">
            <Share2 size={16} color="#4f46e5" />
            <Text className="text-xs uppercase font-semibold text-accent tracking-wider">
              {t.albums.publicViewTitle}
            </Text>
          </View>
          <Text className="text-2xl font-bold text-neutral-900 dark:text-white" numberOfLines={1}>
            {album.title}
          </Text>
          <Text className="text-xs text-neutral-500 mt-0.5">
            {t.albums.itemsCount(album.mediaCount)}
          </Text>
        </View>
      </View>

      {/* Grid de fotos */}
      <FlatList
        data={album.items}
        keyExtractor={(item) => item.id}
        numColumns={numColumns}
        key={numColumns}
        renderItem={({ item }: { item: PublicAlbumItem }) => (
          <Pressable
            style={{ width: itemSize, height: itemSize, margin: gap / 2 }}
            onPress={() => setSelectedPhoto(item)}
            className="bg-neutral-200 dark:bg-neutral-900 overflow-hidden"
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
          </Pressable>
        )}
      />

      {/* Visor Modal de foto seleccionada */}
      <Modal
        visible={selectedPhoto !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <SafeAreaView className="flex-1 bg-black justify-between" edges={["top", "bottom"]}>
          {/* Botones superiores del visor */}
          <View className="flex-row justify-between items-center px-4 py-3 z-10">
            <Pressable
              onPress={() => setSelectedPhoto(null)}
              hitSlop={12}
              className="p-1 rounded-full bg-white/10"
              accessibilityLabel="Cerrar"
            >
              <X size={24} color="#fff" />
            </Pressable>

            {selectedPhoto ? (
              <Pressable
                onPress={() => {
                  if (Platform.OS === "web") {
                    window.open(selectedPhoto.originalUrl, "_blank");
                  }
                }}
                hitSlop={12}
                className="flex-row items-center gap-2 bg-white/20 px-3.5 py-1.5 rounded-full"
                accessibilityLabel="Descargar original"
              >
                <Download size={16} color="#fff" />
                <Text className="text-white text-xs font-semibold">Descargar</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Imagen a pantalla completa */}
          <View className="flex-1 items-center justify-center">
            {selectedPhoto ? (
              <Image
                source={{ uri: selectedPhoto.originalUrl }}
                placeholder={{ thumbhash: selectedPhoto.thumbhash }}
                style={{ width: "100%", height: "100%" }}
                contentFit="contain"
              />
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
