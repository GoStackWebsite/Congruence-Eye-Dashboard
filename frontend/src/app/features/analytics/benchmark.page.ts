import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { BenchmarkGroup, BenchmarkGroupBy, BenchmarkRow } from '../../core/models/api.models';
import { V2Api } from '../../core/services/v2.api';
import { formatDuration, formatInr, formatNumber, formatPct, humanize } from '../../core/utils/format';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { ApiService, saveBlob } from '../../core/services/api.service';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { ValueFmt, cartesian } from '../../shared/charts/chart-builders';
import { CeColumn, DS, TabItem, TableComponent } from '../../shared/ds';
import { PctPipe } from '../../shared/pipes';
import { UiService } from '../../shared/ui/ui.service';

type MetricKey = 'revenue' | 'footfall' | 'conversionPct' | 'atv' | 'complianceScore' | 'revenuePerSqft' | 'avgQueueWaitSec';
const METRICS: { key: MetricKey; label: string; fmt: ValueFmt }[] = [
  { key: 'revenue', label: 'Revenue', fmt: 'inr' },
  { key: 'footfall', label: 'Footfall', fmt: 'number' },
  { key: 'conversionPct', label: 'Conversion %', fmt: 'pct' },
  { key: 'atv', label: 'ATV', fmt: 'inr' },
  { key: 'revenuePerSqft', label: 'Revenue / sq ft', fmt: 'inr' },
  { key: 'complianceScore', label: 'Compliance %', fmt: 'pct' },
  { key: 'avgQueueWaitSec', label: 'Avg queue wait (s)', fmt: 'sec' },
];

const CSV_COLS: { key: keyof BenchmarkRow; label: string }[] = [
  { key: 'rank', label: 'Rank' },
  { key: 'storeName', label: 'Store' },
  { key: 'regionName', label: 'Region' },
  { key: 'format', label: 'Format' },
  { key: 'footfall', label: 'Footfall' },
  { key: 'footfallChangePct', label: 'Footfall change %' },
  { key: 'conversionPct', label: 'Conversion %' },
  { key: 'revenue', label: 'Revenue (INR)' },
  { key: 'atv', label: 'ATV (INR)' },
  { key: 'revenuePerSqft', label: 'Revenue per sqft (INR)' },
  { key: 'avgDwellSec', label: 'Avg dwell (s)' },
  { key: 'avgQueueWaitSec', label: 'Avg queue wait (s)' },
  { key: 'complianceScore', label: 'Compliance %' },
];

/** Builds a CSV (RFC 4180 quoting) of the league table. */
export function benchmarkCsv(rows: BenchmarkRow[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLS.map((c) => esc(c.label)).join(','), ...rows.map((r) => CSV_COLS.map((c) => esc(r[c.key])).join(','))].join('\n');
}

