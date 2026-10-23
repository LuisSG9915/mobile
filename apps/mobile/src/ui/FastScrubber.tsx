import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import type { GalleryRow } from "../lib/gallery";
import { type GridGeometry, lineAtY, scrubLabel } from "../lib/grid-geometry";
import { hapticSelection } from "../lib/haptics";

export function ymToEndOfMonthIso(ym: string): string {
  const [year, month] = ym.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString();
}

const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("es", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

type Props = {
  geometry: GridGeometry;
  rows: GalleryRow[];
  /** Índice en `rows` al que saltar (encabezado o primera foto de línea). */
  onScrub: (rowIndex: number) => void;
  months?: Array<{ ym: string; count: number }>;
  onJumpBefore?: (beforeIso: string) => void;
};

/**
 * Fast-scrubber lateral estilo Google Photos: una zona táctil fina en el
 * borde derecho. Al arrastrar, la posición vertical se mapea a la altura
 * total del contenido para saltar al grupo de fecha más cercano mientras
 * una burbuja flotante muestra el mes y año bajo el dedo.
 */
export function FastScrubber({ geometry, rows, onScrub, months, onJumpBefore }: Props) {
  const [trackH, setTrackH] = useState(0);
  const [bubble, setBubble] = useState<{ y: number; label: string } | null>(null);
  const lastIndex = useRef(-1);
  const lastLabel = useRef("");
  const pendingJumpIso = useRef<string | null>(null);

  const scrub = useCallback(
    (y: number) => {
      if (trackH <= 0) return;
      const frac = Math.min(1, Math.max(0, y / trackH));

      // Si tenemos la lista completa de meses y el usuario arrastra a una zona no cargada:
      if (months && months.length > 0) {
        const mIdx = Math.min(months.length - 1, Math.max(0, Math.floor(frac * months.length)));
        const targetMonth = months[mIdx];
        if (targetMonth) {
          // Buscar si el mes ya está en las filas cargadas
          let foundRowIndex = -1;
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (
              r.type === "photo" &&
              new Date(r.photo.takenAt).toISOString().slice(0, 7) === targetMonth.ym
            ) {
              foundRowIndex = i;
              break;
            }
          }

          if (foundRowIndex >= 0) {
            pendingJumpIso.current = null;
            let target = foundRowIndex;
            for (let i = foundRowIndex; i >= 0; i--) {
              if (rows[i].type === "header") {
                target = i;
                break;
              }
            }
            if (target !== lastIndex.current) {
              lastIndex.current = target;
              onScrub(target);
            }
            const label = monthLabel(targetMonth.ym);
            if (label !== lastLabel.current) {
              lastLabel.current = label;
              hapticSelection();
            }
            setBubble({ y: Math.min(Math.max(y, 20), trackH - 20), label });
            return;
          }

          // El mes no está cargado en memoria -> mostrar etiqueta y preparar salto directo
          pendingJumpIso.current = ymToEndOfMonthIso(targetMonth.ym);
          const label = monthLabel(targetMonth.ym);
          if (label !== lastLabel.current) {
            lastLabel.current = label;
            hapticSelection();
          }
          setBubble({ y: Math.min(Math.max(y, 20), trackH - 20), label });
          return;
        }
      }

      if (geometry.height <= 0) return;
      const targetY = frac * geometry.height;
      const line = lineAtY(geometry, targetY);
      if (!line) return;
      const rowIndex = line.kind === "header" ? line.rowIndex : line.firstRow;
      if (rowIndex !== lastIndex.current) {
        lastIndex.current = rowIndex;
        onScrub(rowIndex);
      }
      const label = scrubLabel(line, rows);
      if (label !== lastLabel.current) {
        lastLabel.current = label;
        hapticSelection();
      }
      setBubble({ y: Math.min(Math.max(y, 20), trackH - 20), label });
    },
    [trackH, geometry, rows, onScrub, months],
  );

  const endScrub = useCallback(() => {
    if (pendingJumpIso.current && onJumpBefore) {
      onJumpBefore(pendingJumpIso.current);
      pendingJumpIso.current = null;
    }
    lastIndex.current = -1;
    lastLabel.current = "";
    setBubble(null);
  }, [onJumpBefore]);

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
