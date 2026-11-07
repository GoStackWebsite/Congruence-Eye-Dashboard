import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ZoneAnalytics, ZoneClass } from '../../core/models/api.models';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { formatDuration, formatNumber, formatPct, humanize } from '../../core/utils/format';
import { cartesian } from '../../shared/charts/chart-builders';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { StatusChipComponent } from '../../shared/ui/ui.components';
import { saveBlob } from '../../core/services/api.service';
import { toCsv } from '../../core/utils/csv';
import { ZoneConcentrationComponent } from './zone-concentration.component';

/** Zone › Zone concentration: concentration summary (reference 03), zone classes, dwell ranking and the zone table. */
@Component({
  selector: 'ce-zones-page',
  imports: [...DS, StatusChipComponent, ZoneConcentrationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-zones">
      <ce-page title="Zone concentration" description="Zone visits, dwell and engagement — HOT ≥ 1.25× the store's zone average, DEAD ≤ 0.5×" [lastRefreshed]="true">
        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        }
        @let busy = !data.data() && data.loading();
        <ce-stat-strip label="Zone classes">
          <ce-stat-tile variant="strip" id="zones-hot" label="Hot zones" [value]="count('HOT')" [loading]="busy" hint="Visits ≥ 1.25× the store's zone average" />
          <ce-stat-tile variant="strip" id="zones-warm" label="Warm zones" [value]="count('WARM')" [loading]="busy" />
          <ce-stat-tile variant="strip" id="zones-dead" label="Dead zones" [value]="count('DEAD')" [loading]="busy" hint="Visits ≤ 0.5× the store's zone average" />
          <ce-stat-tile variant="strip" id="zones-visits" label="Zone visits" [value]="data.data() ? totalVisits() : undefined" [loading]="busy" />
        </ce-stat-strip>

        @if (rows().length) {
          <ce-zone-concentration [rows]="rows()" />
          <ce-chart-card title="Average dwell by zone" subtitle="Top 15" info="Average time a visitor spent in each zone; zones of several stores are labelled with the store." [options]="dwellChart()" [height]="chartHeight()" chartTestId="chart-zone-dwell" />
        } @else if (busy) {
          <ce-skeleton kind="chart" height="420px" />
        }

        <ce-table
          [rows]="filtered()"
          [columns]="cols"
          [loading]="busy"
          title="All zones"
          [searchable]="true"
          searchPlaceholder="Search zones or stores"
          [exportable]="true"
          (exportClick)="exportCsv($event)"
          exportTestId="btn-export-zones"
          [columnChooser]="true"
          testId="table-zones"
          [rowTestId]="rowId"
          [pageSize]="100"
          emptyIcon="grid_view"
          [emptyTitle]="classFilter() === 'ALL' ? 'No zones' : 'No ' + classFilter().toLowerCase() + ' zones'"
          emptyMessage="Tag SECTION zones on camera views under Admin › Stores › Cameras."
        >
          <ce-segmented tableFilters [options]="classOptions" [value]="classFilter()" (valueChange)="classFilter.set($any($event))" label="Filter by class" data-testid="filter-zone-class" />
          <ng-template ceCell="classification" let-z>
            <ce-chip [value]="z.classification" testId="chip-zone-class" />
          </ng-template>
          <ng-template ceCell="avgDwellSec" let-z>
            <span class="mini-bar"><span [style.width.%]="dwellPct(z)"></span></span><span class="tabular">{{ dur(z.avgDwellSec) }}</span>
          </ng-template>
        </ce-table>
      </ce-page>
    </section>
  `,
})
export class ZonesPage {
  private readonly api = inject(AnalyticsApi);
  private readonly filter = inject(FilterService);
  readonly data = loadOn(() => this.filter.params(), (p) => this.api.zones(p));
  readonly classFilter = signal<'ALL' | ZoneClass>('ALL');
  readonly classOptions: TabItem[] = [
    { value: 'ALL', label: 'All' },
    { value: 'HOT', label: 'Hot' },
    { value: 'WARM', label: 'Warm' },
    { value: 'DEAD', label: 'Dead' },
  ];
  readonly rowId = (z: ZoneAnalytics) => `row-zone-${z.id}`;
  readonly cols: CeColumn<ZoneAnalytics>[] = [
    { key: 'name', header: 'Zone', sortable: true, secondary: (z) => humanize(z.type), locked: true },
    { key: 'storeName', header: 'Store', sortable: true },
    { key: 'classification', header: 'Class', sortable: true },
    { key: 'visits', header: 'Visits', type: 'number', sortable: true },
    { key: 'uniqueVisitors', header: 'Unique', type: 'number', sortable: true, hidden: true },
    { key: 'avgDwellSec', header: 'Avg dwell', sortable: true, searchable: false },
    { key: 'engagedPct', header: 'Engaged', type: 'percent', sortable: true },
    { key: 'bouncedPct', header: 'Bounced', type: 'percent', sortable: true },
    { key: 'concentrationPct', header: 'Concentration', type: 'percent', sortable: true },
    { key: 'dominantAgeBand', header: 'Dominant age', sortable: true },
    {
      key: 'gender',
      header: 'Gender split',
      align: 'right',
      searchable: false,
      value: (z) => (z.genderSplit ? `M ${formatPct(z.genderSplit.malePct, 0)} · F ${formatPct(z.genderSplit.femalePct, 0)}` : `${formatNumber(z.male)} / ${formatNumber(z.female)}`),
    },
  ];

  readonly rows = computed(() => this.data.data() ?? []);
  readonly filtered = computed(() => {
    const f = this.classFilter();
    return this.rows().filter((z) => f === 'ALL' || z.classification === f);
  });
  readonly maxDwell = computed(() => Math.max(1, ...this.rows().map((z) => z.avgDwellSec)));
  readonly totalVisits = computed(() => this.rows().reduce((s, z) => s + z.visits, 0));
  readonly topDwell = computed(() => [...this.rows()].sort((a, b) => b.avgDwellSec - a.avgDwellSec).slice(0, 15));
  readonly chartHeight = computed(() => `${Math.max(220, this.topDwell().length * 28 + 40)}px`);

  dur(v: number): string {
    return formatDuration(v);
  }

  exportCsv(rows: ZoneAnalytics[]): void {
    const r = this.filter.range();
    const csv = toCsv(rows, [
      { label: 'Zone', value: (z) => z.name },
      { label: 'Store', value: (z) => z.storeName },
      { label: 'Class', value: (z) => z.classification },
      { label: 'Visits', value: (z) => z.visits },
      { label: 'Unique visitors', value: (z) => z.uniqueVisitors },
      { label: 'Avg dwell (s)', value: (z) => Math.round(z.avgDwellSec) },
      { label: 'Engaged %', value: (z) => z.engagedPct },
      { label: 'Bounced %', value: (z) => z.bouncedPct },
      { label: 'Concentration %', value: (z) => z.concentrationPct },
    ]);
    saveBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `zones_${r.from}_${r.to}.csv`);
  }

  count(c: ZoneClass): number | undefined {
    return this.data.data() ? this.rows().filter((z) => z.classification === c).length : undefined;
  }
  dwellPct(z: ZoneAnalytics): number {
    return (z.avgDwellSec / this.maxDwell()) * 100;
  }

  protected readonly dwellChart = computed(() => {
    const multiStore = new Set(this.rows().map((z) => z.storeId)).size > 1;
    const t = this.topDwell();
    return cartesian(
      t.map((z) => (multiStore ? `${z.name} · ${z.storeName}` : z.name)),
      [{ name: 'Avg dwell (s)', type: 'bar', data: t.map((z) => Math.round(z.avgDwellSec)) }],
      'sec',
      { horizontal: true },
    );
  });
}
