import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Playwright transpila el config/setup a CJS: __dirname está disponible.
const dirname = __dirname;

/**
 * Guardarraíl previo a cualquier test: el E2E escribe y borra objetos en un
 * bucket R2 REAL vía el wrangler dev local. Solo puede correr si .dev.vars
 * (o las variables de entorno) apunta al bucket de desarrollo y tiene credenciales;
 * si no, aborta antes de tocar nada.
 */
export default function globalSetup(): void {
  const devVarsPath = path.join(dirname, "../../api/.dev.vars");
  let vars: Record<string, string> = {};

  if (existsSync(devVarsPath)) {
    try {
      vars = Object.fromEntries(
        readFileSync(devVarsPath, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#") && l.includes("="))
          .map((l) => {
            const i = l.indexOf("=");
            return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
          }),
      );
    } catch {
      // Ignora error de lectura si .dev.vars está corrupto/inaccesible
    }
  }

  const accountId = process.env.R2_ACCOUNT_ID || vars.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || vars.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || vars.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME || vars.R2_BUCKET_NAME || "photos-media-dev";

  // Si .dev.vars no existía pero las credenciales vinieron por el entorno, creamos .dev.vars
  // para que wrangler dev pueda arrancar leyéndolas correctamente.
  if (!existsSync(devVarsPath) && accountId && accessKeyId && secretAccessKey) {
    writeFileSync(
      devVarsPath,
      `${[
        `R2_ACCOUNT_ID=${accountId}`,
        `R2_ACCESS_KEY_ID=${accessKeyId}`,
        `R2_SECRET_ACCESS_KEY=${secretAccessKey}`,
        `R2_BUCKET_NAME=${bucketName}`,
        `BETTER_AUTH_SECRET=${process.env.BETTER_AUTH_SECRET || "photos-dev-secret-32-chars-long-e2e!"}`,
        "BETTER_AUTH_URL=http://localhost:8787",
        "WEB_ORIGINS=http://localhost:8081",
        "ADMIN_EMAIL=luis.sg9915@gmail.com",
      ].join("\n")}\n`,
      "utf8",
    );
  }

  if (bucketName !== "photos-media-dev") {
    throw new Error(
      `E2E abortado: R2_BUCKET_NAME="${bucketName ?? "(vacío)"}" no es el bucket de desarrollo photos-media-dev.`,
    );
  }
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "E2E abortado: no se pudo leer apps/api/.dev.vars ni variables de entorno R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).",
    );
  }
}
