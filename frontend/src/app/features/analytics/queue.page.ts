import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { QueueAnalytics } from '../../core/models/api.models';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { hourLabel } from '../../core/utils/dates';
import { formatDuration, formatNumber } from '../../core/utils/format';
import { stackedGrids } from '../../shared/charts/chart-builders';
import { CeColumn, DS } from '../../shared/ds';
import { QueueCardComponent } from './queue-card.component';

type Counter = QueueAnalytics['byCounter'][number];

/** Revenue › Queue: billing queue length, wait and counter attendance. */
@Component({
  selector: 'ce-queue-page',
  imports: [...DS, QueueCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-queue">
      <ce-page title="Queue" description="Billing queue length, wait time and counter attendance" [lastRefreshed]="true">
        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        }
        @let t = data.data()?.totals;
        @let busy = !t && data.loading();
        <div class="stat-grid stat-grid-6">
          <ce-stat-tile variant="band" id="avg-queue-length" label="Avg queue length" format="decimal" [value]="t?.avgQueueLength" [loading]="busy" />
          <ce-stat-tile variant="band" id="max-queue-length" label="Max queue length" [value]="t?.maxQueueLength" [loading]="busy" />
          <ce-stat-tile variant="band" id="avg-wait" label="Avg wait" format="duration" [value]="t?.avgWaitSec" [loading]="busy" />
          <ce-stat-tile variant="band" id="max-wait" label="Max wait" format="duration" [value]="t?.maxWaitSec" [loading]="busy" />
          <ce-stat-tile variant="band" id="breaches" label="Threshold breaches" [value]="t?.breaches" [loading]="busy" hint="Samples where a queue was longer than the allowed length" />
          <ce-stat-tile variant="band" id="unattended" label="Counter unattended" [value]="t?.unattendedMinutes" [loading]="busy" sub="minutes" />
        </div>

        @let d = data.data();
        <ce-card title="Live queues" icon="sensors" subtitle="Latest reading per billing counter" info="Queue length now, against the allowed length (marker). Unattended = nobody at the counter.">
          <div class="queue-cards" data-testid="live-queues">
            @for (q of d?.live ?? []; track q.zoneId) {
              <ce-queue-card [q]="q" [store]="storeName(q.storeId)" [attr.data-testid]="'queue-card-' + q.zoneId" />
            } @empty {
              @if (busy) {
                <ce-skeleton kind="tiles" [count]="4" />
              } @else {
                <ce-empty-state kind="no-data" icon="queue" title="No live queue readings" message="Queue zones report here while the stores are open." [compact]="true" />
              }
            }
          </div>
        </ce-card>

        <ce-chart-card title="Hourly queue" info="Average queue length (top) and average wait (bottom) by hour of day." [options]="hourlyChart()" [hasData]="!!d?.hourly?.length" [loading]="data.loading()" chartTestId="chart-queue-hourly" height="320px" />

        <ce-table
          [rows]="d?.byCounter ?? []"
          [columns]="cols"
          [loading]="busy"
          title="Per counter"
          [searchable]="true"
          searchPlaceholder="Search counters or stores"
          testId="table-queue-counters"
          [rowTestId]="rowId"
          [pageSize]="50"
          [defaultSort]="{ key: 'breaches', dir: 'desc' }"
          emptyIcon="queue"
          emptyTitle="No queue zones"
        />
      </ce-page>
    </section>
  `,
})
export class QueuePage {
  private readonly api = inject(AnalyticsApi);
  private readonly filter = inject(FilterService);
  readonly data = loadOn(() => this.filter.params(), (p) => this.api.queue(p));
  readonly rowId = (r: Counter) => `row-counter-${r.zoneId}`;
  readonly cols: CeColumn<Counter>[] = [
    { key: 'name', header: 'Counter', sortable: true, locked: true },
    { key: 'storeName', header: 'Store', sortable: true },
    { key: 'avgQueueLength', header: 'Avg length', type: 'number', format: (v) => formatNumber(v as number, 1), sortable: true },
    { key: 'maxQueueLength', header: 'Max length', type: 'number', sortable: true },
    { key: 'avgWaitSec', header: 'Avg wait', type: 'number', format: (v) => formatDuration(v as number), sortable: true },
    { key: 'breaches', header: 'Breaches', type: 'number', sortable: true },
  ];

  storeName(id: number): string {
    return this.data.data()?.byCounter.find((c) => c.storeId === id)?.storeName ?? '';
  }

  readonly hourlyChart = computed(() => {
    const h = [...(this.data.data()?.hourly ?? [])].sort((a, b) => a.hour - b.hour);
    return stackedGrids(
      h.map((x) => hourLabel(x.hour)),
      { title: 'Avg queue length', fmt: 'decimal', series: [{ name: 'Avg queue length', type: 'bar', data: h.map((x) => x.avgQueueLength) }] },
      { title: 'Avg wait (s)', fmt: 'sec', series: [{ name: 'Avg wait', type: 'line', data: h.map((x) => x.avgWaitSec) }] },
    );
  });
}
