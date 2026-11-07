import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { Conversion } from '../../core/models/api.models';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { hourLabel, shortDate } from '../../core/utils/dates';
import { formatInr, formatNumber } from '../../core/utils/format';
import { cartesian, conversionFlowChart, stackedGrids } from '../../shared/charts/chart-builders';
import { CeColumn, DS } from '../../shared/ds';
import { guardConversionTotals, markPartialDay, storeToday } from './analytics-helpers';
import { NumPipe } from '../../shared/pipes';
import { saveBlob } from '../../core/services/api.service';
import { toCsv } from '../../core/utils/csv';

type ByStore = Conversion['byStore'][number];

/** Revenue › Conversion (RevOp): funnel, visitor outcomes, conversion & ATV trend, staffing vs missed, by store. */
@Component({
  selector: 'ce-conversion-page',
  imports: [...DS, NumPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-conversion">
      <ce-page title="Conversion (RevOp)" description="Footfall → engaged → billed, with missed opportunities and staff accountability" [lastRefreshed]="true">
        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        }
        @let t = totals();
        @let busy = !t && data.loading();
        <div class="stat-grid stat-grid-6">
          <ce-stat-tile variant="band" id="conversion" label="Conversion" format="pct" [value]="t?.conversionPct" [loading]="busy" hint="Transactions ÷ billable entities" />
          <ce-stat-tile variant="band" id="revenue" label="Revenue" format="inrCompact" [value]="t?.revenue" [loading]="busy" />
          <ce-stat-tile variant="band" id="transactions" label="Transactions" [value]="t?.transactions" [loading]="busy" />
          <ce-stat-tile variant="band" id="atv" label="ATV" format="inr" [value]="t?.atv" [loading]="busy" hint="Average transaction value = revenue ÷ transactions" />
          <ce-stat-tile variant="band" id="items-per-bill" label="Items per bill" format="decimal" [value]="t?.itemsPerBill" [loading]="busy" />
          <ce-stat-tile variant="band" id="missed-opportunities" label="Missed opportunities" [value]="data.data()?.segments?.missedOpportunities" [loading]="busy" hint="Engaged billable entities that did not buy" [lowerIsBetter]="true" />
        </div>

        @let d = data.data();
        <div class="an-grid-1-1">
          <ce-chart-card
            title="Conversion flow"
            icon="filter_alt"
            subtitle="Footfall → Engagers → Billable entities → Conversion"
            info="Each bar is a stage of the funnel; labels show the count and its share of footfall."
            [options]="funnelChart()"
            [hasData]="!!d"
            [loading]="data.loading()"
            chartTestId="chart-funnel"
            height="300px"
            ariaLabel="Conversion flow"
          />
          <ce-card title="Visitor outcomes" icon="donut_small" info="Bounced: left without engaging. Missed: engaged but did not buy. Converted: billed." data-testid="conversion-segments">
            @if (d) {
              <div class="segments">
                <div class="segment" data-testid="segment-bounced">
                  <div class="seg-value">{{ d.segments.bounced | num }}</div>
                  <div class="seg-label">Bounced — left quickly without engaging</div>
                </div>
                <div class="segment" data-testid="segment-missed">
                  <div class="seg-value warn-text">{{ d.segments.missedOpportunities | num }}</div>
                  <div class="seg-label">Missed — engaged but didn't buy</div>
                </div>
                <div class="segment" data-testid="segment-converted">
                  <div class="seg-value good-text">{{ d.segments.converted | num }}</div>
                  <div class="seg-label">Converted — billed</div>
                </div>
              </div>
              <ce-chart [options]="segmentsChart()" height="150px" testId="chart-segments" ariaLabel="Visitor outcomes" />
            } @else {
              <ce-skeleton kind="text" [count]="4" />
            }
          </ce-card>
        </div>

        <div class="an-grid-1-1">
          <ce-chart-card title="Daily conversion & ATV" info="Conversion % (top) and average transaction value (bottom) per day — two panels, never a dual axis." [options]="dailyChart()" [hasData]="!!d?.daily?.length" [loading]="data.loading()" chartTestId="chart-conversion-daily" height="340px" />
          <ce-chart-card title="Missed opportunities vs staff present" subtitle="By hour" info="Missed opportunities per hour (top) against the average number of staff on the floor (bottom)." [options]="hourlyChart()" [hasData]="!!d?.hourly?.length" [loading]="data.loading()" chartTestId="chart-missed-staff" height="340px" />
        </div>
        <ce-chart-card title="Customers per staff" subtitle="Billable entities ÷ staff present, by hour" info="How many billable entities each staff member handled per hour. 0 when no staff was present." [options]="perStaffChart()" [hasData]="!!d?.hourly?.length" [loading]="data.loading()" chartTestId="chart-customers-per-staff" height="260px" />

        <ce-table
          [rows]="d?.byStore ?? []"
          [columns]="cols"
          [loading]="busy"
          title="By store"
          [searchable]="true"
          searchPlaceholder="Search stores"
          [exportable]="true"
          (exportClick)="exportStores($event)"
          exportTestId="btn-export-conversion-stores"
          testId="table-conversion-stores"
          [rowTestId]="rowId"
          [defaultSort]="{ key: 'conversionPct', dir: 'desc' }"
          emptyIcon="shopping_cart"
          emptyTitle="No conversion data for these filters"
        />
      </ce-page>
    </section>
  `,
})
export class ConversionPage {
  private readonly api = inject(AnalyticsApi);
  private readonly filter = inject(FilterService);
  readonly data = loadOn(() => this.filter.params(), (p) => this.api.conversion(p));
  /** Ratios with an empty base render "--" (never 0 %). */
  readonly totals = computed(() => guardConversionTotals(this.data.data()?.totals, this.data.data()?.funnel?.billableEntities));
  readonly rowId = (r: ByStore) => `row-conversion-${r.storeId}`;
  readonly cols: CeColumn<ByStore>[] = [
    { key: 'storeName', header: 'Store', sortable: true, locked: true },
    { key: 'conversionPct', header: 'Conversion', type: 'percent', sortable: true },
    { key: 'revenue', header: 'Revenue', type: 'number', format: (v) => formatInr(v as number), sortable: true },
    { key: 'atv', header: 'ATV', type: 'number', format: (v) => formatInr(v as number), sortable: true },
    { key: 'missedOpportunities', header: 'Missed opps', type: 'number', sortable: true },
  ];

  exportStores(rows: ByStore[]): void {
    const r = this.filter.range();
    const csv = toCsv(rows, [
      { label: 'Store', value: (x) => x.storeName },
      { label: 'Conversion %', value: (x) => x.conversionPct },
      { label: 'Revenue', value: (x) => x.revenue },
      { label: 'ATV', value: (x) => x.atv },
      { label: 'Missed opportunities', value: (x) => x.missedOpportunities },
    ]);
    saveBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `conversion-by-store_${r.from}_${r.to}.csv`);
  }

  readonly funnelChart = computed(() => conversionFlowChart(this.data.data()?.funnel));


  readonly segmentsChart = computed<EChartsCoreOption>(() => {
    const s = this.data.data()?.segments;
    const items = [
      { name: 'Bounced', value: s?.bounced ?? 0 },
      { name: 'Missed', value: s?.missedOpportunities ?? 0 },
      { name: 'Converted', value: s?.converted ?? 0 },
    ];
    return {
      tooltip: { trigger: 'item', valueFormatter: (v: number) => formatNumber(v) },
      legend: { bottom: 0 },
      grid: { left: 8, right: 8, top: 8, bottom: 32, containLabel: true },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', data: [''], show: false },
      series: items.map((it) => ({ name: it.name, type: 'bar', stack: 'seg', data: [it.value], barWidth: 28, itemStyle: { borderColor: 'transparent', borderWidth: 2 } })),
    };
  });

  readonly dailyChart = computed(() => {
    const d = this.data.data()?.daily ?? [];
    // ratios of a day without billable entities / bills are unknown (gap), not 0
    const chart = stackedGrids(
      d.map((x) => shortDate(x.date)),
      { title: 'Conversion %', fmt: 'pct', series: [{ name: 'Conversion %', type: 'line', data: d.map((x) => (x.billableEntities ? x.conversionPct : null)), area: true }] },
      { title: 'ATV (₹)', fmt: 'inr', series: [{ name: 'ATV', type: 'bar', data: d.map((x) => (x.transactions ? x.atv : null)) }] },
    );
    // today is still running: a partial "so far" day, never a drop to 0
    const i = d.findIndex((x) => x.date === storeToday());
    return i >= 0 && d.length > 1 ? markPartialDay(chart as Record<string, unknown>, i, d[i].billableEntities || d[i].transactions) : chart;
  });

  readonly perStaffChart = computed(() => {
    const h = [...(this.data.data()?.hourly ?? [])].sort((a, b) => a.hour - b.hour);
    return cartesian(
      h.map((x) => hourLabel(x.hour)),
      [{ name: 'Customers per staff', type: 'bar', data: h.map((x) => Math.round((x.customersPerStaff ?? 0) * 10) / 10) }],
      'decimal',
    );
  });

  readonly hourlyChart = computed(() => {
    const h = [...(this.data.data()?.hourly ?? [])].sort((a, b) => a.hour - b.hour);
    return stackedGrids(
      h.map((x) => hourLabel(x.hour)),
      { title: 'Missed opportunities', fmt: 'number', series: [{ name: 'Missed opportunities', type: 'bar', data: h.map((x) => x.missedOpportunities) }] },
      { title: 'Avg staff present', fmt: 'decimal', series: [{ name: 'Staff present', type: 'line', data: h.map((x) => x.staffPresentAvg) }] },
    );
  });
}
