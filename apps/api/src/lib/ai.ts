import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { Bindings } from "../env";
import { parseTags } from "../routes/media";

/**
 * Limpia y normaliza una etiqueta individual.
 */
function cleanTag(raw: string): string | null {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/^[-*•#\d.)\s]+/, "")
    .replace(/["'“”]/g, "")
    .trim();
  if (t.length < 2 || t.length > 30) return null;
  if (t.includes("http") || t.includes("://") || t.includes("imagen") || t.includes("foto")) {
    return null;
  }
  return t;
}

/**
 * Analiza la miniatura de una foto o video mediante Cloudflare Workers AI
 * y genera etiquetas visuales descriptivas sin coste adicional (10,000 neuronas/día gratis).
 */
export async function generateImageTags(env: Bindings, r2KeyThumb: string): Promise<string[]> {
  if (!env.AI) return [];

  const thumbObj = await env.BUCKET.get(r2KeyThumb);
  if (!thumbObj) return [];

  const buffer = await thumbObj.arrayBuffer();
  const image = [...new Uint8Array(buffer)];

  // Intento 1: Modelo multimodal abierto LLaVA en Workers AI (genera conceptos en español)
  try {
    const prompt =
      "Identifica los sujetos, objetos, paisajes o conceptos principales de esta imagen. Devuelve entre 3 y 6 palabras clave descriptivas en español en minúsculas separadas únicamente por comas (ejemplo: perro, césped, parque, mascota, comida, playa). No escribas oraciones completas ni texto introductorio.";

    const res = (await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
      image,
      prompt,
      max_tokens: 60,
    }).catch((err) => {
      console.warn("workers_ai_llava_failed_attempting_fallback", err);
      return null;
    })) as Record<string, unknown> | null;

    const resultObj =
      res && typeof res.result === "object" && res.result !== null
        ? (res.result as Record<string, unknown>)
        : null;

    const rawText =
      typeof res?.description === "string"
        ? res.description
        : typeof resultObj?.description === "string"
          ? resultObj.description
          : typeof res?.response === "string"
            ? res.response
            : "";

    const candidates = rawText
      .split(/[,\n]/)
      .map(cleanTag)
      .filter((t): t is string => Boolean(t));

    if (candidates.length > 0) {
      return Array.from(new Set(candidates)).slice(0, 8);
    }
  } catch (err) {
    console.warn("workers_ai_llava_failed_attempting_fallback", err);
  }

  // Intento 2 (Fallback rápido): ResNet-50 para clasificación determinista de objetos
  try {
    const resnet = (await env.AI.run("@cf/microsoft/resnet-50", {
      image,
    }).catch((err) => {
      console.warn("workers_ai_resnet_fallback_failed", err);
      return null;
    })) as Array<{ label: string; score: number }> | null;

    if (Array.isArray(resnet)) {
      const top = resnet
        .filter((item) => item.score >= 0.15)
        .map((item) => cleanTag(item.label.split(",")[0] ?? ""))
        .filter((t): t is string => Boolean(t));

      if (top.length > 0) {
        return Array.from(new Set(top)).slice(0, 5);
      }
    }
  } catch (err) {
    console.warn("workers_ai_resnet_fallback_failed", err);
  }

  return [];
}

/**
 * Procesa un elemento multimedia ya subido y 'ready', genera sus etiquetas con IA
 * y las guarda en la base de datos fusionadas con cualquier etiqueta previa.
 */
export async function tagMediaItem(
  env: Bindings,
  mediaId: string,
  userId: string,
): Promise<string[]> {
  const db = getDb(env.DB);
  const row = await db
    .select({
      id: media.id,
      r2KeyThumb: media.r2KeyThumb,
      tags: media.tags,
      status: media.status,
      deletedAt: media.deletedAt,
    })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.userId, userId), isNull(media.deletedAt)))
    .get();

  if (row?.status !== "ready") {
    return [];
  }

  const existingTags = parseTags(row.tags);
  const aiTags = await generateImageTags(env, row.r2KeyThumb);

  if (aiTags.length === 0) {
    return existingTags;
  }

  // Fusión sin duplicados conservando el orden de las etiquetas previas del usuario
  const merged = Array.from(new Set([...existingTags, ...aiTags])).slice(0, 20);

  const docKeywords = [
    "documento",
    "document",
    "recibo",
    "factura",
    "texto",
    "papel",
    "hoja",
    "libro",
    "comprobante",
  ];
  const isDoc = merged.some((tag) => docKeywords.some((kw) => tag.includes(kw)));
  const shotKeywords = ["captura", "screenshot", "pantalla"];
  const isShot = merged.some((tag) => shotKeywords.some((kw) => tag.includes(kw)));

  const updates: Record<string, unknown> = {
    tags: JSON.stringify(merged),
    updatedAt: Date.now(),
  };
  if (isDoc) updates.isDocument = true;
  if (isShot) updates.isScreenshot = true;

  if (merged.length !== existingTags.length || isDoc || isShot) {
    await db.update(media).set(updates).where(eq(media.id, row.id));
  }

  return merged;
}
