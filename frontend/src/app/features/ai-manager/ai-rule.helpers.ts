import { AiManagerRuleInput, AiManagerType, ParamValue, ZoneType } from '../../core/models/api.models';
import { AI_PARAM_DEFAULTS, ALL_DAYS } from '../../core/utils/v2-helpers';

/** Zone types that make sense as detection areas for each rule type. */
export const DETECTION_ZONE_TYPES: Record<AiManagerType, ZoneType[]> = {
  MOBILE_USAGE: ['SECTION', 'STAFF_ONLY', 'QUEUE'],
  UNATTENDED_CUSTOMER: ['SECTION'],
  STORE_OPEN_CLOSE: ['ENTRY_LINE', 'SECTION'],
  HYGIENE_CLEANING: ['SECTION', 'QUEUE'],
  HUDDLE_MEETING: ['SECTION', 'STAFF_ONLY'],
  UNIFORM_COMPLIANCE: ['SECTION', 'QUEUE', 'STAFF_ONLY'],
  STOCK_OUT: ['SHELF'],
  QUEUE_BREACH: ['QUEUE'],
};

export function emptyAiRule(type: AiManagerType = 'MOBILE_USAGE'): AiManagerRuleInput {
  return {
    name: '',
    type,
    storeIds: [],
    zoneIds: [],
    windowStart: '10:00',
    windowEnd: '21:30',
    daysOfWeek: [...ALL_DAYS],
    params: { ...AI_PARAM_DEFAULTS[type] },
    severity: 'MEDIUM',
    notifyChannels: ['IN_APP'],
    notifyEmails: null,
    isActive: true,
  };
}

export function validateAiRule(r: AiManagerRuleInput): string[] {
  const e: string[] = [];
  if (!r.name.trim()) e.push('Rule name is required');
  if (!/^\d{2}:\d{2}$/.test(r.windowStart) || !/^\d{2}:\d{2}$/.test(r.windowEnd)) e.push('Window times must be HH:mm');
  else if (r.windowStart >= r.windowEnd) e.push('Window end must be after window start');
  if (!r.daysOfWeek.length) e.push('Pick at least one day');
  if (!r.notifyChannels.length) e.push('Pick at least one notification channel');
  if (r.notifyChannels.includes('EMAIL') && !r.notifyEmails?.trim()) e.push('Enter notification emails');
  return e;
}

/**
 * Sentence form of each detection parameter: `before [input] after`. Booleans render as a switch row.
 * Keeps the editor readable for store-ops users ("Flag phone use longer than [20] seconds").
 */
export const AI_PARAM_SENTENCES: Record<string, { before: string; after: string; step?: number; min?: number; max?: number; helper?: string }> = {
  minDurationSec: { before: 'Flag when it lasts longer than', after: 'seconds', min: 1 },
  staffOnly: { before: 'Only staff', after: '', helper: 'Ignore customers using a phone' },
  staffRadius: { before: 'with no staff within', after: 'of the frame (0–1)', step: 0.05, min: 0, max: 1 },
  toleranceMin: { before: 'If store open time exceeds by', after: 'minutes', min: 0 },
  minCoveragePct: { before: 'Expect cleaning to cover at least', after: '% of the floor', min: 0, max: 100 },
  minPeople: { before: 'A huddle is at least', after: 'staff together', min: 2 },
  minDurationMin: { before: 'for at least', after: 'minutes', min: 1 },
  radius: { before: 'standing within', after: 'of the frame (0–1)', step: 0.05, min: 0, max: 1 },
  minNonCompliantSec: { before: 'Flag staff out of uniform for longer than', after: 'seconds', min: 1 },
  emptyPct: { before: 'Flag a shelf that is at least', after: '% empty', min: 1, max: 100 },
  maxQueue: { before: 'Alert when the billing queue is longer than', after: 'people', min: 1 },
};

/**
 * Optional STORE_OPEN_CLOSE settings beyond the contract defaults (stored in `params`, which the API keeps as-is):
 * monitor windows before the scheduled open / after the scheduled close for early-open / late-close detection.
 * 0 = off. They are only sent once a user turns the feature on.
 */
export const OPEN_CLOSE_EXTRAS = { monitorBeforeOpenMin: 30, monitorAfterCloseMin: 20 } as const;

export function openCloseExtras(params: Record<string, ParamValue> | null | undefined): { monitorBeforeOpenMin: number; monitorAfterCloseMin: number } | null {
  const b = Number(params?.['monitorBeforeOpenMin']);
  const a = Number(params?.['monitorAfterCloseMin']);
  if (!(b > 0) && !(a > 0)) return null;
  return { monitorBeforeOpenMin: b > 0 ? b : 0, monitorAfterCloseMin: a > 0 ? a : 0 };
}

/** Parses a comma/semicolon/space separated email list (for recipient chips). */
export function parseEmails(s: string | null | undefined): string[] {
  return [...new Set((s ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
}
