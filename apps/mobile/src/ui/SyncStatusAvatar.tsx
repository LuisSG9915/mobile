import { AlertCircle, Check, CloudUpload, User } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useSession } from "../auth/client";
import { t } from "../i18n/es";
import { useQueueEvents } from "../lib/events";
import { formatBytes } from "../lib/format";
import { useSyncProgress } from "../lib/store";
import { getQueueStats, isBackupPaused, setBackupPaused } from "../queue/db";
import { useSyncProgressAuto } from "../queue/progress";
import { runBackupPass } from "../queue/runner";
import type { SyncProgressStatus } from "../queue/types";

const SIZE = 36;
const STROKE = 3;

const RING_COLOR: Record<SyncProgressStatus, string> = {
  syncing: "#4f46e5",
  completed: "#16a34a",
  error: "#dc2626",
  paused: "#d97706",
  idle: "#a3a3a3",
};

const STATUS_TEXT: Record<SyncProgressStatus, string> = {
  syncing: t.syncP.syncing,
  completed: t.syncP.completed,
  error: t.syncP.error,
  paused: t.syncP.paused,
  idle: t.syncP.idle,
};

/**
 * Avatar del encabezado con anillo de progreso del respaldo (estilo Google
 * Photos): arco 0-100% mientras sube, check verde al completar, punto rojo
 * con errores. Al pulsar abre un modal con el desglose de la copia.
 */
export function SyncStatusAvatar() {
  useSyncProgressAuto();
  const p = useSyncProgress();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  const pct =
    p.totalBytes > 0
      ? Math.min(1, p.bytesUploaded / p.totalBytes)
      : p.filesTotal > 0
        ? Math.min(1, 1 - p.filesRemaining / p.filesTotal)
        : 0;
  const color = RING_COLOR[p.status];
  const r = (SIZE - STROKE) / 2;
  const c = 2 * Math.PI * r;
  const initial = session?.user?.name?.trim()?.charAt(0)?.toUpperCase() ?? null;
  const stats = open ? getQueueStats() : null;
  const paused = isBackupPaused();

  const togglePause = () => {
    // El item en vuelo termina; el procesador frena en el siguiente. La pausa
    // persiste en kv y nunca se auto-reanuda: solo este botón la quita.
    setBackupPaused(!paused);
    useQueueEvents.getState().emit();
    if (paused) void runBackupPass().catch(() => {});
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityLabel={t.syncP.title}
        hitSlop={8}
        style={{ width: SIZE, height: SIZE }}
      >
        <Svg
          width={SIZE}
          height={SIZE}
          style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}
        >
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={r}
            stroke="#e5e5e5"
            strokeWidth={STROKE}
            fill="none"
          />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={r}
            stroke={color}
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - pct)}
            strokeLinecap="round"
          />
        </Svg>
        <View className="flex-1 items-center justify-center">
          {p.status === "completed" ? (
            <Check size={18} color="#16a34a" />
          ) : p.status === "error" ? (
            <AlertCircle size={18} color="#dc2626" />
          ) : initial ? (
            <Text className="text-sm font-bold text-neutral-700 dark:text-neutral-200">
              {initial}
            </Text>
          ) : (
            <User size={16} color="#737373" />
          )}
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          className="flex-1 bg-black/40 justify-center px-8"
          onPress={() => setOpen(false)}
        >
          <Pressable
            className="bg-white dark:bg-neutral-900 rounded-2xl p-5 gap-3"
            onPress={() => {}}
          >
            <View className="flex-row items-center gap-2">
              <CloudUpload size={18} color={color} />
              <Text className="text-lg font-bold text-neutral-900 dark:text-white">
                {t.syncP.title}
              </Text>
            </View>
            <Text className="text-sm font-medium" style={{ color }}>
              {STATUS_TEXT[p.status]}
            </Text>
            {stats ? (
              <Text className="text-sm text-neutral-600 dark:text-neutral-300">
                {t.syncP.synced(stats.done, stats.total)}
              </Text>
            ) : null}
            <Text className="text-sm text-neutral-600 dark:text-neutral-300">
              {t.syncP.bytes(formatBytes(p.bytesUploaded), formatBytes(p.totalBytes))}
            </Text>
            {p.status === "syncing" && p.currentFileName ? (
              <Text className="text-sm text-neutral-500" numberOfLines={1}>
                {t.syncP.current(p.currentFileName)}
              </Text>
            ) : null}
            {p.filesRemaining > 0 ? (
              <Text className="text-sm text-neutral-500">
                {t.syncP.remaining(p.filesRemaining)}
              </Text>
            ) : null}
            {stats && stats.failed > 0 ? (
              <Text className="text-sm text-red-600 dark:text-red-400">
                {t.syncP.failed(stats.failed)}
              </Text>
            ) : null}
            <Text className="text-2xl font-bold text-neutral-900 dark:text-white self-center">
              {Math.round(pct * 100)}%
            </Text>
            {paused || p.filesRemaining > 0 ? (
              <Pressable
                onPress={togglePause}
                className="border border-neutral-300 dark:border-neutral-700 rounded-xl px-4 py-2.5 items-center"
              >
                <Text className="text-sm font-semibold text-neutral-900 dark:text-white">
                  {paused ? t.syncP.resume : t.syncP.pause}
                </Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
