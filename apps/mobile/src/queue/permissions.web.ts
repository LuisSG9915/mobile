// En web no existe la biblioteca de medios del SO; la subida es manual.
export async function requestMediaPermissions(): Promise<{ granted: boolean }> {
  return { granted: true };
}
