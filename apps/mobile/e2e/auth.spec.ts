import { expect, type Page, test } from "@playwright/test";
import { E2E_PASSWORD, getToken, register, uniqueEmail } from "./helpers";

const EMPTY_GALLERY = "Aún no hay fotos respaldadas";

/** Texto visible: RN-web deja pantallas montadas pero ocultas. */
function visibleText(page: Page, text: string) {
  return page.getByText(text, { exact: true }).filter({ visible: true }).first();
}

/** Click en una pestaña: tiene aria-label via tabBarAccessibilityLabel. */
async function clickTab(page: Page, name: string): Promise<void> {
  const byLabel = page.getByLabel(name, { exact: true }).first();
  try {
    await byLabel.waitFor({ state: "visible", timeout: 10_000 });
    await byLabel.click();
    return;
  } catch {
    // Fallback: la etiqueta de texto de la tab bar (va tras el contenido).
    await page.getByText(name, { exact: true }).filter({ visible: true }).last().click();
  }
}

// Los tests comparten la misma cuenta; cada uno recibe un contexto nuevo
// (localStorage vacío), así que la sesión se inyecta con addInitScript,
// equivalente a lo que hace el cliente web al leer photos.session_token.
test.describe("auth", () => {
  test.describe.configure({ mode: "serial" });
  const email = uniqueEmail();
  let token: string | null = null;

  const withSession = async (page: Page): Promise<void> => {
    await page.addInitScript((t) => {
      if (t) localStorage.setItem("photos.session_token", t);
    }, token);
  };

  test("registro lleva a las tabs y guarda el token", async ({ page }) => {
    await register(page, email);
    token = await getToken(page);
    expect(token).toBeTruthy();
    await expect(visibleText(page, EMPTY_GALLERY)).toBeVisible();
  });

  test("recarga en / con sesión no queda en /welcome", async ({ page }) => {
    await withSession(page);
    await page.goto("/");
    // H-004: 5 s de gracia para detectar una redirección errónea a /welcome.
    await page.waitForTimeout(5000);
    expect(page.url()).not.toMatch(/welcome/);
    await expect(visibleText(page, EMPTY_GALLERY)).toBeVisible();
  });

  test("logout vuelve a /welcome y limpia el token", async ({ page }) => {
    await withSession(page);
    await page.goto("/");
    await expect(visibleText(page, EMPTY_GALLERY)).toBeVisible();

    await clickTab(page, "Ajustes");
    await expect(visibleText(page, "Cerrar sesión")).toBeVisible();

    // El logout web usa window.confirm: hay que aceptar el diálogo.
    page.once("dialog", (d) => void d.accept());
    await page.getByText("Cerrar sesión", { exact: true }).filter({ visible: true }).last().click();

    await expect(page).toHaveURL(/welcome/);
    expect(await getToken(page)).toBeNull();
  });

  test("login con las mismas credenciales vuelve a las tabs", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[autocomplete="email"]:visible').fill(email);
    await page.locator('input[type="password"]:visible').fill(E2E_PASSWORD);
    await page.getByText("Iniciar sesión", { exact: true }).last().click();
    // Igual que tras registrarse: /permissions -> "Continuar" -> tabs.
    await page.getByText("Continuar", { exact: true }).filter({ visible: true }).last().click();
    await expect(visibleText(page, EMPTY_GALLERY)).toBeVisible({ timeout: 60_000 });
    expect(await getToken(page)).toBeTruthy();
  });
});
