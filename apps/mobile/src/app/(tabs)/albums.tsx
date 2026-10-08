import type { AlbumItem } from "@photos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Folder, FolderPlus, Plus, Share2, X } from "lucide-react-native";
import { useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../../api/client";
import { t } from "../../i18n/es";
import { Button, EmptyState } from "../../ui";

export default function AlbumsScreen() {
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const [modalVisible, setModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const query = useQuery({
    queryKey: ["albums"],
    queryFn: api.albums,
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

  const albums = query.data?.albums ?? [];
  const numColumns = width > 768 ? 4 : 2;
  const gap = 14;
  const horizontalPadding = 16;
  const itemWidth = (width - horizontalPadding * 2 - gap * (numColumns - 1)) / numColumns;

  const handleCreate = () => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    createMut.mutate(trimmed);
  };

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top"]}>
      {/* Cabecera */}
      <View className="flex-row items-center justify-between px-5 py-4">
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

      {/* Lista o Empty State */}
      {albums.length === 0 && !query.isPending ? (
        <View className="flex-1 justify-center px-6">
          <EmptyState
            title={t.albums.empty}
            body={t.albums.emptyHint}
            actionLabel={t.albums.createTitle}
            action={() => setModalVisible(true)}
          />
        </View>
      ) : (
        <FlatList
          data={albums}
          keyExtractor={(item) => item.id}
          numColumns={numColumns}
          key={numColumns} // Recrea layout al cambiar orientación/pantalla
          contentContainerStyle={{
            paddingHorizontal: horizontalPadding,
            paddingBottom: 40,
            gap,
          }}
          columnWrapperStyle={{ gap }}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />
          }
          renderItem={({ item }: { item: AlbumItem }) => (
            <Pressable
              style={{ width: itemWidth }}
              className="gap-2"
              onPress={() => router.push({ pathname: "/albums/[id]", params: { id: item.id } })}
              accessibilityRole="button"
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
          )}
        />
      )}

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
