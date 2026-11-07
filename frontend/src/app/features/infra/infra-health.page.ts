import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { catchError, interval, of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { InfraHealth, InfraHealthStatus, Ticket } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { humanize } from '../../core/utils/format';
import { localizeTimestamps } from '../../core/utils/dates';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { EntityDrawerComponent } from '../../shared/ds/entity-drawer.component';
import { DateTimePipe, LocalTimesPipe, PctPipe } from '../../shared/pipes';
import { UiService } from '../../shared/ui/ui.service';
import { useOpsStyles } from '../../shared/ds/ops.styles';
import { ticketFields } from '../tickets/tickets.page';

type StoreHealth = InfraHealth['stores'][number];
export const INFRA_CATEGORIES = ['CAMERA', 'NETWORK', 'INFRASTRUCTURE'];
const HEALTH_RANK: Record<InfraHealthStatus, number> = { DOWN: 0, DEGRADED: 1, GOOD: 2 };

/** Health chip value → tone mapping used by <ce-chip>. */
export function healthChip(h: InfraHealthStatus): { value: string; label: string } {
  return h === 'GOOD' ? { value: 'DONE', label: 'Good' } : h === 'DEGRADED' ? { value: 'PENDING', label: 'Degraded' } : { value: 'OVERDUE', label: 'Down' };
}

/** Worst first, then by name. */
export function sortByHealth(rows: StoreHealth[]): StoreHealth[] {
  return [...rows].sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || a.storeName.localeCompare(b.storeName));
}

/** One segment per camera (online first) for the mini bar; large stores are scaled to 24 segments. */
export function cameraSegments(online: number, total: number, max = 24): ('on' | 'off')[] {
  if (total <= 0) return [];
  const n = Math.min(total, max);
  const on = Math.round((Math.max(0, Math.min(online, total)) / total) * n);
  return Array.from({ length: n }, (_, i) => (i < on ? 'on' : 'off'));
}

