import type { AlbumItem } from "@photos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Folder, FolderPlus, Plus, X } from "lucide-react-native";
import { useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import { api } from "../api/client";
import { t } from "../i18n/es";
import { Button } from "./index";

export function AddToAlbumModal({
  visible,
  mediaIds,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  mediaIds: string[];
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const query = useQuery({
    queryKey: ["albums"],
    queryFn: api.albums,
    enabled: visible,
  });

  const addMut = useMutation({
    mutationFn: (albumId: string) => api.addAlbumMedia(albumId, mediaIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["albums"] });
      toast.success(t.albums.photosAdded(mediaIds.length));
      onClose();
      onSuccess?.();
    },
    onError: (err: Error) => toast.error(err.message || t.auth.genericError),
  });

  const createMut = useMutation({
    mutationFn: (title: string) => api.createAlbum({ title, mediaIds }),
    onSuccess: (newAlbum) => {
      void qc.invalidateQueries({ queryKey: ["albums"] });
      toast.success(`Creado álbum "${newAlbum.title}" con ${mediaIds.length} elementos`);
      setCreating(false);
      setNewTitle("");
      onClose();
      onSuccess?.();
    },
    onError: (err: Error) => toast.error(err.message || t.auth.genericError),
  });

  const albums = query.data?.albums ?? [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 justify-center items-center px-4">
        <View className="bg-white dark:bg-neutral-900 w-full max-w-md max-h-[80%] rounded-3xl p-5 gap-3 border border-neutral-200 dark:border-neutral-800 shadow-2xl">
          {/* Header */}
          <View className="flex-row items-center justify-between pb-1 border-b border-neutral-100 dark:border-neutral-800">
            <View className="flex-row items-center gap-2">
              <FolderPlus size={20} color="#4f46e5" />
              <Text className="text-lg font-bold text-neutral-900 dark:text-white">
                {t.albums.addToAlbum}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Cerrar">
              <X size={20} color="#a3a3a3" />
            </Pressable>
          </View>

          {/* Formulario nuevo álbum o lista existente */}
          {creating ? (
            <View className="gap-3 py-2">
              <Text className="text-sm text-neutral-500">
                Escribe un nombre para el nuevo álbum:
              </Text>
              <TextInput
                className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 text-base text-neutral-900 dark:text-white"
                placeholder={t.albums.createPrompt}
                placeholderTextColor="#a3a3a3"
                value={newTitle}
                onChangeText={setNewTitle}
                autoFocus
                maxLength={100}
              />
              <View className="flex-row gap-2 pt-2">
                <View className="flex-1">
                  <Button
                    label="Cancelar"
                    variant="ghost"
                    size="sm"
                    onPress={() => setCreating(false)}
                  />
                </View>
                <View className="flex-1">
                  <Button
                    label="Crear y añadir"
                    size="sm"
                    onPress={() => {
                      const trimmed = newTitle.trim();
                      if (trimmed) createMut.mutate(trimmed);
                    }}
                    loading={createMut.isPending}
                    disabled={!newTitle.trim()}
                  />
                </View>
              </View>
            </View>
          ) : (
            <>
              {/* Botón para crear álbum rápido */}
              <Pressable
                onPress={() => setCreating(true)}
                className="flex-row items-center gap-3 p-3 bg-neutral-100 dark:bg-neutral-800 rounded-2xl active:opacity-75"
              >
                <View className="w-10 h-10 rounded-xl bg-accent/10 items-center justify-center">
                  <Plus size={20} color="#4f46e5" />
                </View>
                <Text className="text-base font-semibold text-accent flex-1">
                  + {t.albums.createTitle}
                </Text>
              </Pressable>

              {/* Lista de álbumes */}
              <FlatList
                data={albums}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
                ListEmptyComponent={
                  <Text className="text-sm text-neutral-500 text-center py-6">
                    Aún no tienes álbumes creados.
                  </Text>
                }
                renderItem={({ item }: { item: AlbumItem }) => (
                  <Pressable
                    onPress={() => addMut.mutate(item.id)}
                    disabled={addMut.isPending}
                    className="flex-row items-center gap-3 p-2.5 rounded-2xl active:bg-neutral-100 dark:active:bg-neutral-800"
                  >
                    <View className="w-12 h-12 rounded-xl bg-neutral-200 dark:bg-neutral-800 overflow-hidden items-center justify-center">
                      {item.coverThumbUrl ? (
                        <Image
                          source={{ uri: item.coverThumbUrl }}
                          placeholder={
                            item.coverThumbhash ? { thumbhash: item.coverThumbhash } : undefined
                          }
                          style={{ width: "100%", height: "100%" }}
                          contentFit="cover"
                        />
                      ) : (
                        <Folder size={24} color="#a3a3a3" />
                      )}
                    </View>
                    <View className="flex-1">
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
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
