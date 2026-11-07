/**
 * Chart palette — DESIGN_SYSTEM.md categorical hues, ordered so adjacent slots pass the dataviz validator
 * (CVD ΔE ≥ 8 light; dark uses the -600 steps of the same hues so slot i is the same entity in both modes).
 * Slots are assigned in fixed order, never cycled; status colours are reserved for status.
 */
export const SERIES_LIGHT = ['#2E90FA', '#F79009', '#7A5AF8', '#12B76A', '#EE46BC', '#6172F3', '#36BFFA'];
export const SERIES_DARK = ['#2E90FA', '#DC6803', '#7A5AF8', '#039855', '#DD2590', '#6172F3', '#0BA5EC'];
/** Sequential (density) ramp, light → dark (DESIGN_SYSTEM.md). */
export const SEQUENTIAL_BLUE = ['#EFF8FF', '#D1E9FF', '#B2DDFF', '#84CAFF', '#53B1FD', '#2E90FA', '#1570EF', '#175CD3', '#194185'];
export const STATUS = { good: '#12B76A', warning: '#F79009', serious: '#EF6820', critical: '#F04438' };

export interface ChartTokens {
  series: string[];
  text: string;
  textMuted: string;
  grid: string;
  axis: string;
  surface: string;
  tooltipBg: string;
  tooltipBorder: string;
}

export const LIGHT_TOKENS: ChartTokens = {
  series: SERIES_LIGHT,
  text: '#101828',
  textMuted: '#667085',
  grid: '#EAECF0',
  axis: '#D0D5DD',
  surface: '#FFFFFF',
  tooltipBg: '#FFFFFF',
  tooltipBorder: '#E4E7EC',
};
export const DARK_TOKENS: ChartTokens = {
  series: SERIES_DARK,
  text: '#F5F5F6',
  textMuted: '#94969C',
  grid: '#262C3A',
  axis: '#3A4254',
  surface: '#161B26',
  tooltipBg: '#1F2533',
  tooltipBorder: '#333B4D',
};

export function tokens(dark: boolean): ChartTokens {
  return dark ? DARK_TOKENS : LIGHT_TOKENS;
}

/** Registered theme names (ECharts `registerTheme`). */
export const CHART_THEME = { light: 'congruence', dark: 'congruence-dark' } as const;

/**
 * The `congruence` ECharts theme: hairline grid, 11px axis labels in --c-text-3, tooltip as a white card with the
 * overlay shadow, legend top-left with square markers, no chart borders.
 */
export function echartsTheme(dark: boolean): Record<string, unknown> {
  const t = tokens(dark);
  const axis = {
    axisLine: { show: true, lineStyle: { color: t.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: t.textMuted, fontSize: 11, margin: 10 },
    splitLine: { show: true, lineStyle: { color: t.grid, width: 1, type: 'solid' } },
    nameTextStyle: { color: t.textMuted, fontSize: 11 },
  };
  return {
    color: t.series,
    backgroundColor: 'transparent',
    textStyle: { color: t.text, fontFamily: "'Inter Variable', Inter, system-ui, sans-serif", fontSize: 12 },
    title: { textStyle: { color: t.text, fontSize: 12, fontWeight: 600 }, subtextStyle: { color: t.textMuted } },
    legend: {
      textStyle: { color: t.textMuted, fontSize: 12 },
      icon: 'rect',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 16,
      left: 0,
      top: 0,
    },
    tooltip: {
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: t.text, fontSize: 12 },
      extraCssText: 'box-shadow:0 12px 24px -4px rgba(16,24,40,.12);border-radius:8px;',
      axisPointer: { lineStyle: { color: t.axis }, shadowStyle: { color: dark ? 'rgba(255,255,255,0.04)' : 'rgba(16,24,40,0.04)' } },
    },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: { ...axis, axisLine: { show: false } },
    timeAxis: { ...axis, splitLine: { show: false } },
    line: { lineStyle: { width: 2 }, symbol: 'circle', symbolSize: 8, showSymbol: false, smooth: false },
    bar: { itemStyle: { borderRadius: [4, 4, 0, 0] }, barMaxWidth: 24 },
    pie: { itemStyle: { borderColor: t.surface, borderWidth: 2 } },
    funnel: { itemStyle: { borderColor: t.surface, borderWidth: 2 } },
    sankey: { label: { color: t.text, fontSize: 11 } },
  };
}

/** Standard axis tooltip + grid. */
export function baseGrid(extra: Record<string, unknown> = {}) {
  return { left: 8, right: 16, top: 40, bottom: 8, containLabel: true, ...extra };
}
