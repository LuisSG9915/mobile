import * as MediaLibrary from "expo-media-library/legacy";
import { useSettings } from "../lib/store";
import { enqueueAsset, kvGet, kvSet } from "./db";

/**
 * Descubre assets nuevos y los encola. La primera ejecución recorre toda la
 * biblioteca; las siguientes se detienen al llegar a assets ya conocidos
 * (orden descendente por fecha de creación).
 */
export async function scanLibrary(): Promise<number> {
  const perm = await MediaLibrary.getPermissionsAsync();
  if (!perm.granted) return 0;

  const includeVideos = useSettings.getState().includeVideos;
  const lastScan = Number(kvGet("last_scan_ts") ?? "0");
  const incremental = lastScan > 0;

  let after: string | undefined;
  let added = 0;
  do {
    const page = await MediaLibrary.getAssetsAsync({
      first: 200,
      after,
      mediaType: includeVideos
        ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
        : [MediaLibrary.MediaType.photo],
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    });
    let reachedKnown = false;
    for (const a of page.assets) {
      if (incremental && a.creationTime * 1000 <= lastScan) {
        reachedKnown = true;
        break;
      }
      enqueueAsset({
        id: a.id,
        uri: a.uri,
        filename: a.filename,
        mediaType: a.mediaType === MediaLibrary.MediaType.video ? "video" : "photo",
        creationTime: a.creationTime * 1000,
      });
      added++;
    }
    after = page.hasNextPage ? page.endCursor : undefined;
    if (reachedKnown) break;
  } while (after);

  kvSet("last_scan_ts", String(Date.now()));
  return added;
}
