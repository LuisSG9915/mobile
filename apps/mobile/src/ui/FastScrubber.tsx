import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import type { GalleryRow } from "../lib/gallery";
import { type GridGeometry, lineAtY, scrubLabel } from "../lib/grid-geometry";

type Props = {
  geometry: GridGeometry;
  rows: GalleryRow[];
  /** Índice en `rows` al que saltar (encabezado o primera foto de línea). */
  onScrub: (rowIndex: number) => void;
};

/**
 * Fast-scrubber lateral estilo Google Photos: una zona táctil fina en el
 * borde derecho. Al arrastrar, la posición vertical se mapea a la altura
 * total del contenido para saltar al grupo de fecha más cercano mientras
 * una burbuja flotante muestra el mes y año bajo el dedo.
 */
export function FastScrubber({ geometry, rows, onScrub }: Props) {
  const [trackH, setTrackH] = useState(0);
  const [bubble, setBubble] = useState<{ y: number; label: string } | null>(null);
  const lastIndex = useRef(-1);

  const scrub = useCallback(
    (y: number) => {
      if (trackH <= 0 || geometry.height <= 0) return;
      const frac = Math.min(1, Math.max(0, y / trackH));
      const targetY = frac * geometry.height;
      const line = lineAtY(geometry, targetY);
      if (!line) return;
      const rowIndex = line.kind === "header" ? line.rowIndex : line.firstRow;
      if (rowIndex !== lastIndex.current) {
        lastIndex.current = rowIndex;
        onScrub(rowIndex);
      }
      setBubble({ y: Math.min(Math.max(y, 20), trackH - 20), label: scrubLabel(line, rows) });
    },
    [trackH, geometry, rows, onScrub],
  );

  const endScrub = useCallback(() => {
    lastIndex.current = -1;
    setBubble(null);
  }, []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(6)
        .activeOffsetX([-10, 10])
        .onBegin((e) => runOnJS(scrub)(e.y))
        .onUpdate((e) => runOnJS(scrub)(e.y))
        .onFinalize(() => runOnJS(endScrub)()),
    [scrub, endScrub],
  );

  return (
    <GestureDetector gesture={pan}>
      <View
        className="absolute right-0 top-0 bottom-0 w-5 justify-center"
        onLayout={(e) => setTrackH(e.nativeEvent.layout.height)}
      >
        {/* Pista visual sutil siempre visible para descubrir el gesto. */}
        <View className="absolute right-1 top-4 bottom-4 w-1 rounded-full bg-neutral-300/50 dark:bg-neutral-700/50" />
        {bubble ? (
          <View
            className="absolute right-8 rounded-full bg-neutral-900/90 dark:bg-white/90 px-3 py-1.5"
            style={{ top: bubble.y - 16 }}
            pointerEvents="none"
          >
            <Text className="text-xs font-semibold text-white dark:text-neutral-900">
              {bubble.label}
            </Text>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}
