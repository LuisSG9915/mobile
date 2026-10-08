import type { SearchFilter, TimelineItem } from "@photos/shared";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { ChevronLeft, Play, Search, Tag, X } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { t } from "../i18n/es";
import { formatDuration } from "../lib/format";
import { EmptyState } from "../ui";

const FILTER_TYPES: { key: SearchFilter; label: string }[] = [
  { key: "all", label: t.search.all },
  { key: "photos", label: t.search.photos },
  { key: "videos", label: t.search.videos },
  { key: "favorites", label: t.search.favorites },
];

export default function SearchScreen() {
  const { width } = useWindowDimensions();
  const [searchText, setSearchText] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<SearchFilter>("all");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<"all" | "10mb" | "50mb">("all");

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: api.tags,
  });

  const minBytes =
    selectedSize === "10mb" ? 10_000_000 : selectedSize === "50mb" ? 50_000_000 : undefined;

  const searchQuery = useQuery({
    queryKey: ["search", searchText, selectedFilter, selectedTag, selectedSize],
    queryFn: () =>
      api.search({
        q: searchText.trim() || undefined,
        tag: selectedTag || undefined,
        filter: selectedFilter,
        minBytes,
        limit: 100,
      }),
  });

  const numColumns = width > 768 ? 5 : 3;
  const gap = 3;
  const itemSize = (width - gap * (numColumns - 1)) / numColumns;

  const results = searchQuery.data?.items ?? [];
  const totalMatches = searchQuery.data?.totalMatches ?? 0;
  const availableTags = tagsQuery.data?.tags ?? [];

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top", "bottom"]}>
      {/* Barra de búsqueda */}
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-neutral-200/50 dark:border-neutral-900">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityLabel="Volver"
          className="p-1 rounded-full active:bg-neutral-200 dark:active:bg-neutral-800"
        >
          <ChevronLeft size={26} color="#737373" />
        </Pressable>

        <View className="flex-1 flex-row items-center bg-neutral-200/70 dark:bg-neutral-800 rounded-2xl px-3 py-2 gap-2">
          <Search size={18} color="#737373" />
          <TextInput
            className="flex-1 text-base text-neutral-900 dark:text-white py-0"
            placeholder={t.search.placeholder}
            placeholderTextColor="#737373"
            value={searchText}
            onChangeText={setSearchText}
            autoFocus
            returnKeyType="search"
          />
          {searchText.length > 0 ? (
            <Pressable
              onPress={() => setSearchText("")}
              hitSlop={8}
              accessibilityLabel="Limpiar texto"
            >
              <X size={16} color="#737373" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Filtros de Tipo y Tamaño */}
      <View className="py-2.5 border-b border-neutral-100 dark:border-neutral-900">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="px-3 gap-2"
        >
          {FILTER_TYPES.map(({ key, label }) => {
            const isSelected = selectedFilter === key;
            return (
              <Pressable
                key={key}
                onPress={() => setSelectedFilter(key)}
                className={`px-3 py-1.5 rounded-full border ${
                  isSelected
                    ? "bg-accent border-accent"
                    : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    isSelected ? "text-white" : "text-neutral-700 dark:text-neutral-300"
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}

          <View className="w-px h-5 bg-neutral-300 dark:bg-neutral-700 self-center mx-1" />

          {/* Filtro por tamaño */}
          <Pressable
            onPress={() => setSelectedSize((prev) => (prev === "10mb" ? "all" : "10mb"))}
            className={`px-3 py-1.5 rounded-full border ${
              selectedSize === "10mb"
                ? "bg-accent border-accent"
                : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                selectedSize === "10mb" ? "text-white" : "text-neutral-700 dark:text-neutral-300"
              }`}
            >
              {t.search.moreThan10MB}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSelectedSize((prev) => (prev === "50mb" ? "all" : "50mb"))}
            className={`px-3 py-1.5 rounded-full border ${
              selectedSize === "50mb"
                ? "bg-accent border-accent"
                : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                selectedSize === "50mb" ? "text-white" : "text-neutral-700 dark:text-neutral-300"
              }`}
            >
              {t.search.moreThan50MB}
            </Text>
          </Pressable>
        </ScrollView>

        {/* Fila de etiquetas del usuario si existen */}
        {availableTags.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="px-3 gap-1.5 pt-2"
          >
            <View className="flex-row items-center mr-1">
              <Tag size={13} color="#737373" />
            </View>
            {availableTags.map(({ tag, count }) => {
              const isSelected = selectedTag === tag;
              return (
                <Pressable
                  key={tag}
                  onPress={() => setSelectedTag((prev) => (prev === tag ? null : tag))}
                  className={`px-2.5 py-1 rounded-lg border ${
                    isSelected
                      ? "bg-accent/20 border-accent"
                      : "border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-850"
                  }`}
                >
                  <Text
                    className={`text-xs font-medium ${
                      isSelected
                        ? "text-accent font-bold"
                        : "text-neutral-600 dark:text-neutral-400"
                    }`}
                  >
                    #{tag} ({count})
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {/* Resultados de búsqueda */}
      {searchQuery.isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      ) : results.length === 0 ? (
        <View className="flex-1 justify-center px-6">
          <EmptyState
            title={t.search.emptyTitle}
            body={t.search.emptyBody}
            actionLabel={t.search.clear}
            action={() => {
              setSearchText("");
              setSelectedFilter("all");
              setSelectedTag(null);
              setSelectedSize("all");
            }}
          />
        </View>
      ) : (
        <View className="flex-1">
          <View className="px-3 py-1.5 flex-row justify-between items-center">
            <Text className="text-xs font-medium text-neutral-500">
              {t.search.resultsCount(totalMatches)}
            </Text>
            {selectedTag ? (
              <Pressable
                onPress={() => setSelectedTag(null)}
                className="flex-row items-center gap-1"
              >
                <Text className="text-xs text-accent">Quitar etiqueta #{selectedTag}</Text>
                <X size={12} color="#4f46e5" />
              </Pressable>
            ) : null}
          </View>

          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            numColumns={numColumns}
            key={numColumns}
            renderItem={({ item }: { item: TimelineItem }) => (
              <Pressable
                style={{ width: itemSize, height: itemSize, margin: gap / 2 }}
                onPress={() => router.push({ pathname: "/media/[id]", params: { id: item.id } })}
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
              </Pressable>
            )}
          />
        </View>
      )}
    </SafeAreaView>
  );
}
