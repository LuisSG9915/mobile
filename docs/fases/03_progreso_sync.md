# Fase 3: Monitor de Progreso en Tiempo Real y Anillo en Avatar

## 🎯 Objetivo
Visualizar el avance en bytes de la cola de subida y el anillo de estado circular en el avatar estilo Google Photos.

## 📂 Archivos a Modificar / Crear
1. `apps/mobile/src/queue/types.ts`
2. `apps/mobile/src/queue/processor.ts` y `processor.web.ts`
3. `apps/mobile/src/lib/store.ts`
4. `apps/mobile/src/ui/SyncStatusAvatar.tsx` (Nuevo)
5. `apps/mobile/src/app/(tabs)/_layout.tsx`
6. `apps/mobile/src/app/(tabs)/backup.tsx`

## 🛠️ Especificaciones Técnicas

### 1. Estado en `apps/mobile/src/lib/store.ts`
- Agregar propiedades a la cola:
  ```typescript
  interface SyncProgressState {
    bytesUploaded: number;
    totalBytes: number;
    filesTotal: number;
    filesRemaining: number;
    currentFileName: string;
    status: 'idle' | 'syncing' | 'completed' | 'paused' | 'error';
  }