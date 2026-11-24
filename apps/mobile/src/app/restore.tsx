import type { MediaManifestItem } from "@photos/shared";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { useSession } from "../auth/client";
import { t } from "../i18n/es";
import { formatBytes } from "../lib/format";
import { toUserMessage } from "../lib/user-message";
import { getQueueDb } from "../queue/db";
import { createRestoreDeps } from "../restore/deps";
import { planRestore, totalBytes } from "../restore/plan";
import { type RestoreOutcome, runRestore } from "../restore/processor";
import { createRestoreStore, localKnownShas } from "../restore/store";
import { Button, Card } from "../ui";

type Phase = "idle" | "preparing" | "ready" | "running" | "paused" | "finished";
type Scope = "all" | string; // "all" o un año (YYYY)

/** Tope de seguridad del manifiesto: 200 por página × 500 = 100.000 elementos. */
const MAX_MANIFEST_PAGES = 500;

export default function RestoreScreen() {
  const { data: session } = useSession();
  const userId = session?.user.id ?? "";
  const store = useMemo(() => (userId ? createRestoreStore(userId) : null), [userId]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [scope, setScope] = useState<Scope>("all");
  const [wifiOnly, setWifiOnly] = useState(true);
  const [loaded, setLoaded] = useState(0);
  const [summary, setSummary] = useState<{
    count: number;
    bytes: number;
    skipped: number;
    free: number;
  } | null>(null);
  const [counts, setCounts] = useState(store?.counts() ?? null);
  const [pause, setPause] = useState<RestoreOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const wifiRef = useRef(wifiOnly);
  wifiRef.current = wifiOnly;

  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => String(y - i));
  }, []);

  const refreshCounts = useCallback(() => setCounts(store?.counts() ?? null), [store]);

  // Si quedó una restauración a medias, ofrecerla para reanudar.
  useEffect(() => {
    if (!store) return;
    const c = store.counts();
    setCounts(c);
    if (c.queued + c.downloading + c.verifying + c.failed + c.corrupt > 0) setPhase("paused");
  }, [store]);

  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(refreshCounts, 1000);
    return () => clearInterval(id);
  }, [phase, refreshCounts]);

  const prepare = useCallback(async () => {
    if (!store) return;
    setPhase("preparing");
    setError(null);
    setLoaded(0);
    try {
      const manifest: MediaManifestItem[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < MAX_MANIFEST_PAGES; i++) {
        const page = await api.mediaManifest({
          cursor,
          limit: 200,
          year: scope === "all" ? undefined : scope,
        });
        manifest.push(...page.items);
        setLoaded(manifest.length);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      const { toRestore, skipped } = planRestore(manifest, localKnownShas(getQueueDb(), userId));
      const free = await FileSystem.getFreeDiskStorageAsync();
      store.enqueue(toRestore);
      setSummary({
        count: toRestore.length,
        bytes: totalBytes(toRestore),
        skipped: skipped.length,
        free,
      });
      refreshCounts();
      setPhase("ready");
    } catch (e) {
      setError(toUserMessage(e, t.restore.error));
      setPhase("idle");
    }
  }, [store, scope, userId, refreshCounts]);

  const start = useCallback(async () => {
    if (!store) return;
    stopRef.current = false;
    setPause(null);
    setPhase("running");
    const outcome = await runRestore(
      store,
      createRestoreDeps({ wifiOnly: () => wifiRef.current }),
      () => stopRef.current,
    );
    refreshCounts();
    setPause(outcome);
    setPhase(outcome === "done" ? "finished" : "paused");
  }, [store, refreshCounts]);

  const resume = useCallback(() => {
    store?.retryFailed();
    void start();
  }, [store, start]);

  const total = counts
    ? counts.queued +
      counts.downloading +
      counts.verifying +
      counts.done +
      counts.failed +
      counts.corrupt
    : 0;

  const pauseText =
    pause === "network"
      ? t.restore.pausedNetwork
      : pause === "disk"
        ? t.restore.pausedDisk
        : t.restore.pausedUser;

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top", "bottom"]}>
      <ScrollView contentContainerClassName="px-5 py-4 gap-4">
        <View className="gap-1">
          <Text className="text-2xl font-bold text-neutral-900 dark:text-white">
            {t.restore.title}
          </Text>
          <Text className="text-sm text-neutral-500">{t.restore.body}</Text>
        </View>

        {phase === "idle" || phase === "preparing" ? (
          <Card className="gap-3">
            <Text className="text-sm font-semibold text-neutral-900 dark:text-white">
              {t.restore.scope}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {["all", ...years].map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={scope === s ? "primary" : "ghost"}
                  label={s === "all" ? t.restore.scopeAll : s}
                  onPress={() => setScope(s)}
                  disabled={phase === "preparing"}
                />
              ))}
            </View>
            {phase === "preparing" ? (
              <View className="flex-row items-center gap-3">
                <ActivityIndicator color="#4f46e5" />
                <Text className="text-sm text-neutral-600 dark:text-neutral-300">
                  {t.restore.preparing(loaded)}
                </Text>
              </View>
            ) : null}
            {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
            <Button
              label={t.restore.prepare}
              loading={phase === "preparing"}
              onPress={() => void prepare()}
              disabled={!store}
            />
          </Card>
        ) : null}

        {phase === "ready" && summary ? (
          <Card className="gap-3">
            {summary.count === 0 ? (
              <Text className="text-sm text-neutral-600 dark:text-neutral-300">
                {t.restore.nothingToDo}
              </Text>
            ) : (
              <>
                <Text className="text-lg font-bold text-neutral-900 dark:text-white">
                  {t.restore.summary(summary.count, formatBytes(summary.bytes))}
                </Text>
                <Text className="text-xs text-neutral-500">
                  {t.restore.alreadyHere(summary.skipped)}
                </Text>
                <Text className="text-xs text-neutral-500">
                  {t.restore.free(formatBytes(summary.free))}
                </Text>
                {summary.bytes * 2 > summary.free ? (
                  <Text className="text-xs text-amber-600">{t.restore.notEnough}</Text>
                ) : null}
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm text-neutral-900 dark:text-white">
                    {t.restore.wifiOnly}
                  </Text>
                  <Switch value={wifiOnly} onValueChange={setWifiOnly} />
                </View>
                <Button label={t.restore.start} onPress={() => void start()} />
              </>
            )}
          </Card>
        ) : null}

        {phase === "running" || phase === "paused" || phase === "finished" ? (
          <Card className="gap-3">
            <Text className="text-lg font-bold text-neutral-900 dark:text-white">
              {phase === "finished"
                ? t.restore.finished
                : t.restore.progress(counts?.done ?? 0, total)}
            </Text>
            {phase === "paused" ? (
              <Text className="text-sm text-amber-600">{pauseText}</Text>
            ) : null}
            {counts && counts.failed > 0 ? (
              <Text className="text-sm text-red-600">{t.restore.failed(counts.failed)}</Text>
            ) : null}
            {counts && counts.corrupt > 0 ? (
              <Text className="text-sm text-red-600">{t.restore.corrupt(counts.corrupt)}</Text>
            ) : null}
            {phase === "running" ? (
              <>
                <Text className="text-xs text-neutral-500">{t.restore.keepOpen}</Text>
                <Button
                  variant="secondary"
                  label={t.restore.pause}
                  onPress={() => {
                    stopRef.current = true;
                  }}
                />
              </>
            ) : null}
            {phase === "paused" ? (
              <>
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm text-neutral-900 dark:text-white">
                    {t.restore.wifiOnly}
                  </Text>
                  <Switch value={wifiOnly} onValueChange={setWifiOnly} />
                </View>
                <Button label={t.restore.resume} onPress={resume} />
              </>
            ) : null}
            {phase === "finished" && counts && counts.failed + counts.corrupt > 0 ? (
              <Button label={t.restore.retry} onPress={resume} />
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
