/**
 * Motor del pipeline de pruebas: ejecuta los pasos y devuelve el registro de
 * corridas. Es importable para que test-pipeline.test.mjs lo pruebe con
 * comandos simulados sin tocar wrangler/expo/R2 reales.
 *
 * Cada step:
 *   {
 *     layer: string,
 *     command?: string,        // comando a ejecutar (shell)
 *     cwd?: string, env?: object,
 *     preCommand?: string,     // preparación previa; si falla el step falla
 *     preCwd?: string, preEnv?: object,
 *     manual?: boolean,        // capa manual (checklist nativo)
 *     template?: string,       // plantilla a copiar a outDir/native.json
 *   }
 *
 * Devuelve runs[] = { layer, command, exitCode, durationMs, skipped?, note? }
 * exitCode null = no se ejecutó (skip o manual).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

export function runCmd(command, { cwd, env } = {}) {
  const started = Date.now();
  const res = spawnSync(command, {
    cwd,
    shell: true,
    stdio: "inherit",
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { exitCode: res.status ?? 1, durationMs: Date.now() - started };
}

export function runSteps(steps, { skip = new Set(), outDir, log = console.log } = {}) {
  const runs = [];
  for (const step of steps) {
    if (skip.has(step.layer)) {
      log(`\n— ${step.layer}: omitida`);
      runs.push({
        layer: step.layer,
        command: step.command ?? null,
        exitCode: null,
        durationMs: 0,
        skipped: true,
      });
      continue;
    }
    if (step.manual) {
      const target = path.join(outDir, "native.json");
      if (!existsSync(target) && step.template && existsSync(step.template)) {
        copyFileSync(step.template, target);
        log(`\n— ${step.layer}: plantilla copiada a ${target} (rellenar status a mano)`);
      }
      runs.push({ layer: step.layer, command: null, exitCode: null, durationMs: 0 });
      continue;
    }
    log(`\n=== ${step.layer}: ${step.command} ===`);
    if (step.preCommand) {
      const pre = runCmd(step.preCommand, { cwd: step.preCwd, env: step.preEnv });
      if (pre.exitCode !== 0) {
        // La preparación falló: la capa queda como ejecutada y fallida; el
        // comando real no se lanza (p. ej. E2E sin migraciones aplicadas).
        runs.push({
          layer: step.layer,
          command: step.command,
          exitCode: pre.exitCode,
          durationMs: pre.durationMs,
          note: `falló la preparación: ${step.preCommand}`,
        });
        continue;
      }
    }
    const res = runCmd(step.command, { cwd: step.cwd, env: step.env });
    runs.push({
      layer: step.layer,
      command: step.command,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
    });
  }
  return runs;
}
