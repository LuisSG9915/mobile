import type { Bindings } from "./env";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Envío de correo transaccional. Con RESEND_API_KEY va por la API REST de
 * Resend (fetch plano, sin dependencia). Sin clave —dev/tests— el correo se
 * escribe al log de wrangler para poder copiar el enlace a mano.
 * Nunca lanza: devuelve false si el envío falló (el caller loguea).
 */
export async function sendEmail(env: Bindings, msg: EmailMessage): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    return true;
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM ?? "Photos <onboarding@resend.dev>",
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      console.error(`[email] resend ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] resend fetch failed:", e);
    return false;
  }
}

/** Correo de restablecimiento de contraseña (español, token válido ~1 h). */
export function passwordResetEmail(url: string): Pick<EmailMessage, "subject" | "html" | "text"> {
  const safeUrl = url.replace(/"/g, "&quot;");
  return {
    subject: "Restablece tu contraseña de Photos",
    text: `Hemos recibido una solicitud para restablecer tu contraseña de Photos.\n\nAbre este enlace (válido durante 1 hora):\n${url}\n\nSi no fuiste tú, ignora este correo: tu contraseña no cambiará.`,
    html: `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f5f5f4;font-family:system-ui,-apple-system,sans-serif;color:#171717;">
    <div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;">
      <h1 style="margin:0 0 12px;font-size:22px;">Restablece tu contraseña</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#525252;">
        Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de Photos.
      </p>
      <a href="${safeUrl}" style="display:block;text-align:center;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 20px;border-radius:12px;">
        Restablecer contraseña
      </a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#737373;">
        El enlace es válido durante 1 hora. Si no solicitaste el cambio, ignora este correo:
        tu contraseña no cambiará.
      </p>
      <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#a3a3a3;word-break:break-all;">
        Si el botón no funciona, copia este enlace: ${safeUrl}
      </p>
    </div>
  </body>
</html>`,
  };
}
