// En web no hay biblioteca de medios que escanear: los archivos se encolan
// desde un <input type="file"> (src/web/files.ts).
import type { ScanResult } from "./types";

export type { ScanResult } from "./types";

export async function scanLibrary(): Promise<ScanResult> {
  return { added: 0, skipped: 0 };
}
