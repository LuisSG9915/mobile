import { ADMIN_EMAIL } from "@photos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import {
  ChevronRight,
  Database,
  Download,
  HardDrive,
  Laptop,
  Smartphone,
  Sparkles,
  Trash2,
  UserX,
} from "lucide-react-native";
import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../../api/client";
import { useSession } from "../../auth/client";
import { t } from "../../i18n/es";
import { useQueueEvents } from "../../lib/events";
import { formatBytes, formatRelative } from "../../lib/format";
import { freeSyncedSpace, getSyncedLocal } from "../../lib/free-space";
import { invalidateMediaLifecycleQueries } from "../../lib/query-client";
import { appBuild, appVersion } from "../../lib/telemetry";
import { performLogout } from "../../queue/logout";
import { Button, Card } from "../../ui";

const isWeb = Platform.OS === "web";
const buildLabel = appBuild();

export default function SettingsScreen() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  // La cuota real la lleva user_storage_stats (incluye la papelera, que sigue
  // ocupando R2 hasta la purga) — no el SUM de /v1/stats que excluye borrados.
  const storage = useQuery({ queryKey: ["storage"], queryFn: api.userStorage });
  const sessions = useQuery({ queryKey: ["user-sessions"], queryFn: api.userSessions });
  useQueueEvents((s) => s.tick); // re-render al liberar/cambiar la cola

  const revokeSessionMut = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["user-sessions"] });
      toast.success("Sesión revocada");
    },
    onError: (err: Error) => toast.error(err.message || t.auth.genericError),
  });

  const [exporting, setExporting] = useState(false);
  const handleExportData = async () => {
    setExporting(true);
    try {
      const data = await api.exportUserData();
      const jsonStr = JSON.stringify(data, null, 2);
      if (isWeb) {
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `photos-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Datos exportados en JSON");
      } else {
        const fileUri = `${FileSystem.cacheDirectory}photos-export-${Date.now()}.json`;
        await FileSystem.writeAsStringAsync(fileUri, jsonStr, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: "application/json",
            dialogTitle: "Exportación de datos de Photos",
            UTI: "public.json",
          });
        }
        toast.success("Datos exportados");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al exportar datos";
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  };

  const [deletingAccount, setDeletingAccount] = useState(false);
  const executeDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      const res = await api.deleteAccount();
      toast.success(res.message || "Cuenta eliminada");
      const userId = session?.user?.id ?? "";
      await performLogout(userId);
      router.replace("/welcome");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "No se pudo eliminar la cuenta";
      toast.error(msg);
      setDeletingAccount(false);
    }
  };

  const handleDeleteAccount = () => {
    const msg =
      "¿Estás completamente seguro de que deseas eliminar tu cuenta? Esta acción es irreversible: se borrarán definitivamente todas tus fotos, álbumes y datos de la nube.";
    if (isWeb) {
      if (
        window.confirm(msg) &&
        window.confirm("Confirmación final: ¿proceder con el borrado definitivo?")
      ) {
        void executeDeleteAccount();
      }
      return;
    }
    Alert.alert("Eliminar cuenta definitivamente", msg, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar definitivamente",
        style: "destructive",
        onPress: () => {
          Alert.alert(
            "Confirmación final",
            "Tus fotos y datos en la nube se perderán para siempre. ¿Deseas continuar?",
            [
              { text: "Cancelar", style: "cancel" },
              {
                text: "Sí, borrar todo",
                style: "destructive",
                onPress: () => void executeDeleteAccount(),
              },
            ],
          );
        },
      },
    ]);
  };

  // En web no hay copia local que liberar (el blob se borra al terminar).
  const syncedLocal = isWeb ? { assetIds: [], totalBytes: 0 } : getSyncedLocal();

  const executeFreeSpace = (olderThanDays?: number) => {
    const { assetIds, totalBytes } = getSyncedLocal(olderThanDays);
    if (!assetIds.length) {
      toast.info("No hay elementos respaldados que coincidan con ese criterio.");
      return;
    }
    const size = formatBytes(totalBytes);
    const title = olderThanDays ? `Liberar fotos > ${olderThanDays} días` : t.backup.freeSpace;
    Alert.alert(title, t.backup.freeSpaceConfirm(assetIds.length, size), [
      { text: "Cancelar", style: "cancel" },
      {
        text: t.backup.freeSpace,
        style: "destructive",
        onPress: () => {
          void freeSyncedSpace(olderThanDays, true).then((n) => {
            if (n > 0) {
              toast.success(t.backup.freed(n, size));
              void invalidateMediaLifecycleQueries(qc);
            }
          });
        },
      },
    ]);
  };

  const freeSpace = () => {
    const { assetIds } = getSyncedLocal();
    if (!assetIds.length) return;
    Alert.alert(
      t.backup.freeSpace,
      "Elige qué fotos respaldadas deseas eliminar de este dispositivo para liberar espacio local:",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Con más de 60 días", onPress: () => executeFreeSpace(60) },
        { text: "Con más de 30 días", onPress: () => executeFreeSpace(30) },
        {
          text: "Todo lo respaldado",
          style: "destructive",
          onPress: () => executeFreeSpace(undefined),
        },
      ],
    );
  };

  const doLogout = async () => {
    // Capturar antes de que la sesión desaparezca: performLogout lo usa para
    // borrar los pendientes locales del usuario en web (wipeUserQueue).
    const userId = session?.user?.id ?? "";
    await performLogout(userId);
    router.replace("/welcome");
  };

  const logout = () => {
    // Alert.alert no existe en react-native-web
    if (Platform.OS === "web") {
      if (window.confirm(t.auth.logoutConfirmWeb)) void doLogout();
      return;
    }
    Alert.alert(t.auth.logout, t.auth.logoutConfirm, [
      { text: "Cancelar", style: "cancel" },
      { text: t.auth.logout, style: "destructive", onPress: () => void doLogout() },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top"]}>
      <ScrollView contentContainerClassName="px-5 py-6 gap-5">
        <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
          {t.settings.title}
        </Text>

        <Card className="gap-1">
          <Text className="text-xs font-semibold text-neutral-400 uppercase">
            {t.settings.account}
          </Text>
          <Text className="text-lg font-semibold text-neutral-900 dark:text-white mt-1">
            {session?.user.name}
          </Text>
          <Text className="text-sm text-neutral-500">{session?.user.email}</Text>
        </Card>

        <Card className="gap-3">
          <Text className="text-xs font-semibold text-neutral-400 uppercase">
            {t.settings.storage}
          </Text>
          <View className="h-2.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
            <View
              className="h-full bg-accent rounded-full"
              style={{
                width: `${Math.min(100, storage.data?.usedPercent ?? 0)}%`,
              }}
            />
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-neutral-600 dark:text-neutral-300">
              {t.settings.storageUsed(formatBytes(storage.data?.usedBytes ?? 0))}
            </Text>
            <Text className="text-sm text-neutral-500">
              {t.settings.photosBackedUp(stats.data?.count ?? 0)}
            </Text>
          </View>
          {stats.data?.lastUploadAt ? (
            <Text className="text-xs text-neutral-400">
              {t.backup.lastBackup(formatRelative(stats.data.lastUploadAt))}
            </Text>
          ) : null}
        </Card>

        {syncedLocal.assetIds.length > 0 ? (
          <Card className="gap-3">
            <View className="flex-row items-center gap-2">
              <HardDrive size={16} color="#4f46e5" />
              <Text className="text-base font-semibold text-neutral-900 dark:text-white">
                {t.settings.freeSpace}
              </Text>
            </View>
            <Text className="text-sm text-neutral-500">
              {t.settings.freeSpaceHint(formatBytes(syncedLocal.totalBytes))}
            </Text>
            <Button label={t.settings.freeSpaceAction} variant="ghost" onPress={freeSpace} />
          </Card>
        ) : null}

        <Pressable onPress={() => router.push("/cleaner")} accessibilityRole="button">
          <Card className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <Sparkles size={18} color="#6366f1" />
              <View>
                <Text className="text-base font-semibold text-neutral-900 dark:text-white">
                  {t.settings.cleaner}
                </Text>
                <Text className="text-xs text-neutral-500">{t.settings.cleanerHint}</Text>
              </View>
            </View>
            <ChevronRight size={18} color="#a3a3a3" />
          </Card>
        </Pressable>

        <Pressable onPress={() => router.push("/trash")} accessibilityRole="button">
          <Card className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <Trash2 size={18} color="#a3a3a3" />
              <View>
                <Text className="text-base font-semibold text-neutral-900 dark:text-white">
                  {t.settings.trash}
                </Text>
                <Text className="text-xs text-neutral-500">{t.trash.body}</Text>
              </View>
            </View>
            <ChevronRight size={18} color="#a3a3a3" />
          </Card>
        </Pressable>

        {ADMIN_EMAIL && session?.user.email === ADMIN_EMAIL ? (
          <Pressable onPress={() => router.push("/admin")} accessibilityRole="button">
            <Card className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-3">
                <Database size={18} color="#a3a3a3" />
                <View>
                  <Text className="text-base font-semibold text-neutral-900 dark:text-white">
                    {t.settings.admin}
                  </Text>
                  <Text className="text-xs text-neutral-500">{t.settings.adminHint}</Text>
                </View>
              </View>
              <ChevronRight size={18} color="#a3a3a3" />
            </Card>
          </Pressable>
        ) : null}

        {/* Sesiones activas */}
        <Card className="gap-3">
          <Text className="text-xs font-semibold text-neutral-400 uppercase">Sesiones activas</Text>
          <Text className="text-xs text-neutral-500">
            Dispositivos con acceso a tu cuenta. Puedes revocar el acceso en cualquier momento.
          </Text>
          {sessions.data?.sessions.map((s) => (
            <View
              key={s.id}
              className="flex-row items-center justify-between py-2 border-t border-neutral-100 dark:border-neutral-800"
            >
              <View className="flex-row items-center gap-3 flex-1 mr-2">
                {s.userAgent?.includes("Mobile") || s.userAgent?.includes("Android") ? (
                  <Smartphone size={18} color="#6366f1" />
                ) : (
                  <Laptop size={18} color="#6366f1" />
                )}
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text
                      className="text-sm font-semibold text-neutral-900 dark:text-white"
                      numberOfLines={1}
                    >
                      {s.isCurrent
                        ? "Esta sesión (actual)"
                        : s.userAgent
                          ? s.userAgent.slice(0, 30)
                          : "Dispositivo"}
                    </Text>
                  </View>
                  <Text className="text-xs text-neutral-400 mt-0.5">
                    {s.ipAddress ? `IP ${s.ipAddress} · ` : ""}
                    Iniciada el {new Date(s.createdAt).toLocaleDateString("es")}
                  </Text>
                </View>
              </View>
              {!s.isCurrent ? (
                <Button
                  label="Revocar"
                  variant="ghost"
                  loading={revokeSessionMut.isPending}
                  onPress={() => revokeSessionMut.mutate(s.id)}
                />
              ) : (
                <View className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                  <Text className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    Activa
                  </Text>
                </View>
              )}
            </View>
          ))}
        </Card>

        {/* Portabilidad y privacidad de datos */}
        <Card className="gap-3">
          <View className="flex-row items-center gap-2.5">
            <Download size={18} color="#4f46e5" />
            <Text className="text-base font-semibold text-neutral-900 dark:text-white">
              Exportar mis datos (GDPR)
            </Text>
          </View>
          <Text className="text-xs text-neutral-500 leading-relaxed">
            Descarga un archivo con todos los metadatos de tus fotos, álbumes, lugares y enlaces de
            descarga directa de tus archivos originales.
          </Text>
          <Button
            label="Descargar exportación completa"
            variant="ghost"
            loading={exporting}
            disabled={exporting}
            onPress={handleExportData}
          />
        </Card>

        {/* Zona de peligro: Eliminar cuenta */}
        <Card className="gap-3 border border-red-200 dark:border-red-900/50 bg-red-50/30 dark:bg-red-950/20">
          <View className="flex-row items-center gap-2.5">
            <UserX size={18} color="#ef4444" />
            <Text className="text-base font-semibold text-red-600 dark:text-red-400">
              Eliminar cuenta
            </Text>
          </View>
          <Text className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
            Elimina tu usuario, credenciales, álbumes y borra permanentemente todos tus archivos y
            fotos en el almacenamiento en la nube.
          </Text>
          <Button
            label="Eliminar mi cuenta definitivamente"
            variant="danger"
            loading={deletingAccount}
            disabled={deletingAccount}
            onPress={handleDeleteAccount}
          />
        </Card>

        <Button label={t.auth.logout} variant="ghost" onPress={logout} />

        <Text className="text-xs text-neutral-400 text-center">
          {t.settings.version} {appVersion()}
          {buildLabel ? ` (${buildLabel})` : ""} · Photos
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
