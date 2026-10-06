import { readFileSync } from "node:fs";
import path from "node:path";

// Playwright transpila el config/setup a CJS: __dirname está disponible.
const dirname = __dirname;

/**
 * Guardarraíl previo a cualquier test: el E2E escribe y borra objetos en un
 * bucket R2 REAL vía el wrangler dev local. Solo puede correr si .dev.vars
 * apunta al bucket de desarrollo y tiene credenciales; si no, aborta antes de
 * tocar nada.
 */
export default function globalSetup(): void {
  let vars: Record<string, string> = {};
  try {
    vars = Object.fromEntries(
      readFileSync(path.join(dirname, "../../api/.dev.vars"), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    );
  } catch {
    throw new Error(
      "E2E abortado: no se pudo leer apps/api/.dev.vars (credenciales R2 de desarrollo).",
    );
  }
  if (vars.R2_BUCKET_NAME !== "photos-media-dev") {
    throw new Error(
      `E2E abortado: R2_BUCKET_NAME="${vars.R2_BUCKET_NAME ?? "(vacío)"}" no es el bucket de desarrollo photos-media-dev.`,
    );
  }
  if (!vars.R2_ACCOUNT_ID || !vars.R2_ACCESS_KEY_ID || !vars.R2_SECRET_ACCESS_KEY) {
    throw new Error("E2E abortado: faltan credenciales R2 en apps/api/.dev.vars.");
  }
}
