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

  const totalHeight = geometry.totalHeight ?? geometry.height;

  // Cabeceras de sección estables
  const sectionHeaders = useMemo(() => {
    const list: Array<{ rowIndex: number; label: string; key: string }> = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.type === "header") {
        list.push({ rowIndex: i, label: r.label, key: r.key });
      }
    }
    return list;
  }, [rows]);

  // Marcadores de fecha y posiciones dependientes de la altura total y cabeceras
  const dateMarkers = useMemo(() => {
    if (totalHeight <= 0 || sectionHeaders.length === 0) return [];
    return sectionHeaders.map((header) => {
      const line = geometry.lines.find(
        (l) => l.kind === "header" && l.rowIndex === header.rowIndex,
      );
      const y = line ? line.top : (header.rowIndex / rows.length) * totalHeight;
      return { rowIndex: header.rowIndex, label: header.label, y };
    });
  }, [totalHeight, sectionHeaders]);

  // Mapeo rápido de mes a fila de la galería
  const monthToRowIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.type === "photo") {
        const ym = new Date(r.photo.takenAt).toISOString().slice(0, 7);
        if (!map.has(ym)) {
          let target = i;
          for (let h = i; h >= 0; h--) {
            if (rows[h]?.type === "header") {
              target = h;
              break;
            }
          }
          map.set(ym, target);
        }
      }
    }
    return map;
  }, [sectionHeaders, rows]);

  const scrub = useCallback(
    (y: number) => {
      if (trackH <= 0) return;
      const frac = Math.min(1, Math.max(0, y / trackH));

      // Si tenemos la lista completa de meses y el usuario arrastra a una zona no cargada:
      if (months && months.length > 0) {
        const mIdx = Math.min(months.length - 1, Math.max(0, Math.floor(frac * months.length)));
        const targetMonth = months[mIdx];
        if (targetMonth) {
          const foundRowIndex = monthToRowIndex.get(targetMonth.ym);
          if (foundRowIndex !== undefined && foundRowIndex >= 0) {
            pendingJumpIso.current = null;
            if (foundRowIndex !== lastIndex.current) {
              lastIndex.current = foundRowIndex;
              onScrub(foundRowIndex);
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

      if (totalHeight <= 0) return;
      const targetY = frac * totalHeight;
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
    [trackH, totalHeight, geometry, rows, onScrub, months, monthToRowIndex],
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
        {trackH > 0 && totalHeight > 0 && dateMarkers.length > 0 && dateMarkers.length <= 30
          ? dateMarkers.map((m, idx) => (
              <View
                key={`${m.rowIndex}-${idx}`}
                className="absolute right-1 w-1 h-0.5 bg-neutral-400/50 dark:bg-neutral-500/50"
                style={{ top: Math.min(Math.max((m.y / totalHeight) * trackH, 8), trackH - 8) }}
                pointerEvents="none"
              />
            ))
          : null}
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
