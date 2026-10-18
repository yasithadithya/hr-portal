import nodemailer from 'nodemailer';
import type { Logger } from 'pino';

/** Email provider behind one interface (CLAUDE.md stack: Resend or SMTP). */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

export function smtpSender(url: string, from: string): EmailSender {
  const transport = nodemailer.createTransport(url);
  return {
    async send(msg) {
      await transport.sendMail({ from, ...msg });
    },
  };
}

/** Resend's HTTP API (no SDK needed). */
export function resendSender(apiKey: string, from: string): EmailSender {
  return {
    async send(msg) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, ...msg }),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
    },
  };
}

/** Development default when no provider is configured: write a log line, send nothing. */
export function logSender(logger: Logger): EmailSender {
  return {
    async send(msg) {
      logger.info({ to: msg.to, subject: msg.subject }, 'email (not sent: EMAIL_PROVIDER=log)');
    },
  };
}

export function memorySender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(msg) {
      sent.push(msg);
    },
  };
}

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Branded notification email (company name + brand colour). Plain text alongside. */
export function renderEmail(opts: {
  company: string;
  color: string | null;
  title: string;
  body: string;
  url: string | null;
  action?: string;
}): { html: string; text: string } {
  const color = /^#[0-9a-f]{6}$/i.test(opts.color ?? '') ? opts.color! : '#111827';
  const button = opts.url
    ? `<p style="margin:24px 0"><a href="${escape(opts.url)}" style="background:${color};color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${escape(opts.action ?? 'Open')}</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="height:4px;background:${color}"></td></tr>
<tr><td style="padding:24px 28px">
<p style="margin:0 0 4px;color:#6b7280;font-size:13px">${escape(opts.company)}</p>
<h1 style="margin:0 0 12px;font-size:20px;color:#111827">${escape(opts.title)}</h1>
<p style="margin:0;color:#374151;font-size:15px;line-height:1.5">${escape(opts.body)}</p>
${button}
<p style="margin:24px 0 0;color:#9ca3af;font-size:12px">You can change which emails you get in My HR → Notifications.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${opts.company}\n\n${opts.title}\n\n${opts.body}${opts.url ? `\n\n${opts.action ?? 'Open'}: ${opts.url}` : ''}\n`;
  return { html, text };
}
