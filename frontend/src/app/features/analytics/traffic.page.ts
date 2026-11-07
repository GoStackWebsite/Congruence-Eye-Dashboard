import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { saveBlob } from '../../core/services/api.service';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { toCsv } from '../../core/utils/csv';
import { dowLabel, hourLabel, shortDate } from '../../core/utils/dates';
import { formatDuration, formatNumber } from '../../core/utils/format';
import { DENSITY_DOWS, DENSITY_RAMP, DOW_SHORT, densityMatrix } from '../../core/utils/v2-helpers';
import { FLOW_RAMP, cartesian, conversionFlowStages, conversionFunnelChart, donut } from '../../shared/charts/chart-builders';
import { DS, TabItem } from '../../shared/ds';
import { Granularity, markPartialDay, safePct, storeToday, toWeekly } from './analytics-helpers';
import { GenderDwellComponent } from './gender-dwell.component';

/** Traffic › Footfall & funnel: KPIs, daily trend, visitor mix, reference-01 conversion funnel, gender & dwell, density. */
@Component({
  selector: 'ce-traffic-page',
  imports: [MatIconModule, MatMenuModule, MatTooltipModule, ...DS, GenderDwellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-traffic">
      <ce-page title="Footfall & funnel" description="Footfall in/out with staff excluded, visitor quality, conversion flow and timing" [lastRefreshed]="true">
        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        }
        @let t = data.data()?.totals;
        @let busy = !t && data.loading();
        <div class="stat-grid" data-testid="kpi-grid">
          <ce-stat-tile id="footfall-in" label="Footfall in" icon="login" [value]="t?.footfallIn" [loading]="busy" [sub]="'Out: ' + num(t?.footfallOut)" hint="Customer entries; staff are excluded" />
          <ce-stat-tile id="unique-visitors" label="Unique visitors" icon="person" [value]="t?.uniqueVisitors" [loading]="busy" hint="Distinct people (re-identified across cameras)" />
          <ce-stat-tile id="billable-entities" label="Billable entities" icon="groups" [value]="t?.billableEntities" [loading]="busy" [sub]="num(t?.individuals) + ' individuals · ' + num(t?.groups) + ' groups'" hint="Individuals + groups (a group shops as one)" />
          <ce-stat-tile id="staff-excluded" label="Staff excluded" icon="badge" [value]="t?.staffExcluded" [loading]="busy" />
          <ce-stat-tile id="capture-rate" label="Capture rate" icon="storefront" format="pct" [value]="t ? (t.captureRatePct ?? null) : undefined" [loading]="busy" [sub]="num(t?.passBy) + ' passers-by'" hint="Walk-ins ÷ people who passed the store front" />
          <ce-stat-tile id="avg-dwell" label="Avg. dwell" icon="timer" format="duration" [value]="t ? (t.footfallIn ? t.avgDwellSec : null) : undefined" [loading]="busy" />
          <ce-stat-tile id="engaged" label="Engaged" icon="touch_app" format="pct" [value]="engagedPct()" [loading]="busy" [sub]="num(t?.engaged) + ' visits'" hint="Visits that engaged with a zone" />
          <ce-stat-tile id="bounced" label="Bounce rate" icon="logout" format="pct" [value]="bouncePct()" [loading]="busy" [sub]="num(t?.bounced) + ' visits'" hint="Visits that left without engaging" />
          <ce-stat-tile id="repeat-visitors" label="Repeat visitors" icon="replay" format="pct" [value]="repeatPct()" [loading]="busy" [sub]="num(t?.repeatVisitors) + ' repeat · ' + num(t?.newVisitors) + ' new'" />
          <ce-stat-tile id="peak-hour" label="Peak hour" icon="schedule" [loading]="busy" [text]="peakLabel()" sub="Busiest hour of the day" />
        </div>

        <div class="an-grid-2-1">
          <ce-chart-card
            title="Daily footfall"
            icon="directions_walk"
            [subtitle]="rangeLabel()"
            info="Customer entries (in) and exits (out) per day, with unique visitors. Staff are excluded."
            [options]="dailyChart()"
            [hasData]="!!data.data()?.daily?.length"
            [loading]="data.loading()"
            [error]="data.error()"
            (retry)="data.reload()"
            [granularities]="granularities"
            [(granularity)]="granularity"
            chartTestId="chart-traffic-daily"
            height="300px"
            ariaLabel="Daily footfall in and out"
          />
          <ce-card title="Gender & dwell time" icon="wc" [subtitle]="'As of ' + rangeEnd()" info="Share of known-gender visitors, average dwell and the age mix (male / female per age band)." data-testid="card-gender-dwell">
            @if (demo.data(); as g) {
              <ce-gender-dwell [male]="g.gender.male" [female]="g.gender.female" [dwellSec]="data.data()?.totals?.avgDwellSec" [dominantAge]="dominantAge()" />
              <ce-chart [options]="genderAgeChart()" height="170px" testId="chart-gender-dwell" ariaLabel="Male and female visitors by age band" />
            } @else if (demo.loading()) {
              <ce-skeleton kind="text" [count]="4" />
            } @else {
              <ce-empty-state kind="filtered" icon="wc" title="No demographics for these filters" [compact]="true" />
            }
          </ce-card>
        </div>

        <ce-card title="Conversion flow chart" icon="filter_alt" [subtitle]="'From ' + rangeLabel()" info="Footfall → engagers (engaged with a zone) → billable entities (individuals + groups) → conversion (transactions). Percentages are of footfall." data-testid="traffic-conversion-flow">
          <button cardActions type="button" class="ce-icon-btn sm" (click)="downloadFlowCsv()" [disabled]="!conv.data()" matTooltip="Download CSV" aria-label="Download conversion flow CSV" data-testid="btn-download-csv-conversion-flow">
            <mat-icon>download</mat-icon>
          </button>
          @if (conv.data()) {
            <ce-chart [options]="flowChart()" height="240px" testId="chart-conversion-flow" ariaLabel="Conversion flow from footfall to conversion" />
            <div class="flow-legend">
              @for (s of flowStages(); track s.key; let i = $index) {
                <span class="fl-item"><span class="fl-swatch" [style.background]="flowRamp[i]"></span>{{ s.label }} : <b>{{ num(s.value) }}</b></span>
              }
            </div>
          } @else if (conv.loading()) {
            <ce-skeleton kind="chart" height="220px" />
          } @else {
            <ce-empty-state kind="filtered" icon="filter_alt" title="No conversion data for these filters" [compact]="true" />
          }
        </ce-card>

        <div class="an-grid-3">
          <ce-chart-card title="Individuals vs groups" info="Billable entities split into people shopping alone and groups (a group counts once)." [options]="groupsChart()" [hasData]="!!t && (t.individuals + t.groups) > 0" [loading]="data.loading()" chartTestId="chart-individuals-groups" height="240px" />
          <ce-chart-card title="Engaged vs casual vs bounced" info="Engaged: stayed in a zone long enough to engage. Casual: walked through. Bounced: left without engaging." [options]="engagementChart()" [hasData]="!!t && (t.engaged + t.casual + t.bounced) > 0" [loading]="data.loading()" chartTestId="chart-engagement" height="240px" />
          <ce-chart-card title="Repeat vs new" info="Visitors seen before in the last 30 days vs first-time visitors." [options]="repeatChart()" [hasData]="!!t && (t.repeatVisitors + t.newVisitors) > 0" [loading]="data.loading()" chartTestId="chart-repeat-new" height="240px" />
        </div>

        <ce-card title="Traffic density" icon="timer" [subtitle]="'Average footfall per hour and weekday · ' + rangeLabel()" info="Average customer entries for each opening hour (rows) and weekday (columns) over the period. Darker = busier." data-testid="traffic-density">
          <ng-container cardActions>
            <span class="dens-legend" aria-hidden="true">Low <span class="legend-ramp">@for (c of ramp; track c) {<span [style.background]="c"></span>}</span> High</span>
            <button type="button" class="ce-icon-btn sm" (click)="downloadDensityCsv()" [disabled]="!densityRows().length" matTooltip="Download CSV" aria-label="Download traffic density CSV" data-testid="btn-download-csv-traffic-density">
              <mat-icon>download</mat-icon>
            </button>
          </ng-container>
          @if (densityRows().length) {
            <div class="table-scroll">
              <table class="density-table" data-testid="table-traffic-density">
                <thead>
                  <tr>
                    <th class="hour">Hour</th>
                    @for (d of dows; track d) {
                      <th>{{ dowShort[d] }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (r of densityRows(); track r.hour) {
                    <tr [attr.data-testid]="'density-row-' + r.hour">
                      <th class="hour">{{ r.label }}</th>
                      @for (c of r.cells; track c.dow) {
                        <td [style.background]="c.bg" [style.color]="c.fg" [attr.data-testid]="'density-cell-' + r.hour + '-' + c.dow" [attr.title]="dowShort[c.dow] + ' ' + r.label + ': ' + num(c.value)">{{ num(c.value) }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else if (density.loading()) {
            <ce-skeleton kind="table" [count]="6" />
          } @else if (density.error()) {
            <ce-empty-state kind="error" [message]="density.error()" [compact]="true">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="density.reload()">Retry</button>
            </ce-empty-state>
          } @else {
            <ce-empty-state kind="filtered" icon="grid_on" title="No density data for these filters" [compact]="true" />
          }
        </ce-card>

        <div class="an-grid-3">
          <ce-chart-card title="Hourly footfall" [subtitle]="'Avg per day · peak ' + peakLabel()" info="Average customer entries per hour of the day across the period; the peak hour is highlighted." [options]="hourlyChart()" [hasData]="!!data.data()?.hourly?.length" [loading]="data.loading()" chartTestId="chart-traffic-hourly" height="280px" />
          <ce-chart-card title="Drop-off by hour" subtitle="Bounced % of visits" info="Share of visits in each open hour that left without engaging. Closed hours are left out (no rate, not 0 %)." [options]="bouncedChart()" [hasData]="!!data.data()?.hourly?.length" [loading]="data.loading()" chartTestId="chart-hourly-bounced" height="280px" />
          <ce-chart-card title="Day of week" subtitle="Avg footfall per day" info="Average customer entries for each weekday in the period." [options]="dowChart()" [hasData]="!!data.data()?.dayOfWeek?.length" [loading]="data.loading()" chartTestId="chart-traffic-dow" height="280px" />
        </div>
      </ce-page>
    </section>
  `,
})
export class TrafficPage {
  private readonly api = inject(AnalyticsApi);
  private readonly filter = inject(FilterService);
  private readonly v2 = inject(V2Api);
  readonly data = loadOn(() => this.filter.params(), (p) => this.api.traffic(p));
  readonly density = loadOn(() => this.filter.params(), (p) => this.v2.trafficDensity(p));
  readonly conv = loadOn(() => this.filter.params(), (p) => this.api.conversion(p));
  readonly demo = loadOn(() => this.filter.params(), (p) => this.api.demographics(p));
  readonly dows = DENSITY_DOWS;
  readonly dowShort = DOW_SHORT;
  readonly ramp = DENSITY_RAMP;
  readonly flowRamp = FLOW_RAMP;
  readonly granularities: TabItem[] = [
    { value: 'daily', label: 'Daily', testId: 'gran-daily' },
    { value: 'weekly', label: 'Weekly', testId: 'gran-weekly' },
  ];
  readonly granularity = signal<Granularity>('daily');

  readonly rangeLabel = computed(() => {
    const r = this.filter.range();
    return r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} – ${shortDate(r.to)}`;
  });
  readonly rangeEnd = computed(() => shortDate(this.filter.range().to));
  readonly densityRows = computed(() => densityMatrix(this.density.data()));
  readonly flowStages = computed(() => conversionFlowStages(this.conv.data()?.funnel));
  readonly flowChart = computed(() => conversionFunnelChart(this.conv.data()?.funnel));
  readonly genderPct = computed(() => {
    const g = this.demo.data()?.gender;
    const t = g ? g.male + g.female : 0;
    return { male: t ? Math.round((g!.male / t) * 100) : 0, female: t ? Math.round((g!.female / t) * 100) : 0 };
  });
  readonly dwell = computed(() => formatDuration(this.data.data()?.totals.avgDwellSec));
  readonly dominantAge = computed(() => {
    const a = (this.demo.data()?.age ?? []).filter((x) => x.band !== 'U');
    return a.length ? a.reduce((m, x) => (x.count > m.count ? x : m)).band : '--';
  });
  readonly genderAgeChart = computed(() => {
    const a = (this.demo.data()?.genderByAge ?? []).filter((x) => x.band !== 'U');
    const opt = cartesian(
      a.map((x) => x.band),
      [
        { name: 'Male', type: 'bar', stack: 'g', data: a.map((x) => x.male) },
        { name: 'Female', type: 'bar', stack: 'g', data: a.map((x) => x.female) },
      ],
    ) as Record<string, unknown>;
    // male / female keep the person colours used in the gender stats above
    return { ...opt, color: ['#2E90FA', '#EE46BC'] };
  });
  readonly bouncedChart = computed(() => {
    // only hours with traffic: a closed hour has no drop-off rate (not 0 %)
    const h = [...(this.data.data()?.hourly ?? [])].filter((x) => x.footfall > 0).sort((a, b) => a.hour - b.hour);
    return cartesian(
      h.map((x) => hourLabel(x.hour)),
      [{ name: 'Bounced %', type: 'line', area: true, data: h.map((x) => (x.bouncedPct === undefined ? null : Math.round(x.bouncedPct * 10) / 10)) }],
      'pct',
    );
  });

  num(v: number | undefined | null) {
    return v === null || v === undefined ? '--' : formatNumber(v);
  }

  protected readonly engagedPct = computed(() => {
    const t = this.data.data()?.totals;
    return t ? safePct(t.engaged, t.engaged + t.casual + t.bounced) : undefined;
  });
  protected readonly bouncePct = computed(() => {
    const t = this.data.data()?.totals;
    return t ? safePct(t.bounced, t.engaged + t.casual + t.bounced) : undefined;
  });
  protected readonly repeatPct = computed(() => {
    const t = this.data.data()?.totals;
    return t ? safePct(t.repeatVisitors, t.repeatVisitors + t.newVisitors) : undefined;
  });
  protected readonly peakLabel = computed(() => {
    const d = this.data.data();
    if (!d || !d.hourly?.some((h) => h.footfall > 0)) return '--';
    const h = d.peakHour;
    return `${hourLabel(h)} – ${hourLabel(h + 1)}`;
  });

  protected readonly dailyChart = computed(() => {
    const daily = this.data.data()?.daily ?? [];
    const weekly = this.granularity() === 'weekly';
    const rows = weekly ? toWeekly(daily, ['footfallIn', 'footfallOut', 'uniqueVisitors']) : daily.map((d) => ({ ...d, label: shortDate(d.date) }));
    const chart = cartesian(
      rows.map((x) => x.label),
      [
        // hasData: false (contract v4) = no edge data for the day → a gap, not a real 0
        { name: 'In', type: 'bar', data: rows.map((x) => (x.hasData === false ? null : (x.footfallIn ?? null))) },
        { name: 'Out', type: 'bar', data: rows.map((x) => (x.hasData === false ? null : (x.footfallOut ?? null))) },
        { name: 'Unique', type: 'line', data: rows.map((x) => (x.hasData === false ? null : (x.uniqueVisitors ?? null))) },
      ],
    );
    // today is still running (isPartial from the API, else the store-local date): a "so far" day, never a drop to 0
    const today = storeToday();
    const i = weekly ? -1 : rows.findIndex((x) => x.isPartial ?? x.date === today);
    return i >= 0 && rows.length > 1 ? markPartialDay(chart as Record<string, unknown>, i, rows[i].footfallIn) : chart;
  });
  protected readonly groupsChart = computed(() => {
    const t = this.data.data()?.totals;
    return donut([
      { name: 'Individuals', value: t?.individuals ?? 0 },
      { name: 'Groups', value: t?.groups ?? 0 },
    ]);
  });
  protected readonly engagementChart = computed(() => {
    const t = this.data.data()?.totals;
    return donut([
      { name: 'Engaged', value: t?.engaged ?? 0 },
      { name: 'Casual', value: t?.casual ?? 0 },
      { name: 'Bounced', value: t?.bounced ?? 0 },
    ]);
  });
  protected readonly repeatChart = computed(() => {
    const t = this.data.data()?.totals;
    return donut([
      { name: 'New', value: t?.newVisitors ?? 0 },
      { name: 'Repeat', value: t?.repeatVisitors ?? 0 },
    ]);
  });
  protected readonly hourlyChart = computed(() => {
    const h = [...(this.data.data()?.hourly ?? [])].sort((a, b) => a.hour - b.hour);
    const peak = this.data.data()?.peakHour;
    const opt = cartesian(
      h.map((x) => hourLabel(x.hour)),
      [{ name: 'Avg footfall / day', type: 'bar', data: h.map((x) => x.avgPerDay) }],
      'decimal',
    ) as Record<string, unknown>;
    (opt['series'] as Record<string, unknown>[])[0]['data'] = h.map((x) => ({
      value: x.avgPerDay,
      itemStyle: x.hour === peak ? { color: '#1570EF' } : { color: '#84CAFF' },
    }));
    return opt;
  });
  protected readonly dowChart = computed(() => {
    const d = [...(this.data.data()?.dayOfWeek ?? [])].sort((a, b) => ((a.dow + 6) % 7) - ((b.dow + 6) % 7));
    return cartesian(
      d.map((x) => dowLabel(x.dow)),
      [{ name: 'Avg footfall / day', type: 'bar', data: d.map((x) => x.avgPerDay) }],
      'decimal',
    );
  });

  downloadDensityCsv(): void {
    const r = this.filter.range();
    const csv = toCsv(this.densityRows(), [
      { label: 'Hour', value: (x) => x.label },
      ...this.dows.map((d, i) => ({ label: this.dowShort[d], value: (x: ReturnType<typeof densityMatrix>[number]) => x.cells[i].value })),
    ]);
    saveBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `traffic-density_${r.from}_${r.to}.csv`);
  }

  downloadFlowCsv(): void {
    const r = this.filter.range();
    const csv = toCsv(this.flowStages(), [
      { label: 'Stage', value: (x) => x.label },
      { label: 'Count', value: (x) => x.value },
      { label: '% of footfall', value: (x) => x.pctOfFootfall },
    ]);
    saveBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `conversion-flow_${r.from}_${r.to}.csv`);
  }
}
