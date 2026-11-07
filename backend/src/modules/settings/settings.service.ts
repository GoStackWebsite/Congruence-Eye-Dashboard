import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Setting } from './entities/setting.entity';

export interface Settings {
  engagedStoreDwellSec: number;
  bounceSec: number;
  repeatWindowDays: number;
  currency: string;
  companyName: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpFrom?: string;
  alertEmailEnabled: boolean;
  aiServiceUrl: string;
  checklistReminderMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  engagedStoreDwellSec: 300,
  bounceSec: 60,
  repeatWindowDays: 30,
  currency: 'INR',
  companyName: 'Congruence',
  alertEmailEnabled: false,
  aiServiceUrl: 'http://localhost:8000',
  checklistReminderMinutes: 60,
};

/** Defaults resolved at runtime (env AI_SERVICE_URL overrides the built-in ai-service URL). */
export const defaultSettings = (): Settings => ({ ...DEFAULT_SETTINGS, aiServiceUrl: process.env.AI_SERVICE_URL || DEFAULT_SETTINGS.aiServiceUrl });

const NUMERIC = ['engagedStoreDwellSec', 'bounceSec', 'repeatWindowDays', 'smtpPort', 'checklistReminderMinutes'];
const BOOL = ['alertEmailEnabled'];
const PUBLIC_KEYS = [...Object.keys(DEFAULT_SETTINGS), 'smtpHost', 'smtpPort', 'smtpUser', 'smtpFrom'];

@Injectable()
export class SettingsService {
  private cache: Settings | null = null;
  constructor(private readonly ds: DataSource) {}

  async get(): Promise<Settings> {
    if (this.cache) return { ...this.cache };
    const rows = await this.ds.getRepository(Setting).find();
    const s: Record<string, unknown> = { ...defaultSettings() };
    for (const r of rows) {
      if (!PUBLIC_KEYS.includes(r.key)) continue;
      if (r.value === null || r.value === '') continue;
      if (NUMERIC.includes(r.key)) s[r.key] = Number(r.value);
      else if (BOOL.includes(r.key)) s[r.key] = r.value === 'true';
      else s[r.key] = r.value;
    }
    this.cache = s as unknown as Settings;
    return { ...this.cache };
  }

  /** SMTP password is write-only (never returned); env SMTP_PASSWORD is the fallback. */
  async smtpPassword(): Promise<string | undefined> {
    const r = await this.ds.getRepository(Setting).findOne({ where: { key: 'smtpPassword' } });
    return r?.value || process.env.SMTP_PASSWORD || undefined;
  }

  async update(patch: Record<string, unknown>): Promise<Settings> {
    const repo = this.ds.getRepository(Setting);
    for (const [key, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (![...PUBLIC_KEYS, 'smtpPassword'].includes(key)) continue;
      await repo.save({ key, value: v === null ? null : String(v) });
    }
    this.cache = null;
    return this.get();
  }
}
