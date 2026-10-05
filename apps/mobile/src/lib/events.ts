import { create } from "zustand";

/** Evento simple: cada emit() incrementa el contador para re-renderizar/hooks. */
type QueueEvents = { tick: number; emit: () => void };

export const useQueueEvents = create<QueueEvents>((set) => ({
  tick: 0,
  emit: () => set((s) => ({ tick: s.tick + 1 })),
}));
