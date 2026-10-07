/**
 * En web la descarga la gestiona el navegador: se crea un enlace invisible
 * con el atributo `download` (el Content-Disposition: attachment de la URL
 * prefirmada refuerza el mismo comportamiento).
 */
export async function saveDownload(url: string, filename: string): Promise<void> {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
