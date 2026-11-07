import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Alert, Assignment, BenchmarkRow, OpenCloseRow, OverviewKpiKey, Paged } from '../../core/models/api.models';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { ApiService, silent } from '../../core/services/api.service';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { shortDate, toIsoDate } from '../../core/utils/dates';
import { stackedGrids } from '../../shared/charts/chart-builders';
import { DS, TabItem } from '../../shared/ds';
import { guardOverviewKpis, markPartialDay, storeToday, toWeekly } from '../analytics/analytics-helpers';
import { DateTimePipe, InrPipe, PctPipe } from '../../shared/pipes';
import { KpiFormat } from '../../shared/ui/kpi-card.component';
import { LoadStateComponent } from '../../shared/ui/ui.components';

interface KpiDef {
  key: OverviewKpiKey;
  id: string;
  label: string;
  icon: string;
  format: KpiFormat;
  lowerIsBetter?: boolean;
  hint?: string;
  /** shown as a hero band tile (else in the secondary stat strip) */
  hero?: boolean;
  link?: string;
}

export const DASHBOARD_KPIS: KpiDef[] = [
  { key: 'footfall', id: 'footfall', label: 'Footfall', icon: 'directions_walk', format: 'number', hint: 'Customer entries, staff excluded', hero: true, link: '/analytics/traffic' },
  { key: 'uniqueVisitors', id: 'unique-visitors', label: 'Unique visitors', icon: 'person', format: 'number' },
  { key: 'billableEntities', id: 'billable-entities', label: 'Billable entities', icon: 'groups', format: 'number', hint: 'Individuals + groups (a group counts once)' },
  { key: 'transactions', id: 'transactions', label: 'Transactions', icon: 'receipt_long', format: 'number', hero: true },
  { key: 'conversionPct', id: 'conversion', label: 'Conversion', icon: 'percent', format: 'pct', hint: 'Transactions ÷ billable entities', hero: true, link: '/analytics/conversion' },
  { key: 'revenue', id: 'revenue', label: 'Revenue', icon: 'currency_rupee', format: 'inrCompact', hero: true },
  { key: 'atv', id: 'atv', label: 'Avg. transaction value', icon: 'payments', format: 'inr', hero: true },
  { key: 'avgDwellSec', id: 'avg-dwell', label: 'Avg. dwell', icon: 'timer', format: 'duration' },
  { key: 'engagedPct', id: 'engaged', label: 'Engaged', icon: 'touch_app', format: 'pct' },
  { key: 'captureRatePct', id: 'capture-rate', label: 'Capture rate', icon: 'storefront', format: 'pct', hint: 'Walk-ins ÷ passers-by (needs a Pass-by line on a street-facing camera)', link: '/analytics/traffic' },
  { key: 'bounceRatePct', id: 'bounce-rate', label: 'Bounce rate', icon: 'logout', format: 'pct', lowerIsBetter: true },
  { key: 'missedOpportunities', id: 'missed-opportunities', label: 'Missed opportunities', icon: 'trending_down', format: 'number', lowerIsBetter: true },
  { key: 'avgQueueWaitSec', id: 'queue-wait', label: 'Avg. queue wait', icon: 'hourglass_top', format: 'duration', lowerIsBetter: true },
  { key: 'complianceScore', id: 'compliance', label: 'Compliance score', icon: 'verified', format: 'pct' },
  { key: 'openAlerts', id: 'open-alerts', label: 'Open alerts', icon: 'notifications_active', format: 'number', lowerIsBetter: true, link: '/alerts', hero: true },
];


type OcTone = 'ON_TIME' | 'LATE' | 'EARLY' | 'MISSING' | 'PENDING';

