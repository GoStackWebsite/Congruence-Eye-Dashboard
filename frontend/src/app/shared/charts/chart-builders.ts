import type { EChartsCoreOption } from 'echarts/core';
import { formatInr, formatNumber } from '../../core/utils/format';

export type ValueFmt = 'number' | 'pct' | 'inr' | 'sec' | 'decimal';

export function fmtValue(v: number | null | undefined, f: ValueFmt = 'number'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '--';
  switch (f) {
    case 'pct':
      return `${v.toFixed(1)}%`;
    case 'inr':
      return formatInr(v);
    case 'sec':
      return `${Math.round(v)}s`;
    case 'decimal':
      return formatNumber(v, 1);
    default:
      return formatNumber(v);
  }
}

function axisLabelFmt(f: ValueFmt) {
  return (v: number) => (f === 'inr' ? formatInr(v, 'compact') : f === 'pct' ? `${v}%` : f === 'sec' ? `${v}s` : formatNumber(v));
}

export interface SeriesSpec {
  name: string;
  type: 'bar' | 'line';
  data: (number | null)[];
  stack?: string;
  area?: boolean;
}

function seriesOf(s: SeriesSpec, gridIndex = 0) {
  const base: Record<string, unknown> = {
    name: s.name,
    type: s.type,
    data: s.data,
    xAxisIndex: gridIndex,
    yAxisIndex: gridIndex,
    emphasis: { focus: 'series' },
  };
  if (s.type === 'bar') {
    base['barGap'] = '12%';
    base['itemStyle'] = { borderRadius: s.stack ? 0 : [4, 4, 0, 0], borderColor: 'transparent' };
    if (s.stack) base['stack'] = s.stack;
  } else {
    base['showSymbol'] = s.data.length <= 2;
    base['lineStyle'] = { width: 2 };
    if (s.area) base['areaStyle'] = { opacity: 0.12 };
  }
  return base;
}

/** Category (x) × value (y) chart, single y-axis. */
/** Phone-width viewport (category labels get truncated harder). */
function narrowViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 600;
}

export function cartesian(categories: string[], series: SeriesSpec[], fmt: ValueFmt = 'number', opts: { horizontal?: boolean } = {}): EChartsCoreOption {
  const cat = { type: 'category', data: categories, axisTick: { show: false } };
  const val = { type: 'value', axisLabel: { formatter: axisLabelFmt(fmt) } };
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: series.some((s) => s.type === 'line') ? 'line' : 'shadow' },
      valueFormatter: (v: number) => fmtValue(v, fmt),
    },
    legend: series.length > 1 ? { top: 0, left: 0 } : undefined,
    grid: { left: 8, right: 16, top: series.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
    xAxis: opts.horizontal ? val : cat,
    yAxis: opts.horizontal ? { ...cat, inverse: true, axisLabel: { width: narrowViewport() ? 110 : 260, overflow: 'truncate' } } : val,
    series: series.map((s) => {
      const out = seriesOf(s);
      if (opts.horizontal && s.type === 'bar' && !s.stack) out['itemStyle'] = { borderRadius: [0, 4, 4, 0], borderColor: 'transparent' };
      return out;
    }),
  };
}

/**
 * Two vertically stacked grids sharing the same categories — used instead of a
 * dual-axis chart when two measures have different scales (e.g. footfall vs conversion %).
 */
