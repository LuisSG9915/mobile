import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Check, ChevronLeft, Sparkles, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../api/client";
import { t } from "../i18n/es";
import { Button, EmptyState } from "../ui";

export default function CleanerScreen() {
  const qc = useQueryClient();
  const { width } = useWindowDimensions();

  const query = useQuery({
    queryKey: ["cleaner-bursts"],
    queryFn: api.cleanerBursts,
  });

  const [selectedForTrash, setSelectedForTrash] = useState<Set<string>>(new Set());

  // Al cargar o cambiar los clusters, pre-seleccionamos todos los duplicados excepto el primero de cada ráfaga
  useEffect(() => {
    if (!query.data?.clusters) return;
    const initialTrash = new Set<string>();
    for (const cluster of query.data.clusters) {
      // Dejamos el primer elemento como conservado, los demás preseleccionados para limpieza
      for (let i = 1; i < cluster.items.length; i++) {
        initialTrash.add(cluster.items[i].id);
      }
    }
    setSelectedForTrash(initialTrash);
  }, [query.data]);

  const cleanupMut = useMutation({
    mutationFn: (deleteIds: string[]) => api.cleanerCleanup({ deleteIds }),
    onSuccess: (data) => {
      toast.success(t.cleaner.cleanSuccess(data.trashedCount));
      void qc.invalidateQueries({ queryKey: ["cleaner-bursts"] });
      void qc.invalidateQueries({ queryKey: ["timeline"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["user-storage"] });
    },
    onError: (err: Error) => toast.error(err.message || t.auth.genericError),
  });

  const toggleItem = (id: string) => {
    setSelectedForTrash((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClean = () => {
    const toDelete = Array.from(selectedForTrash);
    if (toDelete.length === 0) return;

    const confirmMsg = `¿Mover ${toDelete.length} fotos a la papelera? Podrás recuperarlas durante 30 días.`;
    if (Platform.OS === "web") {
      if (window.confirm(confirmMsg)) {
        cleanupMut.mutate(toDelete);
      }
    } else {
      Alert.alert(t.cleaner.cleanAction, confirmMsg, [
        { text: "Cancelar", style: "cancel" },
        {
          text: t.cleaner.cleanAction,
          style: "destructive",
          onPress: () => cleanupMut.mutate(toDelete),
        },
      ]);
    }
  };

  const clusters = query.data?.clusters ?? [];
  const totalPhotos = query.data?.totalPhotos ?? 0;

  // Tamaño de las miniaturas en la cuadrícula horizontal
  const thumbSize = Math.min(180, (width - 48) / 2.5);

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top", "bottom"]}>
      {/* Encabezado */}
      <View className="flex-row items-center gap-2 px-4 py-3 border-b border-neutral-200/50 dark:border-neutral-900">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityLabel="Volver"
          className="p-1 rounded-full active:bg-neutral-200 dark:active:bg-neutral-800"
        >
          <ChevronLeft size={26} color="#737373" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-xl font-bold text-neutral-900 dark:text-white">
            {t.cleaner.title}
          </Text>
          <Text className="text-xs text-neutral-500">{t.cleaner.subtitle}</Text>
        </View>
      </View>

      {clusters.length === 0 && !query.isLoading ? (
        <EmptyState
          title={t.cleaner.emptyTitle}
          body={t.cleaner.emptyBody}
          actionLabel="Volver a fotos"
          action={() => router.back()}
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
            />
          }
        >
          {/* Banner de resumen */}
          {clusters.length > 0 ? (
            <View className="m-4 p-4 rounded-2xl bg-accent/10 border border-accent/20 flex-row items-center gap-3">
              <View className="w-10 h-10 rounded-full bg-accent/20 items-center justify-center">
                <Sparkles size={20} color="#6366f1" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-neutral-900 dark:text-white">
                  {clusters.length === 1
                    ? "1 grupo de fotos detectado"
                    : `${clusters.length} grupos de fotos detectados`}
                </Text>
                <Text className="text-xs text-neutral-500">
                  {`${totalPhotos} fotos en total. Revisa cuáles quieres conservar.`}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Lista de grupos/clusters */}
          {clusters.map((cluster) => {
            const dateStr = cluster.dateGroup;
            return (
              <View
                key={cluster.id}
                className="mb-6 mx-4 p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800"
              >
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-sm font-bold text-neutral-800 dark:text-neutral-200">
                    {t.cleaner.groupTitle(cluster.items.length, dateStr)}
                  </Text>
                </View>

                {/* Fila horizontal de fotos del cluster */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10 }}
                >
                  {cluster.items.map((item, idx) => {
                    const isTrashed = selectedForTrash.has(item.id);
                    const isSuggestedKeep = idx === 0 && !isTrashed;

                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => toggleItem(item.id)}
                        className={`relative rounded-xl overflow-hidden border-2 ${
                          isTrashed
                            ? "border-red-500 opacity-60"
                            : isSuggestedKeep
                              ? "border-emerald-500"
                              : "border-transparent"
                        }`}
                        style={{ width: thumbSize, height: thumbSize * 1.25 }}
                      >
                        <Image
                          source={{ uri: item.thumbUrl }}
                          placeholder={item.thumbhash ? { thumbhash: item.thumbhash } : undefined}
                          contentFit="cover"
                          style={{ width: "100%", height: "100%" }}
                        />

                        {/* Badge de sugerida para conservar */}
                        {isSuggestedKeep ? (
                          <View className="absolute top-2 left-2 bg-emerald-600/90 rounded-md px-1.5 py-0.5 flex-row items-center gap-1">
                            <Check size={12} color="#fff" />
                            <Text className="text-[10px] font-semibold text-white">Conservar</Text>
                          </View>
                        ) : null}

                        {/* Badge o selector de papelera */}
                        <View
                          className={`absolute bottom-2 right-2 rounded-full p-1.5 ${
                            isTrashed ? "bg-red-500" : "bg-black/50 border border-white/50"
                          }`}
                        >
                          <Trash2 size={14} color="#fff" />
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Barra de acción inferior flotante */}
      {selectedForTrash.size > 0 ? (
        <View className="absolute bottom-0 left-0 right-0 p-4 bg-white/95 dark:bg-neutral-900/95 border-t border-neutral-200 dark:border-neutral-800 flex-row items-center justify-between">
          <View>
            <Text className="text-sm font-semibold text-neutral-900 dark:text-white">
              {t.cleaner.selectedForTrash(selectedForTrash.size)}
            </Text>
            <Text className="text-xs text-neutral-500">Liberarás espacio en tu nube</Text>
          </View>
          <Button
            variant="danger"
            label={t.cleaner.cleanAction}
            loading={cleanupMut.isPending}
            onPress={handleClean}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
