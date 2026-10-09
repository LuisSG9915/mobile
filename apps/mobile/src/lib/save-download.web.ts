/**
 * En web la descarga la gestiona el navegador.
 * Para garantizar que el navegador respete el nombre y extensión solicitados
 * (como .mp4 en videos descargados de servidores remotos sin redirecciones que
 * los renombren a .jpg/.webp), las URLs remotas se solicitan como Blob creando
 * un objeto URL de mismo origen.
 */
export async function saveDownload(url: string, filename: string): Promise<void> {
  if (url.startsWith("blob:") || url.startsWith("data:")) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Error fetching download");
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
  } catch (err) {
    console.warn("Direct blob download failed, falling back to anchor:", err);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}
