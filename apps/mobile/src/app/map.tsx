import type { LocationItem, SearchFilter } from "@photos/shared";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import {
  ChevronLeft,
  ExternalLink,
  Heart,
  MapPin,
  Minus,
  Play,
  Plus,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { t } from "../i18n/es";
import { formatDateTime } from "../lib/format";
import { EmptyState } from "../ui";

// Conversión Web Mercator para proyección de OpenStreetMap
function latLngToWorld(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n;
  const latRad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

function worldToLatLng(x: number, y: number, zoom: number): { lat: number; lng: number } {
  const n = 2 ** zoom;
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lng };
}

const TILE_SIZE = 256;

export default function MapScreen() {
  const { lat: initLat, lng: initLng } = useLocalSearchParams<{ lat?: string; lng?: string }>();
  const { width, height } = useWindowDimensions();

  const [filter, setFilter] = useState<SearchFilter>("all");
  const [zoom, setZoom] = useState<number>(() => (initLat && initLng ? 14 : 4));
  const [center, setCenter] = useState<{ lat: number; lng: number }>(() => ({
    lat: initLat ? Number.parseFloat(initLat) : 23.6345,
    lng: initLng ? Number.parseFloat(initLng) : -102.5528,
  }));
  const [selectedPin, setSelectedPin] = useState<LocationItem | null>(null);

  const locationsQuery = useQuery({
    queryKey: ["locations", filter],
    queryFn: () => api.locations({ filter }),
  });

  const items = locationsQuery.data?.items ?? [];

  // Al cargar los datos, si no venimos con una foto fija, centrar en el promedio de las fotos del usuario
  const hasInitializedCenter = useRef(Boolean(initLat && initLng));
  useEffect(() => {
    if (hasInitializedCenter.current || items.length === 0) return;
    hasInitializedCenter.current = true;
    let sumLat = 0;
    let sumLng = 0;
    for (const item of items) {
      sumLat += item.latitude;
      sumLng += item.longitude;
    }
    setCenter({
      lat: sumLat / items.length,
      lng: sumLng / items.length,
    });
    setZoom(items.length === 1 ? 12 : 5);
  }, [items]);

  // Si venimos con id/coordenadas específicas, seleccionar la foto
  useEffect(() => {
    if (initLat && initLng && items.length > 0 && !selectedPin) {
      const targetLat = Number.parseFloat(initLat);
      const targetLng = Number.parseFloat(initLng);
      const matched = items.find(
        (i) =>
          Math.abs(i.latitude - targetLat) < 0.0001 && Math.abs(i.longitude - targetLng) < 0.0001,
      );
      if (matched) setSelectedPin(matched);
    }
  }, [initLat, initLng, items, selectedPin]);

  // Cálculo de teselas (tiles) visibles
  const centerWorld = useMemo(
    () => latLngToWorld(center.lat, center.lng, zoom),
    [center.lat, center.lng, zoom],
  );
  const centerPx = useMemo(
    () => ({ x: centerWorld.x * TILE_SIZE, y: centerWorld.y * TILE_SIZE }),
    [centerWorld],
  );

  const tiles = useMemo(() => {
    const minTx = Math.floor((centerPx.x - width / 2) / TILE_SIZE);
    const maxTx = Math.floor((centerPx.x + width / 2) / TILE_SIZE);
    const minTy = Math.floor((centerPx.y - height / 2) / TILE_SIZE);
    const maxTy = Math.floor((centerPx.y + height / 2) / TILE_SIZE);

    const maxCoord = 2 ** zoom;
    const result: {
      key: string;
      tx: number;
      ty: number;
      left: number;
      top: number;
      url: string;
    }[] = [];

    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        // Envolver longitud (X) y acotar latitud (Y)
        const wrappedTx = ((tx % maxCoord) + maxCoord) % maxCoord;
        if (ty >= 0 && ty < maxCoord) {
          const subdomains = ["a", "b", "c", "d"];
          const s = subdomains[Math.abs(wrappedTx + ty) % 4];
          result.push({
            key: `${zoom}-${tx}-${ty}`,
            tx: wrappedTx,
            ty,
            left: tx * TILE_SIZE - (centerPx.x - width / 2),
            top: ty * TILE_SIZE - (centerPx.y - height / 2),
            url: `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${wrappedTx}/${ty}.png`,
          });
        }
      }
    }
    return result;
  }, [centerPx.x, centerPx.y, width, height, zoom]);

  // Marcadores visibles proyectados en la pantalla
  const markers = useMemo(() => {
    return items
      .map((item) => {
        const w = latLngToWorld(item.latitude, item.longitude, zoom);
        const px = w.x * TILE_SIZE;
        const py = w.y * TILE_SIZE;
        const screenX = width / 2 + (px - centerPx.x);
        const screenY = height / 2 + (py - centerPx.y);
        return { item, screenX, screenY };
      })
      .filter(
        (m) =>
          m.screenX >= -40 &&
          m.screenX <= width + 40 &&
          m.screenY >= -40 &&
          m.screenY <= height + 40,
      );
  }, [items, zoom, width, height, centerPx.x, centerPx.y]);

  // Gesto de Arrastre (Pan)
  const panStartRef = useRef<{ lat: number; lng: number }>(center);
  const panGesture = Gesture.Pan()
    .onStart(() => {
      panStartRef.current = center;
    })
    .onUpdate((e) => {
      const deltaPxX = -e.translationX;
      const deltaPxY = -e.translationY;
      const startW = latLngToWorld(panStartRef.current.lat, panStartRef.current.lng, zoom);
      const newWorldX = startW.x + deltaPxX / TILE_SIZE;
      const newWorldY = startW.y + deltaPxY / TILE_SIZE;
      const newLatLng = worldToLatLng(newWorldX, newWorldY, zoom);
      setCenter(newLatLng);
    });

  const zoomIn = () => setZoom((z) => Math.min(18, z + 1));
  const zoomOut = () => setZoom((z) => Math.max(2, z - 1));

  const openInExternalMaps = useCallback((lat: number, lng: number) => {
    const url =
      Platform.OS === "ios"
        ? `maps://?q=${lat},${lng}`
        : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    void Linking.openURL(url);
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-neutral-900" edges={["top", "bottom"]}>
      {/* Cabecera flotante */}
      <View className="absolute top-12 left-3 right-3 z-20 flex-row items-center justify-between pointer-events-box-none">
        <View className="flex-row items-center gap-2 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-md px-3 py-2 rounded-2xl shadow-lg border border-neutral-200/50 dark:border-neutral-800">
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityLabel="Volver"
            className="p-1 rounded-full active:bg-neutral-200 dark:active:bg-neutral-800"
          >
            <ChevronLeft size={22} color="#4f46e5" />
          </Pressable>
          <View>
            <Text className="text-sm font-bold text-neutral-900 dark:text-white">
              {t.map.title}
            </Text>
            <Text className="text-[10px] text-neutral-500 font-medium">
              {items.length} fotos con GPS
            </Text>
          </View>
        </View>

        {/* Filtros rápidos de tipo */}
        <View className="flex-row items-center gap-1.5 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-md p-1 rounded-2xl shadow-lg border border-neutral-200/50 dark:border-neutral-800">
          {(["all", "photos", "videos", "favorites"] as const).map((k) => {
            const isSel = filter === k;
            return (
              <Pressable
                key={k}
                onPress={() => setFilter(k)}
                className={`px-2.5 py-1 rounded-xl ${isSel ? "bg-accent" : "active:bg-neutral-100 dark:active:bg-neutral-800"}`}
              >
                <Text
                  className={`text-[11px] font-semibold ${isSel ? "text-white" : "text-neutral-600 dark:text-neutral-300"}`}
                >
                  {k === "all"
                    ? "Todo"
                    : k === "photos"
                      ? "Fotos"
                      : k === "videos"
                        ? "Videos"
                        : "Favs"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Controles de Zoom Flotantes */}
      <View className="absolute right-3 top-32 z-20 gap-2">
        <Pressable
          onPress={zoomIn}
          className="w-11 h-11 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-md rounded-2xl items-center justify-center shadow-lg border border-neutral-200/50 dark:border-neutral-800 active:bg-neutral-100"
          accessibilityLabel="Acercar mapa"
        >
          <Plus size={20} color="#171717" />
        </Pressable>
        <Pressable
          onPress={zoomOut}
          className="w-11 h-11 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-md rounded-2xl items-center justify-center shadow-lg border border-neutral-200/50 dark:border-neutral-800 active:bg-neutral-100"
          accessibilityLabel="Alejar mapa"
        >
          <Minus size={20} color="#171717" />
        </Pressable>
      </View>

      {/* Contenedor del Mapa Interactivo con Gesture Detector */}
      <GestureDetector gesture={panGesture}>
        <View className="flex-1 overflow-hidden bg-neutral-200 dark:bg-neutral-950">
          {/* Teselas de OpenStreetMap */}
          {tiles.map((tile) => (
            <Image
              key={tile.key}
              source={{ uri: tile.url }}
              style={{
                position: "absolute",
                left: tile.left,
                top: tile.top,
                width: TILE_SIZE,
                height: TILE_SIZE,
              }}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ))}

          {/* Marcadores / Pines con miniatura */}
          {markers.map(({ item, screenX, screenY }) => {
            const isSelected = selectedPin?.id === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setSelectedPin(item)}
                style={{
                  position: "absolute",
                  left: screenX - 22,
                  top: screenY - 48,
                  zIndex: isSelected ? 30 : 10,
                }}
                className="items-center"
              >
                {/* Globo del pin con foto */}
                <View
                  className={`w-11 h-11 rounded-2xl overflow-hidden border-2 shadow-lg bg-white dark:bg-neutral-900 items-center justify-center ${
                    isSelected ? "border-accent scale-110" : "border-white"
                  }`}
                >
                  <Image
                    source={{ uri: item.thumbUrl }}
                    placeholder={{ thumbhash: item.thumbhash }}
                    style={{ width: "100%", height: "100%" }}
                    contentFit="cover"
                  />
                  {item.mediaType === "video" ? (
                    <View className="absolute inset-0 bg-black/40 items-center justify-center">
                      <Play size={10} color="#fff" fill="#fff" />
                    </View>
                  ) : null}
                </View>
                {/* Punta inferior del pin */}
                <View
                  className={`w-2.5 h-2.5 bg-white rotate-45 -mt-1 shadow-md border-r border-b ${
                    isSelected ? "bg-accent border-accent" : "border-neutral-200"
                  }`}
                />
              </Pressable>
            );
          })}

          {/* Estado de carga inicial */}
          {locationsQuery.isPending ? (
            <View className="absolute inset-0 items-center justify-center bg-black/20">
              <ActivityIndicator size="large" color="#4f46e5" />
            </View>
          ) : null}

          {/* Estado vacío si no hay fotos con GPS */}
          {items.length === 0 && !locationsQuery.isPending ? (
            <View className="absolute inset-x-6 top-1/3 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md p-6 rounded-3xl shadow-2xl border border-neutral-200 dark:border-neutral-800">
              <EmptyState
                title={t.map.emptyTitle}
                body={t.map.emptyBody}
                actionLabel="Volver a la galería"
                action={() => router.back()}
              />
            </View>
          ) : null}
          {/* Atribución de mapas */}
          <View className="absolute bottom-2 left-3 bg-white/70 dark:bg-black/60 px-2 py-0.5 rounded backdrop-blur-sm pointer-events-none">
            <Text className="text-[9px] text-neutral-600 dark:text-neutral-400">
              © CARTO · © OpenStreetMap
            </Text>
          </View>
        </View>
      </GestureDetector>

      {/* Tarjeta flotante de foto seleccionada */}
      {selectedPin ? (
        <View className="absolute bottom-6 left-4 right-4 z-30 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md rounded-3xl p-3.5 shadow-2xl border border-neutral-200 dark:border-neutral-800 flex-row items-center gap-3">
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/media/[id]",
                params: {
                  id: selectedPin.id,
                  mediaType: selectedPin.mediaType,
                  thumbhash: selectedPin.thumbhash,
                },
              })
            }
            className="w-20 h-20 rounded-2xl overflow-hidden bg-neutral-200 dark:bg-neutral-800"
          >
            <Image
              source={{ uri: selectedPin.thumbUrl }}
              placeholder={{ thumbhash: selectedPin.thumbhash }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
            {selectedPin.mediaType === "video" ? (
              <View className="absolute bottom-1 right-1 bg-black/60 rounded px-1.5 py-0.5 flex-row items-center gap-1">
                <Play size={10} color="#fff" fill="#fff" />
              </View>
            ) : null}
            {selectedPin.isFavorite ? (
              <View className="absolute bottom-1 left-1 bg-black/50 rounded-full p-1 shadow-sm">
                <Heart size={10} color="#f43f5e" fill="#f43f5e" />
              </View>
            ) : null}
          </Pressable>

          <View className="flex-1 justify-center">
            <Text className="text-sm font-bold text-neutral-900 dark:text-white" numberOfLines={1}>
              {selectedPin.locationName || selectedPin.caption || "Foto con ubicación"}
            </Text>
            <Text className="text-xs text-neutral-500 mt-0.5">
              {selectedPin.locationName && selectedPin.caption
                ? selectedPin.caption
                : formatDateTime(selectedPin.takenAt)}
            </Text>
            <View className="flex-row items-center gap-1 mt-1">
              <MapPin size={12} color="#737373" />
              <Text className="text-[11px] text-neutral-400">
                {selectedPin.latitude.toFixed(4)}, {selectedPin.longitude.toFixed(4)}
              </Text>
            </View>
          </View>

          <View className="gap-2">
            <Pressable
              onPress={() => setSelectedPin(null)}
              hitSlop={8}
              className="self-end p-1 rounded-full bg-neutral-100 dark:bg-neutral-800"
              accessibilityLabel="Cerrar ficha"
            >
              <X size={14} color="#737373" />
            </Pressable>

            <Pressable
              onPress={() => openInExternalMaps(selectedPin.latitude, selectedPin.longitude)}
              hitSlop={8}
              className="p-2 rounded-xl bg-accent/10 items-center justify-center active:bg-accent/20"
              accessibilityLabel={t.map.openInMaps}
            >
              <ExternalLink size={16} color="#4f46e5" />
            </Pressable>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
