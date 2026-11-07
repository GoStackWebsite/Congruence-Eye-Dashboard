import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { StoreOps } from '../../core/models/api.models';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { hourLabel } from '../../core/utils/dates';
import { formatPct } from '../../core/utils/format';
import { cartesian } from '../../shared/charts/chart-builders';
import { storeToday } from './analytics-helpers';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { DateTimePipe, HumanizePipe, PctPipe } from '../../shared/pipes';

type OpenClose = StoreOps['openClose'][number];
type CamHealth = StoreOps['cameraHealth'][number];
const BAD_EVENTS = new Set(['SOP_BREACH', 'COUNTER_UNATTENDED', 'STAFF_ABSENT', 'LIGHTS_OFF', 'CAMERA_TAMPER']);

/** Store Ops › Store activity: open/close compliance, camera health, staff presence and SOP events. */
@Component({
  selector: 'ce-store-ops-page',
  imports: [...DS, PctPipe, DateTimePipe, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-store-ops">
      <ce-page title="Store activity" description="Opening / closing compliance, SOP events, camera health and staff presence" [lastRefreshed]="true">
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
          <ce-stat-tile variant="band" id="late-openings" label="Late openings" [value]="t?.lateOpenings" [loading]="busy" [lowerIsBetter]="true" />
          <ce-stat-tile variant="band" id="early-closings" label="Early closings" [value]="t?.earlyClosings" [loading]="busy" />
          <ce-stat-tile variant="band" id="sop-breaches" label="SOP breaches" [value]="t?.sopBreaches" [loading]="busy" />
          <ce-stat-tile variant="band" id="camera-uptime" label="Camera uptime" format="pct" [value]="t?.cameraUptimePct" [loading]="busy" hint="Share of the period cameras were reporting" />
          <ce-stat-tile variant="band" id="downtime" label="Downtime" [value]="t?.downtimeMinutes" sub="minutes" [loading]="busy" />
          <ce-stat-tile variant="band" id="offline-cameras" label="Offline cameras" [value]="t?.offlineCameras" [loading]="busy" />
        </div>

        @let d = data.data();
        <ce-table
          [rows]="ocRows()"
          [columns]="ocCols"
          [loading]="busy"
          title="Open / close compliance"
          subtitle="Scheduled vs detected opening and closing, store-local time"
          [searchable]="true"
          searchPlaceholder="Search stores"
          testId="table-open-close"
          [rowTestId]="ocRowId"
          [rowClass]="ocRowClass"
          [pageSize]="10"
          [defaultSort]="{ key: 'date', dir: 'desc' }"
          emptyIcon="door_open"
          [emptyTitle]="ocFilter() === 'issues' ? 'No late openings or early closings' : 'No open / close data for these filters'"
        >
          <ce-segmented tableFilters [options]="ocOptions" [value]="ocFilter()" (valueChange)="ocFilter.set($any($event))" label="Rows" data-testid="filter-open-close" />
          <ng-template ceCell="status" let-r>
            @if (r.lateOpenMin > 0 || r.earlyCloseMin > 0) {
              <ce-pill value="OVERDUE" [label]="r.lateOpenMin > 0 && r.earlyCloseMin > 0 ? 'Late & early' : r.lateOpenMin > 0 ? 'Late open' : 'Early close'" />
            } @else if (!r.actualOpen || !r.actualClose) {
              <!-- nothing detected yet: never claim "On time" -->
              @if (r.date >= today) {
                <ce-pill value="PENDING" tone="info" label="Awaiting" />
              } @else {
                <ce-pill value="UNKNOWN" label="Not detected" />
              }
            } @else {
              <ce-pill value="ON_TIME" label="On time" />
            }
          </ng-template>
        </ce-table>

        <div class="an-grid-2-1">
          <ce-table
            [rows]="camRows()"
            [columns]="camCols"
            [loading]="busy"
            title="Camera health"
            subtitle="Offline cameras first, then the lowest uptime"
            testId="table-camera-health"
            [rowTestId]="camRowId"
            [pageSize]="10"
            emptyIcon="videocam_off"
            emptyTitle="No cameras"
          >
            <ng-template ceCell="uptimePct" let-c>
              <span class="mini-bar" [class.bad]="c.uptimePct < 95"><span [style.width.%]="c.uptimePct"></span></span>
              <span class="tabular" [class.cell-bad]="c.uptimePct < 95">{{ c.uptimePct | pct }}</span>
            </ng-template>
          </ce-table>
          <ce-chart-card title="Staff presence" subtitle="Average staff on the floor by hour" info="Average number of staff detected per hour across the selected stores and days." [options]="staffChart()" [hasData]="!!d?.staffPresence?.length" [loading]="data.loading()" chartTestId="chart-staff-presence" height="300px" />
        </div>

        <ce-card title="SOP & store events" icon="event_note" [subtitle]="'Newest ' + (d?.events?.length ?? 0)" info="Store-ops events detected by the edge boxes (opening, closing, SOP breaches, unattended counters…).">
          <ul class="timeline" data-testid="storeops-events" tabindex="0" aria-label="Store events">
            @for (e of d?.events ?? []; track e.id) {
              <li [class.ev-bad]="isBad(e.type)" [attr.data-testid]="'storeops-event-' + e.id">
                <div class="tl-row">
                  <span class="strong">{{ e.type | humanize }}</span>
                  @if (isBad(e.type)) {
                    <ce-pill value="BREACHED" label="Breach" size="sm" />
                  }
                  <span class="caption">{{ e.storeName }} · {{ e.ts | dt }}</span>
                </div>
                @if (e.details) {
                  <div class="muted small">{{ e.details }}</div>
                }
              </li>
            } @empty {
              @if (busy) {
                <ce-skeleton kind="text" [count]="4" />
              } @else {
                <ce-empty-state kind="filtered" icon="event_available" title="No events in this period" [compact]="true" />
              }
            }
          </ul>
        </ce-card>
      </ce-page>
    </section>
  `,
})
export class StoreOpsPage {
  protected readonly today = storeToday();
  private readonly api = inject(AnalyticsApi);
  private readonly filter = inject(FilterService);
  readonly data = loadOn(() => this.filter.params(), (p) => this.api.storeOps(p));
  readonly ocFilter = signal<'all' | 'issues'>('all');
  readonly ocOptions: TabItem[] = [
    { value: 'all', label: 'All' },
    { value: 'issues', label: 'Late / early only' },
  ];
  readonly ocRows = computed(() => {
    const rows = this.data.data()?.openClose ?? [];
    return this.ocFilter() === 'all' ? rows : rows.filter((r) => r.lateOpenMin > 0 || r.earlyCloseMin > 0);
  });
  /** Cameras that are down right now come first (whatever their 30-day uptime), then the lowest uptime. */
  readonly camRows = computed(() =>
    [...(this.data.data()?.cameraHealth ?? [])].sort((a, b) => Number(b.status === 'OFFLINE') - Number(a.status === 'OFFLINE') || a.uptimePct - b.uptimePct),
  );
  readonly ocRowId = (r: OpenClose) => `row-open-close-${r.storeId}-${r.date}`;
  readonly ocRowClass = (r: OpenClose) => (r.lateOpenMin > 0 || r.earlyCloseMin > 0 ? 'row-late' : '');
  readonly camRowId = (c: CamHealth) => `row-camera-health-${c.cameraId}`;
  readonly ocCols: CeColumn<OpenClose>[] = [
    { key: 'date', header: 'Date', type: 'date', sortable: true },
    { key: 'storeName', header: 'Store', sortable: true },
    {
      key: 'open',
      header: 'Open (sched → actual)',
      value: (r) => `${r.scheduledOpen} → ${r.actualOpen ?? 'not detected'}${r.lateOpenMin > 0 ? ` (+${r.lateOpenMin} min late)` : ''}`,
      cellClass: (r) => (r.lateOpenMin > 0 ? 'cell-bad' : null),
      cellAttrs: (r) => ({ 'data-late': String(r.lateOpenMin > 0) }),
      searchable: false,
    },
    {
      key: 'close',
      header: 'Close (sched → actual)',
      value: (r) => `${r.scheduledClose} → ${r.actualClose ?? 'not detected'}${r.earlyCloseMin > 0 ? ` (${r.earlyCloseMin} min early)` : ''}`,
      cellClass: (r) => (r.earlyCloseMin > 0 ? 'cell-warn' : null),
      cellAttrs: (r) => ({ 'data-early': String(r.earlyCloseMin > 0) }),
      searchable: false,
    },
    { key: 'status', header: 'Status', value: (r) => (r.lateOpenMin > 0 || r.earlyCloseMin > 0 ? 'issue' : 'ok'), searchable: false },
  ];
  readonly camCols: CeColumn<CamHealth>[] = [
    { key: 'name', header: 'Camera', sortable: true, secondary: (c) => c.storeName },
    { key: 'status', header: 'Status', type: 'pill', sortable: true },
    { key: 'uptimePct', header: 'Uptime', sortable: true, value: (c) => c.uptimePct, format: (v) => formatPct(v as number) },
    { key: 'lastHeartbeatAt', header: 'Last heartbeat', type: 'datetime', sortable: true },
  ];

  isBad(t: string): boolean {
    return BAD_EVENTS.has(t);
  }

  readonly staffChart = computed(() => {
    const s = [...(this.data.data()?.staffPresence ?? [])].sort((a, b) => a.hour - b.hour);
    return cartesian(
      s.map((x) => hourLabel(x.hour)),
      [{ name: 'Avg staff', type: 'bar', data: s.map((x) => x.avgStaff) }],
      'decimal',
    );
  });
}
