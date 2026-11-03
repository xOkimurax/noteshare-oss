/**
 * Transactional email via Brevo's REST API (no SMTP, no SDK).
 * If BREVO_API_KEY / BREVO_SENDER_EMAIL are empty the email is logged instead of sent, so local
 * dev never breaks on it.
 */
import { env } from '../env.js';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

export interface Mail {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(mail: Mail): Promise<void> {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    console.log(
      `[mailer:disabled] to=${mail.to.email} subject="${mail.subject}"`,
    );
    return;
  }
  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
        to: [mail.to],
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text ?? mail.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      }),
    });
    if (!res.ok) {
      console.error(`Brevo send failed ${res.status}: ${await res.text()}`);
    }
  } catch (e) {
    console.error('Brevo send error', e);
  }
}

/** Minimal branded wrapper around a message + optional call-to-action. */
export function emailLayout(opts: {
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): string {
  const cta =
    opts.ctaLabel && opts.ctaUrl
      ? `<p style="margin:24px 0"><a href="${opts.ctaUrl}" style="background:#059669;color:#fff;text-decoration:none;padding:10px 20px;border-radius:10px;font-weight:600;display:inline-block">${opts.ctaLabel}</a></p>`
      : '';
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#1c1917">
    <div style="font-size:20px;font-weight:700;color:#059669;margin-bottom:16px">Noteshare</div>
    <h1 style="font-size:18px;margin:0 0 8px">${opts.heading}</h1>
    <p style="font-size:14px;line-height:1.5;color:#44403c;margin:0">${opts.body}</p>
    ${cta}
    <p style="font-size:12px;color:#a8a29e;margin-top:32px">Recibís este correo porque alguien compartió o editó una nota con vos en Noteshare.</p>
  </div>`;
}
