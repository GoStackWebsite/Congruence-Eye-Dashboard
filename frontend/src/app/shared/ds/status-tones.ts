/**
 * The single status → tone map of the product (DESIGN_SYSTEM.md "Status is a pill"). Every pill, chip and status
 * cell reads its colour from here so "Breached" is the same red everywhere.
 */
export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'info' | 'neutral' | 'brand';

export const STATUS_TONES: Record<string, Tone> = {
  // severity / priority
  LOW: 'info',
  MEDIUM: 'warning',
  HIGH: 'serious',
  CRITICAL: 'critical',
  URGENT: 'critical',
  // alerts, tickets, tasks
  OPEN: 'serious',
  ACKNOWLEDGED: 'warning',
  RESOLVED: 'good',
  CLOSED: 'neutral',
  REOPENED: 'serious',
  IN_PROGRESS: 'info',
  TODO: 'neutral',
  DONE: 'good',
  VERIFIED: 'good',
  CANCELLED: 'neutral',
  // checklists
  PENDING: 'warning',
  SUBMITTED: 'info',
  OVERDUE: 'critical',
  REDO: 'serious',
  APPROVED: 'good',
  NOT_SUBMITTED: 'warning',
  DRAFT: 'neutral',
  PUBLISHED: 'good',
  PAUSED: 'neutral',
  // vendors
  SCHEDULED: 'info',
  CHECKED_IN: 'warning',
  COMPLETED: 'good',
  MISSED: 'critical',
  // devices / infra
  ONLINE: 'good',
  OFFLINE: 'critical',
  UNKNOWN: 'neutral',
  GOOD: 'good',
  DEGRADED: 'warning',
  DOWN: 'critical',
  // zones
  HOT: 'critical',
  WARM: 'warning',
  DEAD: 'neutral',
  // generic
  ACTIVE: 'good',
  INACTIVE: 'neutral',
  YES: 'good',
  NO: 'neutral',
  // AI manager
  BREACHED: 'critical',
  COMPLIED: 'good',
  ON_TIME: 'good',
  EARLY: 'serious',
  LATE: 'critical',
  MISSING: 'critical',
  VALID: 'good',
  FALSE_POSITIVE: 'neutral',
  UNREVIEWED: 'warning',
  NOT_REVIEWED: 'warning',
  PASS: 'good',
  FAIL: 'critical',
  ERROR: 'neutral',
  // recorders (DVR / NVR) and connection tests (probes)
  PARTIAL: 'warning',
  RUNNING: 'info',
  OK: 'good',
  FAILED: 'critical',
  EXPIRED: 'warning',
  NEVER_SEEN: 'neutral',
  NOT_SET_UP: 'neutral',
};

export const TONE_ICON: Record<Tone, string> = {
  good: 'check_circle',
  warning: 'warning',
  serious: 'error',
  critical: 'report',
  info: 'info',
  neutral: 'radio_button_unchecked',
  brand: 'auto_awesome',
};

/** Friendly labels where humanize() is not enough. */
export const STATUS_LABELS: Record<string, string> = {
  ON_TIME: 'On time',
  EARLY: 'Early',
  LATE: 'Late',
  FALSE_POSITIVE: 'False positive',
  IN_PROGRESS: 'In progress',
  CHECKED_IN: 'Checked in',
  NOT_SUBMITTED: 'Not submitted',
  TODO: 'To do',
  OK: 'OK',
  NEVER_SEEN: 'Never seen',
  NOT_SET_UP: 'Not set up',
  NOT_REVIEWED: 'Not reviewed',
};

export function toneOf(value: string | null | undefined): Tone {
  return STATUS_TONES[(value ?? '').toUpperCase()] ?? 'neutral';
}
