import { addDays, parseIsoDate, shortDate, toIsoDate } from '../../core/utils/dates';

export type Granularity = 'daily' | 'weekly';

/** Monday of the ISO week containing `iso` (YYYY-MM-DD). */
export function weekStart(iso: string): string {
  const d = parseIsoDate(iso);
  return toIsoDate(addDays(d, -((d.getDay() + 6) % 7)));
}

/**
 * Groups daily rows into weeks (Mon–Sun), summing the numeric fields. Label = "Wk of 29 Sept" (partial weeks keep
 * only the days inside the range).
 */
export function toWeekly<T extends { date: string }>(rows: T[], fields: (keyof T)[]): (T & { label: string })[] {
  const map = new Map<string, T & { label: string }>();
  for (const r of rows) {
    const k = weekStart(r.date);
    const cur = map.get(k);
    if (!cur) {
      map.set(k, { ...r, date: k, label: `Wk of ${shortDate(k)}` });
      continue;
    }
    for (const f of fields) (cur[f] as unknown as number) = ((cur[f] as unknown as number) || 0) + ((r[f] as unknown as number) || 0);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Percentage helper that never yields NaN/Infinity: null when the denominator is 0. */
export function safePct(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (!whole || !Number.isFinite(whole) || part === null || part === undefined) return null;
  return (part / whole) * 100;
}

/** Today's date (YYYY-MM-DD) in store time. */
export function storeToday(now: Date = new Date(), tz = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Marks today's point of a daily category chart as a partial day: the category reads "06 Oct (so far)", bars are
 * drawn lighter, line points get an open symbol, and a shaded "So far" band covers the day. Values that are missing
 * for a partial day (null / undefined, or 0 while footfall is already counted) are left as gaps — never a false 0.
 */
export function markPartialDay(option: Record<string, unknown>, index: number, footfall: number | null | undefined): Record<string, unknown> {
  if (index < 0) return option;
  // cartesian() has one x axis, stackedGrids() one per grid
  const axes = (Array.isArray(option['xAxis']) ? option['xAxis'] : [option['xAxis']]) as ({ data: string[] } | undefined)[];
  const first = axes[0];
  if (!first?.data?.[index]) return option;
  const label = `${first.data[index]} (so far)`;
  const xAxis = axes.map((a) => (a?.data ? { ...a, data: a.data.map((d, i) => (i === index ? label : d)) } : a));
  const marked = new Set<number>();
  const series = (option['series'] as Record<string, unknown>[]).map((s) => {
    const data = [...(s['data'] as (number | null)[])];
    const v = data[index];
    const missing = v === null || v === undefined || (v === 0 && !!footfall);
    data[index] = missing
      ? null
      : (({ value: v, ...(s['type'] === 'bar' ? { itemStyle: { opacity: 0.5 } } : { symbol: 'emptyCircle', symbolSize: 8 }) }) as unknown as number);
    const out: Record<string, unknown> = { ...s, data };
    if (s['type'] === 'line') out['showSymbol'] = true;
    const grid = Number(s['xAxisIndex'] ?? 0);
    if (!marked.has(grid)) {
      marked.add(grid);
      out['markArea'] = {
        silent: true,
        itemStyle: { color: 'rgba(152, 162, 179, 0.10)' },
        label: { show: grid === 0, position: 'insideTop', formatter: 'So far', color: '#667085', fontSize: 11 },
        data: [[{ xAxis: label }, { xAxis: label }]],
      };
    }
    return out;
  });
  return { ...option, xAxis: Array.isArray(option['xAxis']) ? xAxis : xAxis[0], series };
}

/**
 * Overview KPIs whose denominator is empty (no footfall / no bills) are unknown, not 0: value null → "--".
 * (The API reports 0 for 0 ÷ 0 ratios.)
 */
export function guardOverviewKpis<K extends string>(kpis: Partial<Record<K, { value: number | null; previous?: number | null; changePct?: number | null }>> | null | undefined) {
  if (!kpis) return kpis;
  const k = kpis as Record<string, { value: number | null; previous?: number | null; changePct?: number | null } | undefined>;
  const footfall = k['footfall']?.value ?? 0;
  const bills = k['transactions']?.value ?? 0;
  const none = (key: string) => (k[key] ? { ...k[key]!, value: null as unknown as number, changePct: undefined } : k[key]);
  const out: Record<string, unknown> = { ...k };
  if (!footfall) for (const key of ['conversionPct', 'avgDwellSec', 'engagedPct', 'bounceRatePct']) out[key] = none(key);
  if (!bills) out['atv'] = none('atv');
  return out as typeof kpis;
}

/** Conversion totals with ratios over an empty base nulled ("--"). */
export function guardConversionTotals<T extends { conversionPct: number; atv: number; itemsPerBill: number; transactions: number }>(t: T | undefined, billable: number | undefined): T | undefined {
  if (!t) return t;
  const nul = null as unknown as number;
  return { ...t, conversionPct: billable ? t.conversionPct : nul, atv: t.transactions ? t.atv : nul, itemsPerBill: t.transactions ? t.itemsPerBill : nul };
}
