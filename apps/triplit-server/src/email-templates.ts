/**
 * HTML + plaintext templates for transactional emails.
 *
 * Kept inline (no JSX, no template engine) so the auth boot stays free of
 * extra deps. Images are served by this same server (`/email/*`, see
 * server.ts) and referenced by absolute URL off `AUTH_BASE_URL`, so they
 * don't depend on the web frontend being deployed. Layout uses table-based
 * structure to render predictably across Gmail, Outlook, Apple Mail.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface MagicLinkEmail {
  subject: string;
  html: string;
  text: string;
}

export type MagicLinkMode = 'signup' | 'signin';

export function renderMagicLinkEmail(params: {
  url: string;
  assetBase: string;
  mode: MagicLinkMode;
}): MagicLinkEmail {
  const safeUrl = escapeHtml(params.url);
  const logoUrl = `${params.assetBase.replace(/\/$/, '')}/email/innerio-logo.png`;

  const isSignup = params.mode === 'signup';
  const subject = isSignup ? 'Bienvenido a Innerio' : 'Tu enlace de acceso a Innerio';
  const heading = isSignup ? '¡Bienvenido a Innerio!' : 'Vuelve a entrar';
  const lede = isSignup
    ? 'Gracias por unirte. Pulsa el botón para entrar sin contraseñas, sólo este enlace temporal.'
    : 'Pulsa el botón para iniciar sesión en este dispositivo. Caduca en 5 minutos.';
  const cta = isSignup ? 'Entrar a Innerio' : 'Iniciar sesión';
  const plainHeading = isSignup ? '¡Bienvenido a Innerio!' : 'Tu enlace para iniciar sesión';
  const plainLede = isSignup
    ? 'Gracias por unirte. Para entrar, abre este enlace en tu navegador:'
    : 'Para iniciar sesión, abre este enlace en tu navegador:';

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f5f4;padding:48px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;background:#ffffff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.04);overflow:hidden;">
        <tr>
          <td align="center" style="padding:40px 32px 8px 32px;">
            <img src="${logoUrl}" alt="Innerio" width="72" height="72" style="display:block;border:0;outline:none;border-radius:16px;">
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 0 32px;">
            <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:600;text-align:center;color:#1a1a1a;letter-spacing:-0.01em;">${heading}</h1>
            <p style="margin:0;font-size:15px;line-height:1.5;color:#52525b;text-align:center;">
              ${lede}
            </p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:28px 32px 8px 32px;">
            <a href="${safeUrl}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 36px;border-radius:10px;font-size:15px;letter-spacing:0.01em;">${cta}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 24px 32px;">
            <p style="margin:16px 0 0 0;font-size:13px;line-height:1.5;color:#a1a1aa;text-align:center;">
              El enlace caduca en 5 minutos. Si no lo solicitaste, puedes ignorar este email.
            </p>
            <p style="margin:16px 0 0 0;font-size:11px;line-height:1.5;color:#a1a1aa;text-align:center;word-break:break-all;">
              ¿No funciona el botón? Copia y pega:<br>
              <span style="color:#71717a;">${safeUrl}</span>
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0 0;font-size:11px;color:#a1a1aa;text-align:center;letter-spacing:0.04em;">
        Innerio &nbsp;·&nbsp; <span style="color:#d4d4d8;">42</span>
      </p>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = `${plainHeading}

${plainLede}

${params.url}

El enlace caduca en 5 minutos. Si no lo solicitaste, puedes ignorar este email.

—
Innerio · 42
`;

  return { subject, html, text };
}
