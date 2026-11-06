import { useEffect, useState } from "react";
import { create } from "zustand";

/** Evento simple: cada emit() incrementa el contador para re-renderizar/hooks. */
type QueueEvents = { tick: number; emit: () => void };

export const useQueueEvents = create<QueueEvents>((set) => ({
  tick: 0,
  emit: () => set((s) => ({ tick: s.tick + 1 })),
}));

/**
 * Tick de cola con throttle EN LA SUSCRIPCIÓN: la cola emite en cada
 * transición de estado (~7 por archivo) y un `useQueueEvents(s => s.tick)`
 * re-renderizaría la pantalla entera por emit. Aquí el setState va dentro
 * del throttle (borde inicial + final), así el componente solo se
 * re-renderiza ~una vez por intervalo sin importar la cadencia de emits.
 */
export function useThrottledQueueTick(intervalMs = 300): number {
  const [tick, setTick] = useState(() => useQueueEvents.getState().tick);
  useEffect(() => {
    let lastFire = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      timer = null;
      lastFire = Date.now();
      setTick(useQueueEvents.getState().tick);
    };
    const unsubscribe = useQueueEvents.subscribe(() => {
      const wait = intervalMs - (Date.now() - lastFire);
      if (wait <= 0) fire();
      else if (timer === null) timer = setTimeout(fire, wait);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [intervalMs]);
  return tick;
}

/**
 * Cambios en la biblioteca local (MediaLibrary): escaneo de assets nuevos o
 * "Liberar espacio" borrando copias locales. La galería híbrida re-lista los
 * assets solo ante este evento — no ante cada tick de la cola (caro).
 */
export const useLibraryEvents = create<QueueEvents>((set) => ({
  tick: 0,
  emit: () => set((s) => ({ tick: s.tick + 1 })),
}));
