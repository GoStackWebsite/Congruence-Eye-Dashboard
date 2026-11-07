import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ComplianceRow } from '../../core/models/api.models';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { shortDate } from '../../core/utils/dates';
import { humanize } from '../../core/utils/format';
import { cartesian } from '../../shared/charts/chart-builders';
import { SEQUENTIAL_BLUE } from '../../shared/charts/chart-theme';
import { CeColumn, DS } from '../../shared/ds';
import { PctPipe } from '../../shared/pipes';
import { withMobileLabels } from './_ui/ops';
import { LIST_STYLES } from './_ui/styles';

/** Sequential cell colour for a 0..100 score (one hue, light → dark). */
export function scoreCellColor(pct: number | null | undefined): { bg: string; fg: string } | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  const idx = Math.min(SEQUENTIAL_BLUE.length - 1, Math.max(0, Math.floor((pct / 100) * SEQUENTIAL_BLUE.length)));
  // white text only where it reaches 4.5:1 (#1570EF and darker)
  return { bg: SEQUENTIAL_BLUE[idx], fg: idx >= 6 ? '#ffffff' : '#0b0b0b' };
}

/** Submission-weighted average score; null when there are no submissions (never NaN). */
export function weightedAvg(rows: Pick<ComplianceRow, 'avgScorePct' | 'submissions'>[]): number | null {
  const subs = rows.reduce((s, x) => s + x.submissions, 0);
  return subs ? rows.reduce((s, x) => s + x.avgScorePct * x.submissions, 0) / subs : null;
}