/** Store Ops › Infra health: NOC board of store cards (AI box, cameras, uptime, issues) plus open infra tickets. */
@Component({
  selector: 'ce-infra-health-page',
  imports: [RouterLink, MatIconModule, MatTooltipModule, ...DS, DateTimePipe, LocalTimesPipe, PctPipe, EntityDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-infra-health">
      <ce-page title="Infra health" description="AI boxes, cameras and uptime for every store — refreshed every minute" [lastRefreshed]="refreshedAt()">
        <ng-container pageActions>
          <button type="button" class="ce-btn ce-btn-secondary ce-icon-btn" (click)="reload()" matTooltip="Refresh now" aria-label="Refresh" data-testid="btn-refresh"><mat-icon>refresh</mat-icon></button>
          <button type="button" class="ce-btn ce-btn-primary" (click)="createTicket(null)" data-testid="btn-create-infra-ticket"><mat-icon>add</mat-icon> New infra ticket</button>
        </ng-container>

        @let t = data.data()?.totals;
        @let busy = !t && data.loading();
        <ce-stat-strip label="Infra summary">
          <ce-stat-tile variant="strip" id="infra-stores" label="Stores" [value]="t?.stores" [loading]="busy" />
          <ce-stat-tile variant="strip" id="infra-healthy" label="Healthy" [value]="t?.healthy" [loading]="busy" />
          <ce-stat-tile variant="strip" id="infra-degraded" label="Degraded" [value]="t?.degraded" [loading]="busy" />
          <ce-stat-tile variant="strip" id="infra-down" label="Down" [value]="t?.down" [loading]="busy" />
          <span class="ce-stat-strip-sep" aria-hidden="true"></span>
          <ce-stat-tile variant="strip" id="infra-cameras" label="Cameras online" [text]="t ? t.camerasOnline + ' / ' + t.camerasTotal : null" [loading]="busy" />
          <ce-stat-tile variant="strip" id="infra-open-tickets" label="Open infra tickets" [value]="t?.openInfraTickets" [loading]="busy" link="/tickets" />
        </ce-stat-strip>

        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        } @else {
          <div class="ops-row">
            <ce-segmented [options]="healthOptions()" [value]="healthFilter()" (valueChange)="healthFilter.set($any($event))" label="Health" data-testid="filter-health" />
            <span class="ops-spacer"></span>
            <label class="ce-search" style="max-width: 260px">
              <mat-icon aria-hidden="true">search</mat-icon>
              <input type="search" placeholder="Search stores" [value]="query()" (input)="query.set($any($event.target).value)" aria-label="Search stores" data-testid="input-search-infra" />
            </label>
          </div>

          <div class="ops-noc" data-testid="table-infra-health">
            @if (busy) {
              @for (i of [0, 1, 2, 3, 4, 5]; track i) {
                <ce-skeleton kind="chart" height="212px" />
              }
            }
            @for (r of rows(); track r.storeId) {
              <article class="ops-noc-card" [attr.data-testid]="'row-infra-' + r.storeId" [attr.data-health]="r.health" [attr.aria-label]="r.storeName + ': ' + healthLabel(r.health)">
                <div class="ops-noc-head">
                  <div class="ops-user-text" style="flex: 1">
                    <span class="ops-noc-name ops-ellipsis" [title]="r.storeName">{{ r.storeName }}</span>
                    <span class="ops-noc-sub">{{ storeCode(r.storeId) ?? 'Store #' + r.storeId }}{{ r.edgeVersion ? ' · AI box v' + r.edgeVersion : '' }}</span>
                  </div>
                  <ce-pill [value]="r.health" [label]="healthLabel(r.health)" data-testid="chip-health" />
                </div>
                <div class="ops-noc-metrics">
                  <div class="ops-noc-metric">
                    <span class="ops-noc-label">AI box</span>
                    <span class="ops-noc-value" style="font-size: 13px">
                      <ce-pill [value]="edgeValue(r)" [label]="edgeLabel(r)" size="sm" data-testid="chip-edge" />
                    </span>
                    @if (r.edgeLastSeenAt) {
                      <span class="caption" [title]="r.edgeLastSeenAt | dt">{{ r.edgeLastSeenAt | dt: 'relative' }}</span>
                    } @else {
                      <span class="caption">No heartbeat yet</span>
                    }
                  </div>
                  <div class="ops-noc-metric">
                    <span class="ops-noc-label">Cameras</span>
                    <span class="ops-noc-value" [class.bad]="r.camerasOnline < r.camerasTotal" data-testid="infra-cameras">{{ r.camerasOnline }} / {{ r.camerasTotal }}</span>
                    <span class="ops-cam-bar" [attr.aria-label]="r.camerasOnline + ' of ' + r.camerasTotal + ' cameras online'" role="img">
                      @for (s of segments(r); track $index) {
                        <span [class.off]="s === 'off'"></span>
                      } @empty {
                        <span class="na"></span>
                      }
                    </span>
                  </div>
                  <div class="ops-noc-metric">
                    <span class="ops-noc-label">Uptime 7 days</span>
                    @if (r.camerasTotal && r.uptimePct7d !== null) {
                      @let up = r.uptimePct7d;
                      <span class="ops-noc-value" [class.bad]="up < 95" [class.warn]="up >= 95 && up < 99">{{ up | pct }}</span>
                      <span class="ops-bar"><span class="ops-bar-track"><span class="ops-bar-fill" [class.bad]="up < 95" [class.warn]="up >= 95 && up < 99" [style.width.%]="up"></span></span></span>
                    } @else {
                      <!-- no cameras: there is no uptime to report (contract v4: null) -->
                      <span class="ops-noc-value" data-testid="uptime-none">--</span>
                      <span class="ops-bar"><span class="ops-bar-track"></span></span>
                    }
                  </div>
                  <div class="ops-noc-metric">
                    <span class="ops-noc-label">Counting accuracy</span>
                    @if (r.countAccuracyPct !== null && r.countAccuracyPct !== undefined) {
                      @let acc = r.countAccuracyPct;
                      <span class="ops-noc-value" data-testid="count-accuracy" [class.bad]="acc < 90" [class.warn]="acc >= 90 && acc < 95">{{ acc | pct }}</span>
                      <span class="ops-bar"><span class="ops-bar-track"><span class="ops-bar-fill" [class.bad]="acc < 90" [class.warn]="acc >= 90 && acc < 95" [style.width.%]="acc"></span></span></span>
                    } @else {
                      <span class="ops-noc-value" data-testid="count-accuracy-none">--</span>
                      <span class="ops-bar"><span class="ops-bar-track"></span></span>
                    }
                  </div>
                </div>
                <ul class="ops-noc-issues" data-testid="infra-issues" aria-label="Issues">
                  @for (i of r.issues; track i; let n = $index) {
                    <li [hidden]="n >= 4 && !expanded().has(r.storeId)"><span class="material-symbols-outlined" aria-hidden="true">{{ r.health === 'DOWN' ? 'error' : 'warning' }}</span><span>{{ i | localTimes }}</span></li>
                  } @empty {
                    <li class="none"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span><span>No issues</span></li>
                  }
                  @if (r.issues.length > 4 && !expanded().has(r.storeId)) {
                    <li><button type="button" class="ce-link-btn small" (click)="expand(r.storeId)">+{{ r.issues.length - 4 }} more</button></li>
                  }
                </ul>
                <div class="ops-noc-foot">
                  @if (r.openTickets) {
                    <a class="ce-num-link" routerLink="/tickets" [queryParams]="{ storeId: r.storeId }" data-testid="link-store-tickets">{{ r.openTickets }} open ticket{{ r.openTickets === 1 ? '' : 's' }}</a>
                  } @else {
                    <span class="caption">No open tickets</span>
                  }
                  <span class="ops-spacer"></span>
                  @if (isAdmin()) {
                    <a class="ce-icon-btn sm" [routerLink]="['/admin/stores', r.storeId, 'cameras']" matTooltip="Cameras" aria-label="Cameras" data-testid="link-cameras"><mat-icon>videocam</mat-icon></a>
                  }
                  <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="createTicket(r)" data-testid="btn-create-ticket"><mat-icon>add_card</mat-icon> Ticket</button>
                </div>
              </article>
            }
          </div>
          @if (data.loaded() && !rows().length && !busy) {
            <ce-card>
              @if ((data.data()?.stores ?? []).length) {
                <ce-empty-state kind="filtered" icon="monitor_heart" title="No stores match" message="No store has this health status or name.">
                  <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="healthFilter.set('ALL'); query.set('')">Show all stores</button>
                </ce-empty-state>
              } @else {
                <ce-empty-state icon="monitor_heart" title="No stores to monitor yet" message="Stores appear here once they have an AI box or cameras." />
              }
            </ce-card>
          }

          <ce-table
            [rows]="tickets()"
            [columns]="ticketCols"
            [loading]="ticketsData.loading() && !ticketsData.data()"
            title="Open infra tickets"
            subtitle="Camera, network and infrastructure tickets that are not resolved"
            testId="table-infra-tickets"
            [rowTestId]="ticketRowId"
            [pageSize]="50"
            [defaultSort]="{ key: 'createdAt', dir: 'desc' }"
            emptyIcon="task_alt"
            emptyTitle="No open infra tickets"
            emptyMessage="Raise one from a store card when a camera or the AI box needs attention."
          >
            <a tableActions class="ce-btn ce-btn-secondary" routerLink="/tickets" data-testid="link-all-tickets">All tickets</a>
            <ng-template ceCell="number" let-t><a class="ce-text-link ops-mono" [routerLink]="['/tickets', t.id]" data-testid="link-ticket">{{ t.number }}</a></ng-template>
            <ng-template ceCell="status" let-t>
              <span class="ops-row" style="flex-wrap: nowrap; gap: 4px">
                <ce-pill [value]="t.status" size="sm" />
                @if (t.isSlaBreached) {
                  <ce-pill tone="critical" label="SLA breached" size="sm" />
                }
              </span>
            </ng-template>
          </ce-table>
        }
      </ce-page>
      <ce-entity-drawer
        [(open)]="ticketOpen"
        entity="ticket"
        [title]="ticketTitle()"
        subtitle="Infra issues: camera, network or AI box"
        [fields]="ticketFormFields"
        [value]="ticketValue()"
        [submit]="submitTicket"
        submitLabel="Create ticket"
        (saved)="onTicketCreated($any($event))"
      />
    </section>
  `,
})
export class InfraHealthPage {
  protected readonly opsCss = useOpsStyles();
  private readonly v2 = inject(V2Api);
  private readonly api = inject(ApiService);
  private readonly lookup = inject(LookupService);
  private readonly ui = inject(UiService);
  private readonly auth = inject(AuthService);
  readonly healthFilter = signal<'ALL' | InfraHealthStatus>('ALL');
  readonly query = signal('');
  readonly expanded = signal<Set<number>>(new Set());
  private readonly tick = signal(0);
  readonly refreshedAt = signal(new Date());
  readonly isAdmin = computed(() => this.auth.can('adminMaster'));

  readonly data = loadOn(() => this.tick(), () => this.v2.infraHealth());
  readonly ticketsData = loadOn(
    () => this.tick(),
    () => this.api.get<Ticket[]>('/tickets', null, silent()).pipe(catchError(() => of([] as Ticket[]))),
  );
  readonly rows = computed(() => {
    const f = this.healthFilter();
    const q = this.query().trim().toLowerCase();
    return sortByHealth((this.data.data()?.stores ?? []).filter((s) => (f === 'ALL' || s.health === f) && (!q || s.storeName.toLowerCase().includes(q) || (this.storeCode(s.storeId) ?? '').toLowerCase().includes(q))));
  });
  readonly healthOptions = computed<TabItem[]>(() => {
    const t = this.data.data()?.totals;
    const c = (n: number | undefined) => (t ? ` ${n ?? 0}` : '');
    return [
      { value: 'ALL', label: 'All' + c(t?.stores) },
      { value: 'DOWN', label: 'Down' + c(t?.down) },
      { value: 'DEGRADED', label: 'Degraded' + c(t?.degraded) },
      { value: 'GOOD', label: 'Good' + c(t?.healthy) },
    ];
  });
  readonly tickets = computed(() =>
    (this.ticketsData.data() ?? []).filter((t) => INFRA_CATEGORIES.includes(t.category) && t.status !== 'RESOLVED' && t.status !== 'CLOSED'),
  );
  readonly ticketRowId = (t: Ticket) => `row-infra-ticket-${t.id}`;
  readonly ticketCols: CeColumn<Ticket>[] = [
    { key: 'number', header: 'Ticket', sortable: true, locked: true },
    { key: 'title', header: 'Title', sortable: true, secondary: (t) => humanize(t.category) },
    { key: 'storeName', header: 'Store', sortable: true },
    { key: 'priority', header: 'Priority', type: 'pill', sortable: true },
    { key: 'status', header: 'Status', sortable: true },
    { key: 'createdAt', header: 'Opened', type: 'datetime', sortable: true },
  ];

  constructor() {
    this.lookup.loadStores().subscribe();
    this.lookup.loadUsers();
    interval(60_000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.reload());
  }

  healthLabel(h: InfraHealthStatus): string {
    return healthChip(h).label;
  }
  edgeValue(r: StoreHealth): string {
    return r.edgeStatus === 'ONLINE' ? 'ONLINE' : r.edgeStatus === 'OFFLINE' ? 'OFFLINE' : 'UNKNOWN';
  }
  edgeLabel(r: StoreHealth): string {
    return r.edgeStatus === 'NEVER' ? 'Never seen' : humanize(r.edgeStatus);
  }
  segments(r: StoreHealth) {
    return cameraSegments(r.camerasOnline, r.camerasTotal);
  }
  storeCode(id: number): string | null {
    return this.lookup.stores().find((s) => s.id === id)?.code ?? null;
  }

  expand(id: number): void {
    this.expanded.update((s) => new Set([...s, id]));
  }

  reload(): void {
    this.tick.update((t) => t + 1);
    this.refreshedAt.set(new Date());
  }

  readonly ticketOpen = signal(false);
  readonly ticketTitle = signal('New infra ticket');
  readonly ticketValue = signal<Record<string, unknown> | null>(null);
  readonly ticketFormFields = ticketFields(this.lookup).map((f) =>
    f.key === 'category' ? { ...f, options: INFRA_CATEGORIES.map((c) => ({ value: c, label: c.charAt(0) + c.slice(1).toLowerCase() })), default: 'CAMERA' } : f,
  );
  readonly submitTicket = (v: Record<string, unknown>) => this.api.post<Ticket>('/tickets', v, null, silent());

  /** "New infra ticket" (empty) or "Ticket" on a store row (pre-filled from its health) — DS side panel. */
  createTicket(r: StoreHealth | null): void {
    const offline = r && r.camerasOnline < r.camerasTotal;
    this.ticketTitle.set(r ? `Infra ticket · ${r.storeName}` : 'New infra ticket');
    this.ticketValue.set(
      r
        ? {
            storeId: r.storeId,
            title: r.edgeStatus !== 'ONLINE' ? `Edge device ${r.edgeStatus.toLowerCase()}` : offline ? `${r.camerasTotal - r.camerasOnline} camera(s) offline` : 'Infra issue',
            description: r.issues.map((i) => localizeTimestamps(i)).join('\n'),
            category: r.edgeStatus !== 'ONLINE' ? 'NETWORK' : 'CAMERA',
            priority: r.health === 'DOWN' ? 'URGENT' : r.health === 'DEGRADED' ? 'HIGH' : 'MEDIUM',
          }
        : { category: 'CAMERA', storeId: this.lookup.scopedStores()[0]?.id ?? null },
    );
    this.ticketOpen.set(true);
  }

  onTicketCreated(t: Ticket | null): void {
    this.ui.toast(`Ticket ${t?.number ?? ''} created`);
    this.reload();
  }
}