export function stackedGrids(
  categories: string[],
  top: { series: SeriesSpec[]; fmt: ValueFmt; title: string },
  bottom: { series: SeriesSpec[]; fmt: ValueFmt; title: string },
): EChartsCoreOption {
  const fmtFor = (name: string) => (bottom.series.some((s) => s.name === name) ? bottom.fmt : top.fmt);
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', link: [{ xAxisIndex: 'all' }] },
      formatter: (params: { seriesName: string; value: number; marker: string; axisValueLabel: string }[]) => {
        if (!params?.length) return '';
        const head = `<div style="font-weight:600;margin-bottom:4px">${params[0].axisValueLabel}</div>`;
        return head + params.map((p) => `${p.marker} ${p.seriesName}: <b>${fmtValue(p.value, fmtFor(p.seriesName))}</b>`).join('<br/>');
      },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    legend: { top: 0, left: 0 },
    title: [
      { text: top.title, top: 28, left: 0, textStyle: { fontSize: 12, fontWeight: 500 } },
      { text: bottom.title, top: '62%', left: 0, textStyle: { fontSize: 12, fontWeight: 500 } },
    ],
    grid: [
      { left: 8, right: 16, top: 56, height: '42%', containLabel: true },
      { left: 8, right: 16, top: '70%', bottom: 8, containLabel: true },
    ],
    xAxis: [
      { type: 'category', data: categories, gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false } },
      { type: 'category', data: categories, gridIndex: 1, axisTick: { show: false } },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, axisLabel: { formatter: axisLabelFmt(top.fmt) }, splitNumber: 3 },
      { type: 'value', gridIndex: 1, axisLabel: { formatter: axisLabelFmt(bottom.fmt) }, splitNumber: 2 },
    ],
    series: [...top.series.map((s) => seriesOf(s, 0)), ...bottom.series.map((s) => seriesOf(s, 1))],
  };
}

/** Donut for part-to-whole with ≤ 4 slices; labels are direct. */
export function donut(items: { name: string; value: number }[], fmt: ValueFmt = 'number', colors?: string[]): EChartsCoreOption {
  return {
    tooltip: { trigger: 'item', valueFormatter: (v: number) => fmtValue(v, fmt) },
    legend: { bottom: 0, left: 'center' },
    color: colors,
    series: [
      {
        type: 'pie',
        radius: ['46%', '68%'],
        center: ['50%', '45%'],
        avoidLabelOverlap: true,
        padAngle: 1,
        itemStyle: { borderRadius: 4, borderWidth: 2 },
        label: { formatter: (p: { percent: number }) => `${Math.round(p.percent * 10) / 10}%`, fontSize: 12, fontWeight: 600, overflow: 'none' },
        labelLine: { length: 8, length2: 8 },
        data: items,
      },
    ],
  };
}


export interface FlowFunnel {
  footfall: number;
  engaged: number;
  billableEntities: number;
  transactions: number;
}

/** Contract v2 order and labels: Footfall → Engagers → Billable entities → Conversion. */
export function conversionFlowStages(f: FlowFunnel | null | undefined): { key: keyof FlowFunnel; label: string; value: number; pctOfFootfall: number }[] {
  const base = f?.footfall || 0;
  const stages: { key: keyof FlowFunnel; label: string }[] = [
    { key: 'footfall', label: 'Footfall' },
    { key: 'engaged', label: 'Engagers' },
    { key: 'billableEntities', label: 'Billable entities' },
    { key: 'transactions', label: 'Conversion' },
  ];
  return stages.map((s) => {
    const value = f?.[s.key] ?? 0;
    return { ...s, value, pctOfFootfall: base ? Math.round((value / base) * 1000) / 10 : 0 };
  });
}

/** Horizontal flow bars (ordinal blue ramp, darker = deeper), value + % of footfall as direct labels. */
export function conversionFlowChart(f: FlowFunnel | null | undefined): EChartsCoreOption {
  const stages = conversionFlowStages(f);
  const ramp = ['#53B1FD', '#2E90FA', '#6172F3', '#7A5AF8'];
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: { name: string; value: number; dataIndex: number }) =>
        `${p.name}: <b>${formatNumber(p.value)}</b> (${stages[p.dataIndex].pctOfFootfall}% of footfall)`,
    },
    grid: { left: 8, right: 120, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', inverse: true, data: stages.map((s) => s.label), axisTick: { show: false }, axisLine: { show: false } },
    series: [
      {
        type: 'bar',
        barWidth: 26,
        data: stages.map((s, i) => ({ value: s.value, itemStyle: { color: ramp[i], borderRadius: [0, 4, 4, 0] } })),
        label: {
          show: true,
          position: 'right',
          formatter: (p: { value: number; dataIndex: number }) => `${formatNumber(p.value)} · ${stages[p.dataIndex].pctOfFootfall}%`,
        },
      },
    ],
  };
}