/** Trax › Overview › Compliance: average checklist score per store and per category (store × category heat table). */
@Component({
  selector: 'ce-compliance-page',
  imports: [...DS, ...LIST_STYLES, PctPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles />
    <section class="ops-page" data-testid="page-compliance">
      <ce-page title="Compliance" description="Average checklist score per store and category for the selected dates and stores" [lastRefreshed]="true">
        <div class="stat-grid stat-grid-4" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px">
          <ce-stat-tile variant="compact" id="compliance-avg" icon="verified" label="Average score" format="pct" [value]="avg()" [loading]="busy()" hint="Submission-weighted average of checklist scores" />
          <ce-stat-tile variant="compact" id="compliance-submissions" icon="inventory" label="Submissions" [value]="totalSubs()" [loading]="busy()" />
          <ce-stat-tile variant="compact" id="compliance-overdue" icon="schedule" label="Overdue" [value]="totalOverdue()" [loading]="busy()" hint="Assignments past their due time without a submission" />
          <ce-stat-tile variant="compact" id="compliance-below" icon="trending_down" label="Stores below 80%" [value]="below()" [loading]="busy()" />
        </div>

        @if (data.error() && !data.data()) {
          <div class="ops-card">
            <ce-empty-state kind="error" [message]="data.error()"><button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button></ce-empty-state>
          </div>
        } @else {
          <ce-chart-card
            title="Score by store"
            [subtitle]="rangeLabel()"
            info="Average score of the checklists submitted at each store (0–100%)."
            [options]="chart()"
            [hasData]="scored().length > 0"
            [loading]="busy()"
            [error]="data.error()"
            (retry)="data.reload()"
            chartTestId="chart-compliance"
            [height]="chartHeight()"
            emptyKind="no-data"
            emptyTitle="No checklist submissions in this period"
            emptyMessage="Widen the date range or pick other stores in the top bar."
          />
          <div class="ops-card">
            <ce-table
              [rows]="rows()"
              [columns]="cols()"
              [loading]="busy()"
              title="Store × category"
              subtitle="Cells are shaded by score — darker is better"
              [searchable]="true"
              searchPlaceholder="Search store"
              searchTestId="input-search-compliance"
              testId="table-compliance"
              [rowTestId]="rowId"
              [bare]="true"
              [defaultSort]="{ key: 'avgScorePct', dir: 'desc' }"
              emptyIcon="verified"
              emptyTitle="No checklist submissions in this period"
              emptyMessage="Widen the date range or pick other stores in the top bar."
            >
              <ng-template ceCell="avgScorePct" let-r>
                @if (!r.submissions) {
                  <span class="dash" data-testid="score-none">--</span>
                } @else {
                <span class="ops-score" [class]="'ops-score ' + (r.avgScorePct < 60 ? 'low' : r.avgScorePct < 85 ? 'mid' : 'good')"><span class="bar"><span [style.width.%]="r.avgScorePct"></span></span><span class="v strong">{{ r.avgScorePct | pct }}</span></span>
                }
              </ng-template>
              @for (c of categories(); track c) {
                <ng-template [ceCell]="'cat_' + c" let-r>
                  @let v = catScore(r, c);
                  @let col = color(v);
                  @if (col) {
                    <span class="ce-chip" [style.background]="col.bg" [style.color]="col.fg">{{ v | pct: 0 }}</span>
                  } @else {
                    <span class="dash">--</span>
                  }
                </ng-template>
              }
            </ce-table>
          </div>
        }
      </ce-page>
    </section>
  `,
})
export class CompliancePage {
  private readonly api = inject(AnalyticsApi);
  private readonly filter = inject(FilterService);
  readonly data = loadOn(() => this.filter.params(), (p) => this.api.compliance(p));
  readonly busy = computed(() => this.data.loading() && !this.data.data());
  readonly rows = computed(() => [...(this.data.data() ?? [])].sort((a, b) => b.avgScorePct - a.avgScorePct));
  readonly categories = computed(() => [...new Set(this.rows().flatMap((r) => r.byCategory.map((c) => String(c.category))))].sort());
  readonly totalSubs = computed(() => (this.data.data() ? this.rows().reduce((s, r) => s + r.submissions, 0) : undefined));
  readonly totalOverdue = computed(() => (this.data.data() ? this.rows().reduce((s, r) => s + r.overdue, 0) : undefined));
  readonly below = computed(() => (this.data.data() ? this.rows().filter((r) => r.submissions > 0 && r.avgScorePct < 80).length : undefined));
  // no submissions → no score ("--"), never 0 %
  readonly avg = computed(() => (this.data.data() ? weightedAvg(this.rows()) : undefined));
  readonly scored = computed(() => this.rows().filter((r) => r.submissions > 0));
  readonly rangeLabel = computed(() => {
    const r = this.filter.range();
    return r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} – ${shortDate(r.to)}`;
  });
  readonly chartHeight = computed(() => `${Math.max(220, this.scored().length * 34 + 40)}px`);
  readonly chart = computed(() =>
    cartesian(
      this.scored().map((r) => r.storeName),
      [{ name: 'Avg score %', type: 'bar', data: this.scored().map((r) => Math.round(r.avgScorePct * 10) / 10) }],
      'pct',
      { horizontal: true },
    ),
  );
  readonly rowId = (r: ComplianceRow) => `row-compliance-${r.storeId}`;
  readonly cols = computed<CeColumn<ComplianceRow>[]>(() =>
    withMobileLabels<ComplianceRow>([
      { key: 'storeName', header: 'Store', sortable: true, locked: true },
      { key: 'submissions', header: 'Submissions', type: 'number', sortable: true },
      { key: 'overdue', header: 'Overdue', type: 'number', sortable: true, cellClass: (r) => (r.overdue > 0 ? 'bad-text' : null) },
      { key: 'avgScorePct', header: 'Avg score', type: 'custom', sortable: true },
      ...this.categories().map((c) => ({ key: 'cat_' + c, header: humanize(c), type: 'custom' as const, align: 'center' as const, sortable: true, value: (r: ComplianceRow) => this.catScore(r, c) })),
    ]),
  );

  catScore(r: { byCategory: { category: string; avgScorePct: number }[] }, c: string): number | null {
    return r.byCategory.find((x) => x.category === c)?.avgScorePct ?? null;
  }
  color(v: number | null) {
    return scoreCellColor(v);
  }
}
