import type { IntegrityIssue, IntegrityReport } from "@photos/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { t } from "../i18n/es";
import { formatBytes, formatDateTime } from "../lib/format";
import { toUserMessage } from "../lib/user-message";
import { Button, Card, ErrorState } from "../ui";

/** Tope de seguridad: 500 objetos por página → 5.000.000 originales; evita un bucle infinito. */
const MAX_PAGES = 10_000;

function IssueRow({ issue }: { issue: IntegrityIssue }) {
  return (
    <View className="py-2 border-b border-neutral-200 dark:border-neutral-800">
      <Text className="text-sm text-neutral-900 dark:text-white">
        {issue.mediaType === "video" ? "Video" : "Foto"} · {formatDateTime(issue.takenAt)}
      </Text>
      <Text className="text-xs text-neutral-500">
        {issue.actualSize !== undefined
          ? t.integrity.expected(formatBytes(issue.expectedSize), formatBytes(issue.actualSize))
          : t.integrity.expectedOnly(formatBytes(issue.expectedSize))}
      </Text>
    </View>
  );
}

export default function IntegrityScreen() {
  const qc = useQueryClient();
  const last = useQuery({ queryKey: ["integrity"], queryFn: api.integrityLast });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<IntegrityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    cancelled.current = false;
    try {
      let startAfter: string | undefined;
      for (let i = 0; i < MAX_PAGES && !cancelled.current; i++) {
        const res = await api.integrityScan(startAfter ? { startAfter } : {});
        setProgress(res.report);
        if (res.next === null) break;
        startAfter = res.next;
      }
      await qc.invalidateQueries({ queryKey: ["integrity"] });
    } catch (e) {
      setError(toUserMessage(e, t.integrity.failed));
    } finally {
      setRunning(false);
    }
  }, [qc]);

  const report = running ? progress : (last.data?.report ?? null);
  const done = report?.checkedAt != null;
  const problems = (report?.missingCount ?? 0) + (report?.sizeMismatchCount ?? 0);

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top", "bottom"]}>
      <ScrollView contentContainerClassName="px-5 py-4 gap-4">
        <View className="gap-1">
          <Text className="text-2xl font-bold text-neutral-900 dark:text-white">
            {t.integrity.title}
          </Text>
          <Text className="text-sm text-neutral-500">{t.integrity.body}</Text>
        </View>

        {last.isError && !running ? (
          <ErrorState onRetry={() => void last.refetch()} />
        ) : (
          <Card className="gap-3">
            {running ? (
              <View className="flex-row items-center gap-3">
                <ActivityIndicator color="#4f46e5" />
                <Text className="text-sm text-neutral-700 dark:text-neutral-300">
                  {t.integrity.running(report?.checked ?? 0)}
                </Text>
              </View>
            ) : report && done ? (
              <>
                <Text className="text-lg font-bold text-neutral-900 dark:text-white">
                  {problems === 0
                    ? t.integrity.allGood
                    : report.missingCount > 0
                      ? t.integrity.missing(report.missingCount)
                      : t.integrity.mismatch(report.sizeMismatchCount)}
                </Text>
                {problems === 0 ? (
                  <Text className="text-sm text-neutral-500">
                    {t.integrity.allGoodBody(report.checked)}
                  </Text>
                ) : report.missingCount > 0 && report.sizeMismatchCount > 0 ? (
                  <Text className="text-sm text-neutral-500">
                    {t.integrity.mismatch(report.sizeMismatchCount)}
                  </Text>
                ) : null}
                <Text className="text-xs text-neutral-500">
                  {t.integrity.lastCheck(formatDateTime(report.checkedAt ?? 0))}
                </Text>
              </>
            ) : (
              <Text className="text-sm text-neutral-500">
                {last.isPending ? "…" : t.integrity.never}
              </Text>
            )}
            {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
            <Button label={t.integrity.start} loading={running} onPress={() => void run()} />
          </Card>
        )}

        {!running && report && done && report.missing.length > 0 ? (
          <Card>
            <Text className="text-sm font-semibold text-neutral-900 dark:text-white mb-1">
              {t.integrity.missing(report.missingCount)}
            </Text>
            {report.missing.map((i) => (
              <IssueRow key={i.id} issue={i} />
            ))}
            {report.missingCount > report.missing.length ? (
              <Text className="text-xs text-neutral-500 mt-2">{t.integrity.listCapped}</Text>
            ) : null}
          </Card>
        ) : null}

        {!running && report && done && report.sizeMismatch.length > 0 ? (
          <Card>
            <Text className="text-sm font-semibold text-neutral-900 dark:text-white mb-1">
              {t.integrity.mismatch(report.sizeMismatchCount)}
            </Text>
            {report.sizeMismatch.map((i) => (
              <IssueRow key={i.id} issue={i} />
            ))}
            {report.sizeMismatchCount > report.sizeMismatch.length ? (
              <Text className="text-xs text-neutral-500 mt-2">{t.integrity.listCapped}</Text>
            ) : null}
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
