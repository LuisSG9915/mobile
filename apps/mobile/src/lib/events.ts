import { create } from "zustand";

/** Evento simple: cada emit() incrementa el contador para re-renderizar/hooks. */
type QueueEvents = { tick: number; emit: () => void };

export const useQueueEvents = create<QueueEvents>((set) => ({
  tick: 0,
  emit: () => set((s) => ({ tick: s.tick + 1 })),
}));

/**
 * Cambios en la biblioteca local (MediaLibrary): escaneo de assets nuevos o
 * "Liberar espacio" borrando copias locales. La galería híbrida re-lista los
 * assets solo ante este evento — no ante cada tick de la cola (caro).
 */
export const useLibraryEvents = create<QueueEvents>((set) => ({
  tick: 0,
  emit: () => set((s) => ({ tick: s.tick + 1 })),
}));