@Component({
  selector: 'ce-benchmark-page',
  imports: [FormsModule, MatIconModule, MatMenuModule, MatFormFieldModule, MatSelectModule, ...DS, PctPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-benchmark">
      <ce-page title="Store benchmark" description="Multi-store league table, ranked by revenue — or compared by region, format and city" [lastRefreshed]="true">
        <ng-container pageActions>
          <ce-segmented [options]="groupOptions" [value]="groupBy()" (valueChange)="groupBy.set($any($event))" label="Group by" data-testid="toggle-benchmark-group" />
          <button type="button" class="ce-btn ce-btn-secondary" (click)="exportCsv()" [disabled]="!rows().length" data-testid="btn-export-csv"><mat-icon>csv</mat-icon> CSV</button>
          <button type="button" class="ce-btn ce-btn-secondary" (click)="exportServer('xlsx')" data-testid="btn-export-xlsx"><mat-icon>table_view</mat-icon> Excel</button>
        </ng-container>
        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        }

        @if (groupBy() === 'store') {
          @if (podium().length) {
            <div class="bm-podium" data-testid="benchmark-podium">
              @for (r of podium(); track r.storeId) {
                <ce-stat-tile variant="band" [label]="'#' + r.rank + ' · ' + r.storeName" format="inrCompact" [value]="r.revenue" [testId]="'benchmark-top-' + r.rank">
                  <div class="ce-stat-detail">{{ r.regionName }} · conv. <b>{{ r.conversionPct | pct }}</b> · {{ fmtNum(r.footfall) }} footfall</div>
                </ce-stat-tile>
              }
            </div>
          }
          <ce-chart-card
            title="Compare stores"
            icon="leaderboard"
            [subtitle]="metricLabel() + ' by store' + (hiddenInChart() ? ' · ' + hiddenInChart() + ' without data not shown' : '')"
            info="Stores ordered by the chosen metric (queue wait: shortest first)."
            [options]="chart()"
            [hasData]="chartHasData()"
            [loading]="data.loading()"
            chartTestId="chart-benchmark"
            [height]="chartHeight()"
          >
            <mat-form-field chartActions subscriptSizing="dynamic" style="width: 200px">
              <mat-select [ngModel]="metric()" (ngModelChange)="metric.set($event)" data-testid="select-benchmark-metric" aria-label="Metric">
                @for (m of metrics; track m.key) {
                  <mat-option [value]="m.key">{{ m.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </ce-chart-card>
        } @else {
          <ce-chart-card
            [title]="'Comparison by ' + groupLabel().toLowerCase()"
            icon="bar_chart"
            info="Each bar aggregates the stores in that group."
            [options]="groupChart()"
            [hasData]="groupRows().length > 0"
            [loading]="groups.loading()"
            [error]="groups.error()"
            (retry)="groups.reload()"
            chartTestId="chart-benchmark-groups"
            [height]="groupChartHeight()"
          />
          <ce-table
            [rows]="groupRows()"
            [columns]="groupCols()"
            [loading]="groups.loading() && !groups.data()"
            [title]="'By ' + groupLabel().toLowerCase()"
            testId="table-benchmark-groups"
            [rowTestId]="groupRowId"
            [paginate]="false"
            emptyIcon="leaderboard"
            emptyTitle="No groups for these filters"
          />
        }

        <div [hidden]="groupBy() !== 'store'">
          <ce-table
            [rows]="rows()"
            [columns]="cols"
            [loading]="data.loading() && !data.data()"
            #leagueTable
            title="League table"
            subtitle="Ranked by revenue; click a column to sort"
            testId="table-benchmark"
            [rowTestId]="rowId"
            [defaultSort]="{ key: 'rank', dir: 'asc' }"
            sortStart="asc"
            [paginate]="false"
            emptyIcon="leaderboard"
            emptyTitle="No stores to compare"
          >
            <ng-template ceCell="rank" let-r>
              <span class="rank-badge" [class.top]="r.rank <= 3">{{ r.rank }}</span>
            </ng-template>
            <ng-template ceCell="footfall" let-r>
              <div>{{ fmtNum(r.footfall) }}</div>
              @if (r.footfallChangePct !== null && r.footfallChangePct !== undefined) {
                <div class="small" [class.good-text]="r.footfallChangePct > 0" [class.bad-text]="r.footfallChangePct < 0">
                  {{ r.footfallChangePct > 0 ? '▲' : r.footfallChangePct < 0 ? '▼' : '' }} {{ r.footfallChangePct | pct }}
                </div>
              }
            </ng-template>
          </ce-table>
        </div>
      </ce-page>
    </section>
  `,
})
export class BenchmarkPage {
  private readonly analytics = inject(AnalyticsApi);
  private readonly api = inject(ApiService);
  private readonly filter = inject(FilterService);
  private readonly ui = inject(UiService);
  private readonly v2 = inject(V2Api);
  private readonly table = viewChild<TableComponent<BenchmarkRow>>('leagueTable');
  readonly data = loadOn(() => this.filter.params(), (p) => this.analytics.benchmark(p));
  readonly metrics = METRICS;
  readonly metric = signal<MetricKey>('revenue');
  readonly metricLabel = computed(() => METRICS.find((m) => m.key === this.metric())?.label ?? '');
  /** Ratios over an empty base (no footfall / no bills) are unknown, not 0: they render "--" (DESIGN_SYSTEM zero denominators). */
  readonly rows = computed(() => (this.data.data() ?? []).map((r) => withoutEmptyRatios(r)));
  readonly podium = computed(() => [...this.rows()].sort((a, b) => a.rank - b.rank).slice(0, 3));
  readonly groupBy = signal<'store' | BenchmarkGroupBy>('store');
  readonly groupOptions: TabItem[] = [
    { value: 'store', label: 'Store', testId: 'group-store' },
    { value: 'region', label: 'Region', testId: 'group-region' },
    { value: 'format', label: 'Format', testId: 'group-format' },
    { value: 'city', label: 'City', testId: 'group-city' },
  ];
  readonly rowId = (r: BenchmarkRow) => `row-benchmark-${r.storeId}`;
  readonly groupRowId = (g: BenchmarkGroup) => `row-benchmark-group-${g.group}`;
  readonly cols: CeColumn<BenchmarkRow>[] = [
    { key: 'rank', header: '#', sortable: true, width: '56px' },
    { key: 'storeName', header: 'Store', sortable: true, secondary: (r) => r.regionName, locked: true },
    { key: 'format', header: 'Format', sortable: true, format: (v) => (v ? humanize(String(v)) : null) },
    { key: 'footfall', header: 'Footfall', type: 'number', sortable: true },
    { key: 'conversionPct', header: 'Conv.', type: 'percent', sortable: true },
    { key: 'revenue', header: 'Revenue', type: 'number', format: (v) => formatInr(v as number), sortable: true },
    { key: 'atv', header: 'ATV', type: 'number', format: (v) => formatInr(v as number), sortable: true },
    { key: 'revenuePerSqft', header: '₹ / sq ft', type: 'number', format: (v) => formatInr(v as number, 'paise'), sortable: true },
    { key: 'avgDwellSec', header: 'Dwell', type: 'number', format: (v) => formatDuration(v as number), sortable: true },
    { key: 'avgQueueWaitSec', header: 'Queue wait', type: 'number', format: (v) => formatDuration(v as number), sortable: true },
    { key: 'complianceScore', header: 'Compliance', type: 'percent', sortable: true },
  ];
  readonly groups = loadOn(
    () => {
      const g = this.groupBy();
      return g === 'store' ? null : { g, p: this.filter.params() };
    },
    ({ g, p }) => this.v2.benchmarkGroups(g, p),
  );
  readonly groupRows = computed(() => [...(this.groups.data() ?? [])].sort((a, b) => b.revenue - a.revenue));
  readonly groupLabel = computed(() => humanize(this.groupBy()));
  readonly groupCols = computed<CeColumn<BenchmarkGroup>[]>(() => [
    { key: 'group', header: this.groupLabel(), format: (v) => humanize(String(v)) },
    { key: 'stores', header: 'Stores', type: 'number' },
    { key: 'footfall', header: 'Footfall', type: 'number' },
    { key: 'conversionPct', header: 'Conv.', type: 'percent' },
    { key: 'revenue', header: 'Revenue', type: 'number', format: (v) => formatInr(v as number) },
    { key: 'atv', header: 'ATV', type: 'number', format: (v) => formatInr(v as number) },
    { key: 'avgDwellSec', header: 'Dwell', type: 'number', format: (v) => formatDuration(v as number) },
    { key: 'engagedPct', header: 'Engaged', type: 'percent' },
    { key: 'bouncedPct', header: 'Bounced', type: 'percent' },
    { key: 'missedOpportunities', header: 'Missed opps', type: 'number' },
  ]);
  readonly groupChartHeight = computed(() => `${Math.max(200, this.groupRows().length * 34 + 60)}px`);
  readonly groupChart = computed(() => {
    const m = METRICS.find((x) => x.key === this.metric()) ?? METRICS[0];
    const key = (['revenue', 'footfall', 'conversionPct', 'atv'] as string[]).includes(m.key) ? m : METRICS[0];
    const g = this.groupRows();
    return cartesian(
      g.map((x) => humanize(x.group)),
      [{ name: key.label, type: 'bar', data: g.map((x) => (x as unknown as Record<string, number>)[key.key]) }],
      key.fmt,
      { horizontal: true },
    );
  });

  fmtNum(v: number | null | undefined): string {
    return formatNumber(v);
  }
  fmtPct(v: number | null | undefined): string {
    return formatPct(v);
  }

  readonly hiddenInChart = computed(() => {
    const k = this.metric() as MetricKey;
    return this.rows().filter((r) => !r[k]).length;
  });
  /** Bars only make sense when at least one store has a value for the metric. */
  readonly chartHasData = computed(() => {
    const k = this.metric() as MetricKey;
    return this.rows().some((r) => !!r[k]);
  });
  readonly chartHeight = computed(() => `${Math.max(220, this.rows().filter((r) => !!r[this.metric() as MetricKey]).length * 30 + 40)}px`);
  readonly chart = computed(() => {
    const m = METRICS.find((x) => x.key === this.metric())!;
    const v = (r: BenchmarkRow) => r[m.key] ?? 0;
    // stores without a value for the metric are listed in the table, not as empty bars
    const sorted = this.rows()
      .filter((r) => !!r[m.key])
      .sort((a, b) => (m.key === 'avgQueueWaitSec' ? v(a) - v(b) : v(b) - v(a)));
    return cartesian(
      sorted.map((r) => r.storeName),
      [{ name: m.label, type: 'bar', data: sorted.map((r) => r[m.key]) }],
      m.fmt,
      { horizontal: true },
    );
  });

  exportCsv(): void {
    const r = this.filter.range();
    const rows = this.table()?.currentRows() ?? [...this.rows()].sort((a, b) => a.rank - b.rank);
    saveBlob(new Blob(['﻿' + benchmarkCsv(rows)], { type: 'text/csv;charset=utf-8' }), `benchmark_${r.from}_${r.to}.csv`);
  }

  exportServer(format: 'csv' | 'xlsx'): void {
    const p = this.filter.params();
    this.api
      .download('/reports/export', { type: 'benchmark', format, storeIds: p.storeIds, from: p.from, to: p.to }, `benchmark.${format}`)
      .subscribe((f) => {
        saveBlob(f.blob, f.filename);
        this.ui.toast('Export downloaded');
      });
  }
}

/** Benchmark row with ratios whose base is empty set to null (shown as "--", sorted last). */
export function withoutEmptyRatios(r: BenchmarkRow): BenchmarkRow {
  const noVisitors = !r.footfall;
  const noSales = !r.revenue;
  const nul = null as unknown as number;
  return {
    ...r,
    conversionPct: noVisitors ? nul : r.conversionPct,
    avgDwellSec: noVisitors ? nul : r.avgDwellSec,
    avgQueueWaitSec: noVisitors ? nul : r.avgQueueWaitSec,
    engagedPct: noVisitors ? undefined : r.engagedPct,
    bouncedPct: noVisitors ? undefined : r.bouncedPct,
    footfallChangePct: noVisitors && !r.footfallChangePct ? nul : r.footfallChangePct,
    atv: noSales ? nul : r.atv,
    revenuePerSqft: noSales ? nul : r.revenuePerSqft,
  };
}
