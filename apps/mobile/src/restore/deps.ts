import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Network from "expo-network";
import { api } from "../api/client";
import { sha256File } from "../queue/hash";
import type { RestoreDeps } from "./processor";

/** Dependencias reales (Android/iOS). `wifiOnly` exige Wi-Fi o Ethernet. */
export function createRestoreDeps(opts: { wifiOnly: () => boolean }): RestoreDeps {
  return {
    getDownload: (id) => api.downloadMedia(id),
    async download(url, localName) {
      const target = `${FileSystem.cacheDirectory}${localName}`;
      const { uri, status } = await FileSystem.downloadAsync(url, target);
      if (status >= 400) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        throw new Error(`Descarga fallida (${status})`);
      }
      return uri;
    },
    sha256: sha256File,
    async saveToLibrary(uri) {
      const perm = await MediaLibrary.getPermissionsAsync();
      if (!perm.granted && !(await MediaLibrary.requestPermissionsAsync()).granted) {
        throw new Error("Permiso denegado para guardar en la galería");
      }
      await MediaLibrary.createAssetAsync(uri);
    },
    deleteFile: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
    freeBytes: () => FileSystem.getFreeDiskStorageAsync(),
    async networkOk() {
      const s = await Network.getNetworkStateAsync();
      if (!s.isConnected) return false;
      if (!opts.wifiOnly()) return true;
      return (
        s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET
      );
    },
  };
}