/** HQ "morning view": KPI band, footfall & conversion trend, open alerts, today's operations and the store league. */
@Component({
  selector: 'ce-dashboard-page',
  imports: [RouterLink, MatIconModule, MatTooltipModule, ...DS, LoadStateComponent, InrPipe, PctPipe, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-dashboard">
      <ce-page [title]="greeting()" [description]="'Overview · ' + rangeLabel() + ' · ' + storeScope()" [lastRefreshed]="true">
        <ng-container pageActions>
          <a class="ce-btn ce-btn-secondary" routerLink="/reports" data-testid="link-reports"><mat-icon>summarize</mat-icon> Reports</a>
          <a class="ce-btn ce-btn-primary" routerLink="/analytics/benchmark" data-testid="link-benchmark"><mat-icon>leaderboard</mat-icon> Store benchmark</a>
        </ng-container>

        <ce-load-state [loading]="overview.loading()" [error]="overview.error()" [hasData]="true" [rows]="0" />

        <div class="dash-kpis" data-testid="kpi-grid">
          <div class="dash-hero">
            @for (k of heroKpis; track k.key) {
              <ce-stat-tile
                variant="band"
                [id]="k.id"
                [label]="k.label"
                [format]="k.format"
                [hint]="k.hint ?? null"
                [kpi]="kpiValues()?.[k.key]"
                [lowerIsBetter]="!!k.lowerIsBetter"
                [compare]="filter.compare()"
                [loading]="overview.loading() && !overview.data()"
                [link]="k.link ?? null"
                [sub]="heroSub(k.id)"
              />
            }
          </div>
          <ce-stat-strip class="dash-strip" label="More KPIs">
            @for (k of stripKpis; track k.key) {
              <ce-stat-tile
                variant="strip"
                [id]="k.id"
                [label]="k.label"
                [format]="k.format"
                [hint]="k.hint ?? null"
                [kpi]="kpiValues()?.[k.key]"
                [lowerIsBetter]="!!k.lowerIsBetter"
                [compare]="filter.compare()"
                [loading]="overview.loading() && !overview.data()"
                [link]="k.link ?? null"
              />
            }
          </ce-stat-strip>
        </div>

        <div class="dash-grid-2-1">
          <ce-chart-card
            title="Footfall & conversion"
            icon="monitoring"
            [subtitle]="rangeLabel()"
            info="Daily customer footfall and billed transactions (top) with conversion % (bottom). Two panels instead of a dual axis. Weekly view: sums per week; conversion is the footfall-weighted average of the days."
            [options]="dailyChart()"
            [hasData]="!!overview.data()?.daily?.length"
            [loading]="overview.loading()"
            [error]="overview.error()"
            (retry)="overview.reload()"
            [granularities]="granularities"
            [(granularity)]="granularity"
            emptyTitle="No traffic for this period"
            chartTestId="chart-daily"
            height="340px"
            ariaLabel="Daily footfall and transactions with conversion rate"
          />
          <ce-card title="Open alerts" icon="notifications_active" subtitle="Newest first" data-testid="dashboard-open-alerts">
            <ng-container cardBadge>
              @if (alerts.data()?.total) {
                <span class="ce-count-badge">{{ alerts.data()?.total }}</span>
              }
            </ng-container>
            <a cardActions class="ce-link-btn small" routerLink="/alerts" data-testid="link-all-alerts">View all</a>
            <ul class="dash-alerts">
              @for (a of alerts.data()?.items ?? []; track a.id) {
                <li [attr.data-testid]="'dashboard-alert-' + a.id">
                  <span class="sev-bar" [class]="'sev-bar sev-' + a.severity" aria-hidden="true"></span>
                  <div class="da-main">
                    <div class="da-title ellipsis" [title]="a.ruleName">{{ a.ruleName }}</div>
                    <div class="da-meta ellipsis">{{ a.storeName }} · {{ a.createdAt | dt: 'relative' }}</div>
                  </div>
                  <ce-pill [value]="a.severity" size="sm" />
                </li>
              } @empty {
                @if (alerts.loading()) {
                  <ce-skeleton kind="text" [count]="5" />
                } @else {
                  <ce-empty-state icon="notifications_off" title="No open alerts" message="All stores are within their alert thresholds." [compact]="true" />
                }
              }
            </ul>
          </ce-card>
        </div>

        <div class="dash-grid-3">
          <ce-card title="Today's operations" icon="storefront" [subtitle]="todayLabel" data-testid="dashboard-today-ops">
            <a cardActions class="ce-link-btn small" routerLink="/ai-manager/open-close">Open / close</a>
            <div class="ops-checklists" data-testid="dashboard-checklists-due">
              <div class="ops-head">
                <span class="ops-title">Checklists due today</span>
                <a class="ce-link-btn small" routerLink="/checklists/assignments">Trax</a>
              </div>
              <div class="ops-stats">
                <div><b>{{ due().total }}</b><span>Due</span></div>
                <div><b class="good-text">{{ due().done }}</b><span>Submitted</span></div>
                <div><b [class.bad-text]="due().overdue > 0">{{ due().overdue }}</b><span>Overdue</span></div>
              </div>
              <ce-progress [value]="due().pct" [valueText]="due().total ? (due().pct | pct: 0) : '--'" label="Completion" />
            </div>
            <div class="ops-head" style="margin-top: 14px"><span class="ops-title">Store open / close</span></div>
            <ul class="ops-stores" data-testid="dashboard-open-close">
              @for (r of todayOc(); track r.storeId) {
                <li [attr.data-testid]="'dashboard-oc-' + r.storeId">
                  <span class="ellipsis ops-store" [title]="r.storeName">{{ r.storeName }}</span>
                  <span class="ops-time">{{ r.actualOpen ?? '--' }}<small> / {{ r.scheduledOpen }}</small></span>
                  <ce-pill [value]="r.openStatus" size="sm" />
                </li>
              } @empty {
                @if (oc.loading()) {
                  <ce-skeleton kind="text" [count]="4" />
                } @else {
                  <li class="caption">No open/close data for today yet.</li>
                }
              }
            </ul>
          </ce-card>
          <ce-card title="Top stores" icon="trending_up" subtitle="By revenue in the period" data-testid="dashboard-top-stores">
            <ul class="league">
              @for (s of topStores(); track s.storeId) {
                <li>
                  <span class="rank-badge top">{{ s.rank }}</span>
                  <div class="lg-main">
                    <div class="lg-name ellipsis" [title]="s.storeName">{{ s.storeName }}</div>
                    <div class="lg-bar"><span [style.width.%]="revPct(s)"></span></div>
                  </div>
                  <div class="lg-val">
                    <b>{{ s.revenue | inr: 'compact' }}</b>
                    <span>{{ s.footfall ? (s.conversionPct | pct) : '--' }} conv.</span>
                  </div>
                </li>
              } @empty {
                <ce-empty-state icon="leaderboard" title="No store data" [compact]="true" />
              }
            </ul>
          </ce-card>
          <ce-card title="Needs attention" icon="trending_down" subtitle="Lowest revenue in the period" data-testid="dashboard-bottom-stores">
            <ul class="league">
              @for (s of bottomStores(); track s.storeId) {
                <li>
                  <span class="rank-badge">{{ s.rank }}</span>
                  <div class="lg-main">
                    <div class="lg-name ellipsis" [title]="s.storeName">{{ s.storeName }}</div>
                    <div class="lg-bar low"><span [style.width.%]="revPct(s)"></span></div>
                  </div>
                  <div class="lg-val">
                    <b>{{ s.revenue | inr: 'compact' }}</b>
                    <span [class.bad-text]="s.footfallChangePct < 0">{{ s.footfall ? (s.conversionPct | pct) : '--' }} conv.</span>
                  </div>
                </li>
              } @empty {
                <ce-empty-state icon="leaderboard" title="Not enough stores to rank" message="The bottom of the league shows when more than five stores are selected." [compact]="true" />
              }
            </ul>
          </ce-card>
        </div>
      </ce-page>
    </section>
  `,
})
export class DashboardPage {
  protected readonly auth = inject(AuthService);
  protected readonly filter = inject(FilterService);
  private readonly analytics = inject(AnalyticsApi);
  private readonly api = inject(ApiService);
  private readonly v2 = inject(V2Api);
  protected readonly kpis = DASHBOARD_KPIS;
  protected readonly heroKpis = DASHBOARD_KPIS.filter((k) => k.hero);
  protected readonly stripKpis = DASHBOARD_KPIS.filter((k) => !k.hero);
  private readonly today = toIsoDate(new Date());
  protected readonly todayLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date());

  readonly overview = loadOn(() => this.filter.params(), (p) => this.analytics.overview(p));
  /** Ratios with an empty base (no footfall / no bills) show "--". */
  readonly kpiValues = computed(() => guardOverviewKpis(this.overview.data()?.kpis));
  readonly alerts = loadOn(
    () => this.filter.params(),
    (p) =>
      this.api
        .get<Paged<Alert>>('/alerts', { status: 'OPEN', storeIds: p.storeIds, page: 1, pageSize: 6 }, silent())
        .pipe(catchError(() => of({ items: [], total: 0, page: 1, pageSize: 6 } as Paged<Alert>))),
  );
  readonly bench = loadOn(
    () => this.filter.params(),
    (p) => this.analytics.benchmark(p).pipe(catchError(() => of([] as BenchmarkRow[]))),
  );
  readonly oc = loadOn(
    () => ({ storeIds: this.filter.params().storeIds, from: this.today, to: this.today }),
    (p) => this.v2.openClose(p).pipe(catchError(() => of([] as OpenCloseRow[]))),
  );
  readonly assignments = loadOn(
    () => this.filter.params(),
    () => this.api.get<Assignment[]>('/checklists/assignments', {}, silent()).pipe(catchError(() => of([] as Assignment[]))),
  );

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    const first = (this.auth.user()?.name ?? '').split(/\s+/)[0];
    const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    return first ? `${part}, ${first}` : part;
  });
  protected readonly storeScope = computed(() => {
    const n = this.filter.selectedStoreIds().length;
    return n ? `${n} store${n === 1 ? '' : 's'} selected` : 'all stores';
  });
  protected readonly rangeLabel = computed(() => {
    const r = this.filter.range();
    return r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} – ${shortDate(r.to)}`;
  });
  protected readonly sortedBench = computed(() => [...(this.bench.data() ?? [])].sort((a, b) => a.rank - b.rank));
  protected readonly topStores = computed(() => this.sortedBench().slice(0, 5));
  protected readonly bottomStores = computed(() => {
    const s = this.sortedBench();
    return s.length > 5 ? s.slice(-5).reverse() : [];
  });
  private readonly maxRevenue = computed(() => Math.max(1, ...this.sortedBench().map((s) => s.revenue ?? 0)));
  revPct(s: BenchmarkRow): number {
    return ((s.revenue ?? 0) / this.maxRevenue()) * 100;
  }

  protected readonly todayOc = computed(() =>
    (this.oc.data() ?? [])
      .filter((r) => r.date === this.today)
      .sort((a, b) => this.ocRank(a.openStatus) - this.ocRank(b.openStatus) || a.storeName.localeCompare(b.storeName))
      .slice(0, 6),
  );
  private ocRank(s: OcTone): number {
    return { LATE: 0, MISSING: 1, EARLY: 2, PENDING: 3, ON_TIME: 4 }[s] ?? 5;
  }
  protected readonly due = computed(() => {
    const ids = this.filter.selectedStoreIds();
    const list = (this.assignments.data() ?? []).filter((a) => a.dueDate === this.today && (!ids.length || ids.includes(a.storeId)));
    const done = list.filter((a) => a.status === 'SUBMITTED' || a.status === 'APPROVED').length;
    const overdue = list.filter((a) => a.status === 'OVERDUE').length;
    return { total: list.length, done, overdue, pct: list.length ? (done / list.length) * 100 : 0 };
  });

  heroSub(id: string): string | null {
    const k = this.overview.data()?.kpis;
    if (!k) return null;
    switch (id) {
      case 'footfall':
        return 'Customer entries';
      case 'conversion':
        return 'Transactions ÷ billable entities';
      case 'revenue':
        return 'Billed sales from POS';
      case 'transactions':
        return 'Bills in the period';
      case 'atv':
        return 'Revenue ÷ transactions';
      case 'open-alerts':
        return 'Across selected stores';
      default:
        return null;
    }
  }

  readonly granularities: TabItem[] = [
    { value: 'daily', label: 'Daily', testId: 'gran-daily' },
    { value: 'weekly', label: 'Weekly', testId: 'gran-weekly' },
  ];
  readonly granularity = signal<'daily' | 'weekly'>('daily');

  protected readonly dailyChart = computed(() => {
    const raw = this.overview.data()?.daily ?? [];
    const weekly = this.granularity() === 'weekly';
    // weekly: sum footfall / transactions, conversion recomputed as a footfall-weighted average
    const d = weekly
      ? toWeekly(
          raw.map((x) => ({ ...x, convW: (x.conversionPct ?? 0) * x.footfall })),
          ['footfall', 'transactions', 'revenue', 'convW'],
        ).map((w) => ({ ...w, conversionPct: w.footfall ? w.convW / w.footfall : null }))
      : raw.map((x) => ({ ...x, label: shortDate(x.date) }));
    const cats = d.map((x) => x.label);
    const chart = stackedGrids(
      cats,
      {
        title: 'Footfall & transactions',
        fmt: 'number',
        series: [
          // hasData: false (contract v4) = no edge data that day → gap, not 0
          { name: 'Footfall', type: 'bar', data: d.map((x) => ('hasData' in x && x.hasData === false ? null : x.footfall)) },
          { name: 'Transactions', type: 'bar', data: d.map((x) => ('hasData' in x && x.hasData === false ? null : x.transactions)) },
        ],
      },
      { title: 'Conversion %', fmt: 'pct', series: [{ name: 'Conversion %', type: 'line', data: d.map((x) => (x.footfall && ('hasData' in x ? x.hasData !== false : true) ? x.conversionPct : null)) }] },
    );
    // today is still running: a partial "so far" day, never a drop to 0
    const i = weekly ? -1 : d.findIndex((x) => ('isPartial' in x && x.isPartial !== undefined ? x.isPartial : x.date === storeToday()));
    return i >= 0 && d.length > 1 ? markPartialDay(chart as Record<string, unknown>, i, d[i].footfall) : chart;
  });
}
