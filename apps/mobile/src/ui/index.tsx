import type { SyncStatus } from "@photos/shared";
import { AlertCircle, CloudCheck, CloudDownload, CloudOff, CloudUpload } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { t } from "../i18n/es";

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "default",
  loading = false,
  disabled = false,
  className,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost" | "danger";
  size?: "default" | "sm";
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const bg =
    variant === "primary"
      ? "bg-accent"
      : variant === "danger"
        ? "bg-red-600"
        : "bg-transparent border border-neutral-300 dark:border-neutral-700";
  const text =
    variant === "primary" || variant === "danger"
      ? "text-white"
      : "text-neutral-900 dark:text-white";
  const sizeClasses =
    size === "sm" ? "px-3 py-2 min-h-[38px] rounded-xl" : "px-5 py-4 min-h-[52px] rounded-2xl";
  const textSize = size === "sm" ? "text-sm" : "text-base";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      className={`${bg} ${sizeClasses} items-center justify-center ${disabled || loading ? "opacity-50" : ""} ${className ?? ""}`}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text className={`${text} font-semibold ${textSize}`} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-neutral-600 dark:text-neutral-300">{label}</Text>
      <TextInput
        className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3.5 text-base text-neutral-900 dark:text-white"
        placeholderTextColor="#a3a3a3"
        autoCapitalize="none"
        {...props}
      />
    </View>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <View
      className={`bg-white dark:bg-neutral-900 rounded-2xl p-4 border border-neutral-100 dark:border-neutral-800 ${className}`}
    >
      {children}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
  actionLabel,
}: {
  title: string;
  body?: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <View className="flex-1 items-center justify-center px-8 gap-3">
      <Text className="text-xl font-bold text-neutral-900 dark:text-white text-center">
        {title}
      </Text>
      {body ? (
        <Text className="text-base text-neutral-500 dark:text-neutral-400 text-center">{body}</Text>
      ) : null}
      {action && actionLabel ? (
        <View className="mt-3 self-stretch">
          <Button label={actionLabel} onPress={action} />
        </View>
      ) : null}
    </View>
  );
}

const BADGE_A11Y: Record<SyncStatus, string> = {
  LOCAL_ONLY: t.sync.localOnly,
  PENDING: t.sync.pending,
  SYNCING: t.sync.syncing,
  SYNCED: t.sync.synced,
  REMOTE_ONLY: t.sync.remoteOnly,
  FAILED: t.sync.failed,
};

/**
 * Chip de estado de sincronización sobre la miniatura (estilo Google Fotos).
 * FAILED destaca en rojo; SYNCING muestra el porcentaje si hay progreso.
 */
export function SyncBadge({ status, progress }: { status: SyncStatus; progress?: number | null }) {
  const icon = { size: 14, color: "#fff" } as const;
  let glyph: ReactNode;
  let label: string | null = null;
  let bg = "bg-black/60";
  switch (status) {
    case "SYNCED":
      glyph = <CloudCheck {...icon} />;
      bg = "bg-black/40";
      break;
    case "REMOTE_ONLY":
      glyph = <CloudDownload {...icon} />;
      break;
    case "SYNCING":
      glyph = <CloudUpload {...icon} />;
      label = progress != null ? `${Math.round(progress * 100)}%` : null;
      bg = "bg-accent/80";
      break;
    case "PENDING":
      glyph = <CloudUpload {...icon} />;
      break;
    case "FAILED":
      glyph = <AlertCircle {...icon} />;
      label = t.sync.failed;
      bg = "bg-red-600/90";
      break;
    case "LOCAL_ONLY":
      glyph = <CloudOff {...icon} />;
      break;
  }
  return (
    <View
      accessibilityLabel={BADGE_A11Y[status]}
      className={`absolute bottom-1 left-1 flex-row items-center rounded-md px-1.5 py-0.5 gap-1 ${bg}`}
    >
      {glyph}
      {label ? <Text className="text-white text-[10px] font-medium">{label}</Text> : null}
    </View>
  );
}

export function ProgressRing({
  progress,
  size = 140,
  stroke = 10,
}: {
  progress: number; // 0..1
  size?: number;
  stroke?: number;
}) {
  const pct = Math.max(0, Math.min(1, progress));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg
        width={size}
        height={size}
        style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#e5e5e5"
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#4f46e5"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="round"
        />
      </Svg>
      <Text className="text-2xl font-bold text-neutral-900 dark:text-white">
        {Math.round(pct * 100)}%
      </Text>
    </View>
  );
}
