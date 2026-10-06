// En web no hay biblioteca de medios que escanear: los archivos se encolan
// desde un <input type="file"> (src/web/files.ts).
export async function scanLibrary(): Promise<number> {
  return 0;
}
