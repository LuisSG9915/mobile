import { execSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { uniqueEmail } from "./helpers";

const API_URL = "http://localhost:8787";
const WEB_ORIGIN = "http://localhost:8081";
const dirname = __dirname;

/**
 * Lee el token que better-auth guardó en la D1 local del wrangler dev.
 * En e2e no hay RESEND_API_KEY: el correo se loguea en wrangler y el token
 * se recupera de la tabla `verification` (misma SQLite que usa el server).
 * Reintenta un par de veces por si el fs del dev tarda en comprometer la fila.
 */
function readResetToken(): string | null {
  for (let i = 0; i < 3; i++) {
    try {
      const out = execSync(
        "node ../../node_modules/wrangler/bin/wrangler.js d1 execute photos-db --local --json --command \"SELECT identifier FROM verification WHERE identifier LIKE 'reset-password:%' ORDER BY rowid DESC LIMIT 1\"",
        { cwd: path.join(dirname, "../../api") },
      ).toString();
      const results = JSON.parse(out)?.[0]?.results ?? [];
      const identifier = results[0]?.identifier as string | undefined;
      if (identifier?.startsWith("reset-password:")) {
        return identifier.slice("reset-password:".length);
      }
    } catch {
      // SQLITE_BUSY o wrangler arrancando: reintenta abajo.
    }
    execSync('node -e "setTimeout(()=>{},800)"');
  }
  return null;
}

test.describe("reset de contraseña (web)", () => {
  test("olvidé contraseña → enlace del correo → nueva clave → login", async ({ page }) => {
    const email = uniqueEmail();
    const oldPassword = "clave-vieja-123";
    const newPassword = "clave-nueva-456";

    // Registro directo por API: este spec no prueba el formulario de registro.
    const signUp = await fetch(`${API_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB_ORIGIN },
      body: JSON.stringify({ email, password: oldPassword, name: "E2E Reset" }),
    });
    expect(signUp.status).toBe(200);

    // 1) Login → "¿Olvidaste tu contraseña?" → formulario de solicitud.
    await page.goto("/login");
    await page
      .getByText("¿Olvidaste tu contraseña?", { exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page.locator('input[autocomplete="email"]:visible').fill(email);
    await page
      .getByText("Enviar enlace", { exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await expect(
      page.getByText("Revisa tu correo", { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();

    // 2) El correo lleva al callback del API; el 302 aterriza en la app web.
    const token = readResetToken();
    expect(token).toBeTruthy();
    await page.goto(
      `${API_URL}/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(`${WEB_ORIGIN}/reset-password`)}`,
    );
    await page.waitForURL(/reset-password\?token=/);

    // 3) Formulario de nueva contraseña (dos campos autocomplete="new-password").
    const fields = page.locator('input[autocomplete="new-password"]:visible');
    await fields.nth(0).fill(newPassword);
    await fields.nth(1).fill(newPassword);
    await page
      .getByText("Restablecer contraseña", { exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await expect(
      page
        .getByText("Contraseña actualizada. Ya puedes iniciar sesión.", { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();

    // 4) La sesión anterior quedó revocada y la nueva clave funciona.
    await page
      .getByText("Volver a iniciar sesión", { exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page.locator('input[autocomplete="email"]:visible').fill(email);
    await page.locator('input[autocomplete="password"]:visible').fill(newPassword);
    await page
      .getByText("Iniciar sesión", { exact: true })
      .filter({ visible: true })
      .last()
      .click();
    await page.getByText("Continuar", { exact: true }).filter({ visible: true }).last().click();
    await expect(
      page
        .getByText("Aún no hay fotos respaldadas", { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
