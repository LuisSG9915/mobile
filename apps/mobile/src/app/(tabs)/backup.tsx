import { CloudOff, HardDrive, RotateCcw } from "lucide-react-native";
import { useState } from "react";
import { Alert, Platform, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { t } from "../../i18n/es";
import { useQueueEvents } from "../../lib/events";
import { formatBytes, formatRelative } from "../../lib/format";
import { freeSyncedSpace, getSyncedLocal } from "../../lib/free-space";
import { useSettings } from "../../lib/store";
import { getFailed, getQueueStats, kvGet, retryFailed } from "../../queue/db";
import { requestMediaPermissions } from "../../queue/permissions";
import { isRunning } from "../../queue/processor";
import { runBackupPass } from "../../queue/runner";
import { Button, Card, ProgressRing } from "../../ui";
import { pickAndEnqueue } from "../../web/files";

const isWeb = Platform.OS === "web";

export default function BackupScreen() {
  useQueueEvents((s) => s.tick); // re-render ante cambios de la cola
  const { wifiOnly, includeVideos, setWifiOnly, setIncludeVideos } = useSettings();
  const [scanning, setScanning] = useState(false);
  const [pickWarning, setPickWarning] = useState<string | null>(null);

  const stats = getQueueStats();
  const failed = getFailed();
  // En web no hay copia local que liberar (el blob se borra al terminar).
  const syncedLocal = isWeb ? { assetIds: [], totalBytes: 0 } : getSyncedLocal();
  const lastBackup = Number(kvGet("last_scan_ts") ?? "0");
  const progress = stats.total ? stats.done / stats.total : 0;
  const running = isRunning();

  const freeSpace = () => {
    const { assetIds, totalBytes } = getSyncedLocal();
    if (!assetIds.length) return;
    const size = formatBytes(totalBytes);
    Alert.alert(t.backup.freeSpace, t.backup.freeSpaceConfirm(assetIds.length, size), [
      { text: "Cancelar", style: "cancel" },
      {
        text: t.backup.freeSpace,
        style: "destructive",
        onPress: () => {
          void freeSyncedSpace().then((n) => {
            if (n > 0) toast.success(t.backup.freed(n, size));
          });
        },
      },
    ]);
  };

  const statusText = !running
    ? stats.pending > 0
      ? wifiOnly
        ? t.backup.waitingWifi
        : t.backup.allDone
      : t.backup.allDone
    : stats.pending > 0
      ? t.backup.uploading(`${stats.pending} pendientes`)
      : t.backup.allDone;

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top"]}>
      <ScrollView contentContainerClassName="px-5 py-6 gap-5">
        <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
          {t.backup.title}
        </Text>

        <Card className="items-center gap-4 py-6">
          <ProgressRing progress={progress} />
          <Text className="text-lg font-semibold text-neutral-900 dark:text-white text-center">
            {stats.total === 0 ? t.backup.allDone : t.backup.synced(stats.done, stats.total)}
          </Text>
          <Text className="text-sm text-neutral-500 text-center">{statusText}</Text>
          {lastBackup ? (
            <Text className="text-xs text-neutral-400">
              {t.backup.lastBackup(formatRelative(lastBackup))}
            </Text>
          ) : null}
        </Card>

        <Card className="gap-4">
          {!isWeb ? (
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-base font-semibold text-neutral-900 dark:text-white">
                  {t.backup.wifiOnly}
                </Text>
                <Text className="text-sm text-neutral-500 mt-0.5">{t.backup.wifiOnlyHelp}</Text>
              </View>
              <Switch
                value={wifiOnly}
                onValueChange={setWifiOnly}
                accessibilityLabel={t.backup.wifiOnly}
              />
            </View>
          ) : null}
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-base font-semibold text-neutral-900 dark:text-white">
                {t.backup.includeVideos}
              </Text>
              <Text className="text-sm text-neutral-500 mt-0.5">{t.backup.includeVideosHelp}</Text>
            </View>
            <Switch
              value={includeVideos}
              onValueChange={setIncludeVideos}
              accessibilityLabel={t.backup.includeVideos}
            />
          </View>
        </Card>

        {syncedLocal.assetIds.length > 0 ? (
          <Card className="gap-3">
            <View className="flex-row items-center gap-2">
              <HardDrive size={16} color="#4f46e5" />
              <Text className="text-base font-semibold text-neutral-900 dark:text-white">
                {t.backup.freeSpace}
              </Text>
            </View>
            <Text className="text-sm text-neutral-500">
              {t.backup.freeSpaceBody(
                syncedLocal.assetIds.length,
                formatBytes(syncedLocal.totalBytes),
              )}
            </Text>
            <Button label={t.backup.freeSpace} variant="ghost" onPress={freeSpace} />
          </Card>
        ) : null}

        {failed.length ? (
          <Card className="gap-3">
            <View className="flex-row items-center gap-2">
              <RotateCcw size={16} color="#dc2626" />
              <Text className="text-base font-semibold text-neutral-900 dark:text-white">
                {t.backup.failedTitle} ({failed.length})
              </Text>
            </View>
            {failed.slice(0, 5).map((f) => (
              <View key={f.asset_id} className="flex-row items-center gap-2">
                <CloudOff size={14} color="#a3a3a3" />
                <Text
                  className="text-sm text-neutral-600 dark:text-neutral-300 flex-1"
                  numberOfLines={1}
                >
                  {f.filename ?? f.asset_id}
                </Text>
                <Text className="text-xs text-neutral-400 flex-1" numberOfLines={1}>
                  {f.last_error}
                </Text>
              </View>
            ))}
            <Button
              label={t.backup.retryAll}
              variant="ghost"
              onPress={async () => {
                await retryFailed();
                void runBackupPass();
              }}
            />
          </Card>
        ) : null}

        <Button
          label={scanning ? t.backup.scanning : isWeb ? t.backup.pickFiles : t.backup.scanForNew}
          variant="ghost"
          loading={scanning}
          onPress={async () => {
            setScanning(true);
            setPickWarning(null);
            try {
              if (isWeb) {
                const result = await pickAndEnqueue();
                if (result.failed > 0) setPickWarning(t.backup.pickFailed(result.failed));
              } else {
                await requestMediaPermissions();
              }
              await runBackupPass();
            } catch (e) {
              setPickWarning(e instanceof Error ? e.message : String(e));
            } finally {
              setScanning(false);
            }
          }}
        />

        {pickWarning ? (
          <Text className="text-xs text-red-600 dark:text-red-400 text-center">{pickWarning}</Text>
        ) : null}

        {Platform.OS === "ios" ? (
          <Text className="text-xs text-neutral-400 text-center">{t.backup.noteIos}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
