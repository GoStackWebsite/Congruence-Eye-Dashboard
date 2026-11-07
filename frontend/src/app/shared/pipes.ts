import { Pipe, PipeTransform } from '@angular/core';
import { formatBytes, formatDuration, formatInr, formatNumber, formatPct, humanize } from '../core/utils/format';
import { hourLabel, localizeTimestamps, shortDate } from '../core/utils/dates';

/** ₹ with en-IN lakh grouping. `{{ v | inr }}` → ₹12,34,567; `{{ v | inr:'compact' }}` → ₹12.35 L */
@Pipe({ name: 'inr' })
export class InrPipe implements PipeTransform {
  transform(value: number | null | undefined, mode: 'full' | 'paise' | 'compact' = 'full'): string {
    return formatInr(value, mode);
  }
}

@Pipe({ name: 'num' })
export class NumPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 0): string {
    return formatNumber(value, decimals);
  }
}

@Pipe({ name: 'pct' })
export class PctPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 1): string {
    return formatPct(value, decimals);
  }
}

@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatDuration(value);
  }
}

@Pipe({ name: 'humanize' })
export class HumanizePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return humanize(value);
  }
}

@Pipe({ name: 'bytes' })
export class BytesPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatBytes(value);
  }
}

@Pipe({ name: 'hourLabel' })
export class HourLabelPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return value === null || value === undefined ? '--' : hourLabel(value);
  }
}

@Pipe({ name: 'shortDate' })
export class ShortDatePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? shortDate(value) : '--';
  }
}

/** Locale date-time (en-IN) for ISO timestamps. */
@Pipe({ name: 'dt' })
export class DateTimePipe implements PipeTransform {
  transform(value: string | null | undefined, mode: 'datetime' | 'date' | 'time' | 'relative' = 'datetime'): string {
    if (!value) return '--';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    if (mode === 'date') return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    if (mode === 'time') return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    if (mode === 'relative') return relativeTime(d);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}

export function relativeTime(d: Date, now = Date.now()): string {
  const diff = Math.round((now - d.getTime()) / 1000);
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}

export const SHARED_PIPES = [
  InrPipe,
  NumPipe,
  PctPipe,
  DurationPipe,
  HumanizePipe,
  BytesPipe,
  HourLabelPipe,
  ShortDatePipe,
  DateTimePipe,
] as const;

/** Server text with raw ISO timestamps shown in store time (see localizeTimestamps). */
@Pipe({ name: 'localTimes' })
export class LocalTimesPipe implements PipeTransform {
  transform(v: string | null | undefined): string {
    return localizeTimestamps(v);
  }
}
