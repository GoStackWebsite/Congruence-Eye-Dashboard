import { AiManagerRule } from './entities/ai-manager-rule.entity';

export const AI_RULE_TYPES = ['MOBILE_USAGE', 'UNATTENDED_CUSTOMER', 'STORE_OPEN_CLOSE', 'HYGIENE_CLEANING', 'HUDDLE_MEETING', 'UNIFORM_COMPLIANCE', 'STOCK_OUT', 'QUEUE_BREACH'];
export const WINDOW_RULE_TYPES = ['HUDDLE_MEETING', 'HYGIENE_CLEANING'];

export const DEFAULT_AI_PARAMS: Record<string, Record<string, number | string | boolean>> = {
  MOBILE_USAGE: { minDurationSec: 20, staffOnly: true },
  UNATTENDED_CUSTOMER: { minDurationSec: 120, staffRadius: 0.15 },
  STORE_OPEN_CLOSE: { toleranceMin: 10 },
  HYGIENE_CLEANING: { minCoveragePct: 60 },
  HUDDLE_MEETING: { minPeople: 3, minDurationMin: 5, radius: 0.2 },
  UNIFORM_COMPLIANCE: { minNonCompliantSec: 60 },
  STOCK_OUT: { emptyPct: 70 },
  QUEUE_BREACH: { maxQueue: 5 },
};

export const aiRuleView = (r: AiManagerRule) => ({
  id: r.id,
  name: r.name,
  type: r.type,
  storeIds: r.storeIds ?? [],
  zoneIds: r.zoneIds ?? [],
  windowStart: r.windowStart,
  windowEnd: r.windowEnd,
  daysOfWeek: r.daysOfWeek ?? [],
  params: { ...(DEFAULT_AI_PARAMS[r.type] ?? {}), ...(r.params ?? {}) },
  severity: r.severity,
  notifyChannels: r.notifyChannels ?? [],
  notifyEmails: r.notifyEmails ?? null,
  isActive: r.isActive,
});
