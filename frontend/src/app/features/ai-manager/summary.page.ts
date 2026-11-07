import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AiManagerSummary } from '../../core/models/api.models';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { shortDate } from '../../core/utils/dates';
import { AI_TYPE_INFO } from '../../core/utils/v2-helpers';
import { cartesian } from '../../shared/charts/chart-builders';
import { markPartialDay, storeToday } from '../analytics/analytics-helpers';
import { CeColumn, DS } from '../../shared/ds';
import { NumPipe, PctPipe } from '../../shared/pipes';
import { useOpsStyles } from '../../shared/ds/ops.styles';

type StoreRow = AiManagerSummary['byStore'][number];

/** Bar tone for a compliance %: ≥ 90 good, ≥ 75 warning, else bad. */
export function complianceTone(pct: number | null | undefined): 'good' | 'warn' | 'bad' {
  const v = Number(pct);
  return !Number.isFinite(v) ? 'bad' : v >= 90 ? 'good' : v >= 75 ? 'warn' : 'bad';
}

/** AI Manager › Summary: KPIs, a tile per detection type, daily trend and compliance by store. */
@Component({
  selector: 'ce-ai-summary-page',
  imports: [RouterLink, ...DS, NumPipe, PctPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-ai-summary">
      <ce-page title="AI Manager summary" description="Breached vs complied checks by detection type, day and store" [lastRefreshed]="true">
        <ng-container pageActions>
          <a class="ce-btn ce-btn-secondary" routerLink="/ai-manager/detections" data-testid="link-detections">View all detections</a>
        </ng-container>
        @let busy = data.loading() && !data.data();
        <ce-stat-strip label="AI Manager totals">
          <ce-stat-tile variant="strip" id="ai-total" label="Checks" [value]="totals()?.total" [loading]="busy" hint="Breached + complied; false positives are excluded" />
          <ce-stat-tile variant="strip" id="ai-breached" label="Breached" [value]="totals()?.breached" [loading]="busy" link="/ai-manager/detections" />
          <ce-stat-tile variant="strip" id="ai-complied" label="Complied" [value]="totals()?.complied" [loading]="busy" />
          <ce-stat-tile variant="strip" id="ai-compliance" label="Compliance" format="pct" [value]="totals()?.pct" [loading]="busy" hint="Complied ÷ checks" />
        </ce-stat-strip>

        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        } @else {
          <ce-card title="By detection type" subtitle="Breaches in the selected period; open a tile for its evidence" icon="smart_toy">
            @if (busy) {
              <ce-skeleton kind="tiles" [count]="4" />
            } @else if (byType().length) {
              <div class="ops-type-tiles" data-testid="table-ai-by-type">
                @for (t of byType(); track t.type) {
                  <a class="ops-type-tile" [routerLink]="['/ai-manager/detections']" [queryParams]="{ type: t.type, status: 'BREACHED' }" [attr.data-testid]="'row-ai-type-' + t.type">
                    <span class="ops-type-head">
                      <span class="ops-type-icon" aria-hidden="true"><span class="material-symbols-outlined">{{ info[t.type]?.icon ?? 'smart_toy' }}</span></span>
                      <span class="ops-type-name ops-ellipsis" [title]="info[t.type]?.label ?? t.type">{{ info[t.type]?.label ?? t.type }}</span>
                    </span>
                    <span class="ops-type-nums">
                      <span><span class="ops-type-big" [class.bad]="t.breached > 0">{{ t.breached | num }}</span><br /><span class="ops-type-lbl">Breached</span></span>
                      <span><span class="ops-type-big">{{ t.complied | num }}</span><br /><span class="ops-type-lbl">Complied</span></span>
                    </span>
                    <span class="ops-bar">
                      <span class="ops-bar-track"><span class="ops-bar-fill" [class.warn]="tone(t.compliancePct) === 'warn'" [class.bad]="tone(t.compliancePct) === 'bad'" [style.width.%]="t.compliancePct"></span></span>
                      <span>{{ t.compliancePct | pct }}</span>
                    </span>
                  </a>
                }
              </div>
            } @else {
              <ce-empty-state kind="filtered" icon="smart_toy" title="No AI checks in this period" message="Active AI checklists report here once the store cameras run them." [compact]="true" />
            }
          </ce-card>

          <div class="ops-grid-2-1">
            <ce-chart-card
              title="Daily trend"
              [subtitle]="rangeLabel()"
              info="Checks per day split into complied and breached. False positives are excluded."
              icon="bar_chart"
              [options]="dailyChart()"
              [hasData]="(data.data()?.daily ?? []).length > 0"
              [loading]="busy"
              chartTestId="chart-ai-daily"
              height="300px"
            />
            <ce-card title="Compliance at a glance" icon="verified" [subtitle]="worst() ? 'Lowest: ' + worst()!.storeName : null">
              @if (busy) {
                <ce-skeleton kind="text" [count]="5" />
              } @else {
                <div class="ops-stack" style="gap: 12px">
                  @for (s of topStores(); track s.storeId) {
                    <div>
                      <div class="ops-row" style="justify-content: space-between; font-size: 12px; margin-bottom: 4px">
                        <span class="ops-ellipsis" [title]="s.storeName">{{ s.storeName }}</span><span class="caption">{{ s.breached | num }} breached</span>
                      </div>
                      <span class="ops-bar">
                        <span class="ops-bar-track"><span class="ops-bar-fill" [class.warn]="tone(s.compliancePct) === 'warn'" [class.bad]="tone(s.compliancePct) === 'bad'" [style.width.%]="s.compliancePct"></span></span>
                        <span>{{ s.compliancePct | pct }}</span>
                      </span>
                    </div>
                  } @empty {
                    <span class="caption">No store data yet</span>
                  }
                </div>
              }
            </ce-card>
          </div>

          <ce-table
            [rows]="data.data()?.byStore ?? []"
            [columns]="storeCols"
            [loading]="busy"
            title="Compliance by store"
            subtitle="Sorted by compliance, lowest first"
            [searchable]="true"
            searchPlaceholder="Search stores"
            searchTestId="input-search-ai-stores"
            testId="table-ai-by-store"
            [rowTestId]="storeRowId"
            [defaultSort]="{ key: 'compliancePct', dir: 'asc' }"
            emptyIcon="storefront"
            emptyTitle="No store data in this period"
          >
            <ng-template ceCell="compliancePct" let-r>
              <span class="ops-bar" style="min-width: 160px">
                <span class="ops-bar-track"><span class="ops-bar-fill" [class.warn]="tone(r.compliancePct) === 'warn'" [class.bad]="tone(r.compliancePct) === 'bad'" [style.width.%]="r.compliancePct"></span></span>
                <span>{{ r.compliancePct | pct }}</span>
              </span>
            </ng-template>
          </ce-table>
        }
      </ce-page>
    </section>
  `,
})
export class AiSummaryPage {
  protected readonly opsCss = useOpsStyles();
  private readonly v2 = inject(V2Api);
  private readonly filter = inject(FilterService);
  readonly info: Record<string, { label: string; icon: string; desc: string }> = AI_TYPE_INFO;
  readonly data = loadOn(() => this.filter.params(), (p) => this.v2.aiSummary(p));
  readonly tone = complianceTone;
  readonly totals = computed(() => {
    const d = this.data.data();
    if (!d) return null;
    // Contract v4: the server's totals are authoritative; the byType sum is the fallback for older backends.
    const t = d.totals;
    const breached = t?.breached ?? d.byType.reduce((s, x) => s + x.breached, 0);
    const complied = t?.complied ?? d.byType.reduce((s, x) => s + x.complied, 0);
    const total = breached + complied;
    return { breached, complied, total, pct: t ? t.compliancePct : total ? (complied / total) * 100 : null };
  });
  readonly byType = computed(() => [...(this.data.data()?.byType ?? [])].sort((a, b) => b.breached - a.breached || a.type.localeCompare(b.type)));
  readonly topStores = computed(() => [...(this.data.data()?.byStore ?? [])].sort((a, b) => a.compliancePct - b.compliancePct).slice(0, 6));
  readonly worst = computed(() => this.topStores()[0] ?? null);
  readonly rangeLabel = computed(() => {
    const r = this.filter.range();
    return r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} – ${shortDate(r.to)}`;
  });
  readonly storeRowId = (r: StoreRow) => `row-ai-store-${r.storeId}`;
  readonly storeCols: CeColumn<StoreRow>[] = [
    { key: 'storeName', header: 'Store', sortable: true, locked: true },
    { key: 'breached', header: 'Breached', type: 'link-number', sortable: true, link: () => ['/ai-manager/detections'], align: 'right' },
    { key: 'complied', header: 'Complied', type: 'number', sortable: true },
    { key: 'checks', header: 'Checks', type: 'number', value: (r) => r.breached + r.complied, sortable: true },
    { key: 'compliancePct', header: 'Compliance', type: 'percent', sortable: true, align: 'left' },
  ];
  readonly dailyChart = computed(() => {
    const d = [...(this.data.data()?.daily ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const chart = cartesian(
      d.map((x) => shortDate(x.date)),
      [
        { name: 'Complied', type: 'bar', stack: 'checks', data: d.map((x) => x.complied) },
        { name: 'Breached', type: 'bar', stack: 'checks', data: d.map((x) => x.breached) },
      ],
    );
    // today is still running: drawn as a partial "so far" day (a low bar is not a drop)
    const i = d.findIndex((x) => x.date === storeToday());
    return i >= 0 && d.length > 1 ? markPartialDay(chart as Record<string, unknown>, i, d[i].complied + d[i].breached) : chart;
  });
}
