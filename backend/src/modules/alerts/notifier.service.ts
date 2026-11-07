import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SettingsService } from '../settings/settings.service';

/** Email (nodemailer, only when SMTP configured) and webhook delivery. Failures are logged, never thrown. */
@Injectable()
export class NotifierService {
  private readonly log = new Logger(NotifierService.name);
  constructor(private readonly settings: SettingsService) {}

  async smtpConfigured(): Promise<boolean> {
    const s = await this.settings.get();
    return !!(s.smtpHost || process.env.SMTP_HOST);
  }

  async sendMail(to: string[], subject: string, text: string, attachments?: { filename: string; path: string }[]): Promise<boolean> {
    const recipients = to.map((x) => x.trim()).filter(Boolean);
    if (!recipients.length) return false;
    const s = await this.settings.get();
    const host = s.smtpHost || process.env.SMTP_HOST;
    if (!host) return false;
    try {
      const port = s.smtpPort || parseInt(process.env.SMTP_PORT || '587', 10);
      const user = s.smtpUser || process.env.SMTP_USER;
      const pass = await this.settings.smtpPassword();
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
        connectionTimeout: 10000,
      });
      await transport.sendMail({
        from: s.smtpFrom || process.env.SMTP_FROM || `no-reply@congruence.in`,
        to: recipients.join(','),
        subject,
        text,
        attachments,
      });
      return true;
    } catch (e) {
      this.log.warn(`email failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** Fire-and-forget POST with a 5s timeout. */
  webhook(url: string, payload: unknown): void {
    if (!url) return;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    }).catch((e: Error) => this.log.warn(`webhook ${url} failed: ${e.message}`));
  }
}
