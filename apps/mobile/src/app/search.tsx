import type { SearchFilter, TimelineItem } from "@photos/shared";
import { FlashList } from "@shopify/flash-list";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import {
  Calendar,
  ChevronLeft,
  Heart,
  Images,
  MapPin,
  Play,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react-native";
import { type ReactNode, useState } from "react";
import {
  ActivityIndicator,
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
import { isExploreZeroQueryState } from "../lib/story-player";
import { useDebouncedValue } from "../lib/use-debounced-value";
import { EmptyState } from "../ui";

const FILTER_TYPES: { key: SearchFilter; label: string }[] = [
  { key: "all", label: t.search.all },
  { key: "photos", label: t.search.photos },
  { key: "videos", label: t.search.videos },
  { key: "favorites", label: t.search.favorites },
  { key: "screenshots", label: t.search.screenshots },
  { key: "documents", label: t.search.documents },
];

function ExploreCard({
  icon,
  title,
  subtitle,
  onPress,
  width,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  onPress: () => void;
  width: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ width }}
      className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5 gap-2 active:opacity-80"
      accessibilityRole="button"
    >
      {icon}
      <Text className="text-sm font-semibold text-neutral-900 dark:text-white">{title}</Text>
      {subtitle ? (
        <Text className="text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ExploreHub({
  width,
  places,
  tags,
  onCity,
  onTag,
  onFilter,
  onDateRange,
}: {
  width: number;
  places: { city: string; count: number }[];
  tags: { tag: string; count: number }[];
  onCity: (city: string) => void;
  onTag: (tag: string) => void;
  onFilter: (filter: SearchFilter) => void;
  onDateRange: (range: "week" | "month") => void;
}) {
  const cardWidth = Math.max(140, (width - 44) / 2);
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, gap: 24 }}
      showsVerticalScrollIndicator={false}
    >
      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-base font-bold text-neutral-900 dark:text-white">
            {t.search.places}
          </Text>
          <Pressable
            onPress={() => router.push("/map")}
            hitSlop={8}
            className="flex-row items-center gap-1"
          >
            <MapPin size={14} color="#4f46e5" />
            <Text className="text-xs font-semibold text-accent">{t.search.openMap}</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10 }}
        >
          <Pressable
            onPress={() => router.push("/map")}
            className="w-36 h-28 rounded-2xl bg-accent/10 border border-accent/20 p-3 justify-between active:opacity-80"
          >
            <MapPin size={20} color="#4f46e5" />
            <Text className="text-sm font-semibold text-accent">{t.search.openMap}</Text>
          </Pressable>
          {places.map(({ city, count }) => (
            <Pressable
              key={city}
              onPress={() => onCity(city)}
              className="w-36 h-28 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-3 justify-between active:opacity-80"
            >
              <Text
                className="text-sm font-semibold text-neutral-900 dark:text-white"
                numberOfLines={1}
              >
                {city}
              </Text>
              <Text className="text-xs text-neutral-500">{t.search.cityCount(count)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {tags.length > 0 ? (
        <View className="gap-3">
          <Text className="text-base font-bold text-neutral-900 dark:text-white">
            {t.search.aiTags}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {tags.map(({ tag, count }) => (
              <Pressable
                key={tag}
                onPress={() => onTag(tag)}
                className="flex-row items-center gap-1 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-800/60 active:opacity-80"
              >
                <Tag size={12} color="#6366f1" />
                <Text className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
                  #{tag} ({count})
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View className="gap-3">
        <Text className="text-base font-bold text-neutral-900 dark:text-white">
          {t.search.categories}
        </Text>
        <View className="flex-row flex-wrap gap-3">
          <ExploreCard
            icon={<Heart size={20} color="#f43f5e" />}
            title={t.search.favorites}
            onPress={() => onFilter("favorites")}
            width={cardWidth}
          />
          <ExploreCard
            icon={<Play size={20} color="#4f46e5" />}
            title={t.search.videos}
            onPress={() => onFilter("videos")}
            width={cardWidth}
          />
          <ExploreCard
            icon={<Images size={20} color="#4f46e5" />}
            title={t.search.photos}
            onPress={() => onFilter("photos")}
            width={cardWidth}
          />
          <ExploreCard
            icon={<Calendar size={20} color="#4f46e5" />}
            title={t.search.thisMonth}
            onPress={() => onDateRange("month")}
            width={cardWidth}
          />
        </View>
        <Pressable onPress={() => onDateRange("week")} className="self-start py-1">
          <Text className="text-xs font-semibold text-accent">{t.search.lastWeek}</Text>
        </Pressable>
      </View>

      <View className="gap-3">
        <Text className="text-base font-bold text-neutral-900 dark:text-white">
          {t.search.utilities}
        </Text>
        <Pressable
          onPress={() => router.push("/cleaner")}
          className="flex-row items-center gap-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3.5 active:opacity-80"
        >
          <Sparkles size={20} color="#6366f1" />
          <View className="flex-1">
            <Text className="text-sm font-semibold text-neutral-900 dark:text-white">
              {t.search.cleaner}
            </Text>
            <Text className="text-xs text-neutral-500">{t.search.cleanerHint}</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => router.push("/trash")}
          className="flex-row items-center gap-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3.5 active:opacity-80"
        >
          <Trash2 size={20} color="#737373" />
          <View className="flex-1">
            <Text className="text-sm font-semibold text-neutral-900 dark:text-white">
              {t.search.trash}
            </Text>
            <Text className="text-xs text-neutral-500">{t.search.trashHint}</Text>
          </View>
        </Pressable>
      </View>
    </ScrollView>
  );
}

export default function SearchScreen() {
  const { width } = useWindowDimensions();
  const [searchText, setSearchText] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<SearchFilter>("all");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<"all" | "10mb" | "50mb">("all");
  const [dateRange, setDateRange] = useState<"all" | "week" | "month">("all");
  const debouncedSearchText = useDebouncedValue(searchText, 250);

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: api.tags,
  });

  const placesQuery = useQuery({
    queryKey: ["places"],
    queryFn: api.places,
  });

  const minBytes =
    selectedSize === "10mb" ? 10_000_000 : selectedSize === "50mb" ? 50_000_000 : undefined;
  const daysAgo = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const dateFrom =
    dateRange === "week" ? daysAgo(7) : dateRange === "month" ? daysAgo(30) : undefined;
  const showExploreHub =
    selectedSize === "all" &&
    isExploreZeroQueryState({
      debouncedSearch: debouncedSearchText,
      selectedMediaType: selectedFilter === "all" ? null : selectedFilter,
      selectedTag,
      selectedCountry: null,
      selectedCity,
      dateRange,
    });

  const searchQuery = useInfiniteQuery({
    queryKey: [
      "search",
      debouncedSearchText,
      selectedFilter,
      selectedTag,
      selectedCity,
      selectedSize,
      dateRange,
    ],
    queryFn: ({ pageParam }) =>
      api.search({
        q: debouncedSearchText.trim() || undefined,
        tag: selectedTag || undefined,
        filter: selectedFilter,
        dateFrom,
        minBytes,
        cursor: pageParam,
        limit: 60,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled: !showExploreHub,
  });

  const numColumns = width > 768 ? 5 : 3;
  const gap = 3;
  const itemSize = (width - gap * (numColumns - 1)) / numColumns;

  const results = searchQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const totalMatches = searchQuery.data?.pages[0]?.totalMatches ?? 0;
  const availableTags = tagsQuery.data?.tags ?? [];
  const availablePlaces = placesQuery.data?.places ?? [];

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
            onChangeText={(value) => {
              setSearchText(value);
              setSelectedCity(null);
            }}
            returnKeyType="search"
          />
          {searchQuery.isFetching ? <ActivityIndicator size="small" color="#4f46e5" /> : null}
          {searchText.length > 0 ? (
            <Pressable
              onPress={() => {
                setSearchText("");
                setSelectedCity(null);
              }}
              hitSlop={8}
              accessibilityLabel="Limpiar texto"
            >
              <X size={16} color="#737373" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Filtros de Tipo y Tamaño */}
      {showExploreHub ? null : (
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

            {dateRange !== "all" ? (
              <Pressable
                onPress={() => setDateRange("all")}
                className="px-3 py-1.5 rounded-full border bg-accent/10 border-accent/30 flex-row items-center gap-1"
              >
                <Text className="text-xs font-semibold text-accent">
                  {dateRange === "month" ? t.search.thisMonth : t.search.lastWeek}
                </Text>
                <X size={12} color="#4f46e5" />
              </Pressable>
            ) : null}
          </ScrollView>

          {/* Fila de lugares si existen */}
          {availablePlaces.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="px-3 gap-1.5 pt-2"
            >
              <View className="flex-row items-center mr-1">
                <MapPin size={13} color="#4f46e5" />
              </View>
              {availablePlaces.map(({ city, count }) => {
                const isSelected = selectedCity === city;
                return (
                  <Pressable
                    key={city}
                    onPress={() => {
                      const next = selectedCity === city ? null : city;
                      setSelectedCity(next);
                      setSearchText(next ?? "");
                    }}
                    className={`px-2.5 py-1 rounded-lg border flex-row items-center gap-1 ${
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
                      📍 {city} ({count})
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

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
      )}

      {/* Resultados de búsqueda */}
      {showExploreHub ? (
        <ExploreHub
          width={width}
          places={availablePlaces}
          tags={availableTags}
          onCity={(city) => {
            setSelectedCity(city);
            setSearchText(city);
          }}
          onTag={(tag) => setSelectedTag(tag)}
          onFilter={(filter) => setSelectedFilter(filter)}
          onDateRange={(range) => setDateRange(range)}
        />
      ) : searchQuery.isPending ? (
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
              setSelectedCity(null);
              setSelectedSize("all");
              setDateRange("all");
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

          <FlashList
            data={results}
            keyExtractor={(item) => item.id}
            numColumns={numColumns}
            key={numColumns}
            onEndReached={() => {
              if (searchQuery.hasNextPage && !searchQuery.isFetchingNextPage) {
                void searchQuery.fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.6}
            ListFooterComponent={
              searchQuery.isFetchingNextPage ? (
                <View className="py-4 items-center">
                  <ActivityIndicator color="#4f46e5" />
                </View>
              ) : null
            }
            renderItem={({ item }: { item: TimelineItem }) => (
              <Pressable
                style={{ width: itemSize, height: itemSize, margin: gap / 2 }}
                onPress={() =>
                  router.push({
                    pathname: "/media/[id]",
                    params: {
                      id: item.id,
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
        </View>
      )}
    </SafeAreaView>
  );
}