/**
 * Table form of a chart's data for "Download CSV": category axis × series for cartesian charts, name/value rows for
 * pie/funnel/bar-of-objects series. Returns null when nothing tabular can be derived (e.g. sankey links).
 */
export function chartTable(options: Record<string, unknown> | null | undefined): { header: string[]; rows: (string | number | null)[][] } | null {
  if (!options) return null;
  const series = ((options['series'] as Record<string, unknown>[] | undefined) ?? []).filter((s) => Array.isArray(s['data']));
  if (!series.length) return null;
  const valOf = (d: unknown): number | string | null => {
    if (d === null || d === undefined) return null;
    if (typeof d === 'object') {
      const v = (d as { value?: unknown }).value;
      return Array.isArray(v) ? (v[v.length - 1] as number) : ((v as number | null | undefined) ?? null);
    }
    return d as number | string;
  };
  const axes = [options['xAxis'], options['yAxis']].flatMap((a) => (Array.isArray(a) ? a : a ? [a] : [])) as Record<string, unknown>[];
  const cat = axes.find((a) => a['type'] === 'category' && Array.isArray(a['data']));
  const objectRows = (series[0]['data'] as unknown[]).every((d) => d && typeof d === 'object' && 'name' in (d as object));
  if (!cat && objectRows) {
    const header = ['Name', ...series.map((s, i) => String(s['name'] ?? (series.length > 1 ? `Series ${i + 1}` : 'Value')))];
    const names = (series[0]['data'] as { name: string }[]).map((d) => d.name);
    return { header, rows: names.map((n, i) => [n, ...series.map((s) => valOf((s['data'] as unknown[])[i]))]) };
  }
  if (!cat) return null;
  const cats = cat['data'] as unknown[];
  const header = [String(cat['name'] ?? 'Category'), ...series.map((s, i) => String(s['name'] ?? `Series ${i + 1}`))];
  return {
    header,
    rows: cats.map((c, i) => [String(typeof c === 'object' && c ? ((c as { value?: unknown }).value ?? '') : c), ...series.map((s) => valOf((s['data'] as unknown[])[i]))]),
  };
}

/** Ordinal ramp for the conversion stages (light blue → violet, as in the reference funnel). */
export const FLOW_RAMP = ['#53B1FD', '#2E90FA', '#6172F3', '#7A5AF8'];

/**
 * Reference-01 style conversion funnel: stages left → right (Footfall → Engagers → Billable entities → Conversion),
 * each a trapezoid sized by its value, labelled inside; tooltip "Label: N (x% of footfall)".
 */
export function conversionFunnelChart(f: FlowFunnel | null | undefined): EChartsCoreOption {
  const stages = conversionFlowStages(f);
  const max = Math.max(1, ...stages.map((s) => s.value));
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: { name: string; value: number; dataIndex: number }) =>
        `${p.name}: <b>${formatNumber(p.value)}</b> (${stages[p.dataIndex].pctOfFootfall}% of footfall)`,
    },
    series: [
      {
        type: 'funnel',
        orient: 'horizontal',
        sort: 'none',
        left: 8,
        right: 8,
        top: 8,
        bottom: 8,
        min: 0,
        max,
        minSize: '18%',
        maxSize: '100%',
        gap: 4,
        funnelAlign: 'center',
        label: {
          show: true,
          position: 'inside',
          formatter: (p: { name: string; value: number; dataIndex: number }) => `{v|${formatNumber(p.value)}}\n{n|${p.name}}\n{p|${stages[p.dataIndex].pctOfFootfall}%}`,
          rich: {
            v: { fontSize: 15, fontWeight: 600, color: '#fff', lineHeight: 20 },
            n: { fontSize: 11, color: 'rgba(255,255,255,.9)', lineHeight: 16 },
            p: { fontSize: 11, color: 'rgba(255,255,255,.8)', lineHeight: 16 },
          },
        },
        labelLine: { show: false },
        itemStyle: { borderWidth: 0 },
        emphasis: { label: { fontSize: 13 } },
        data: stages.map((s, i) => ({ name: s.label, value: s.value, itemStyle: { color: FLOW_RAMP[i] } })),
      },
    ],
  };
}
