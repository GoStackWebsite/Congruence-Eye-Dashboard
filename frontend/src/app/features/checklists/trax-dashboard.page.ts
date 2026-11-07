import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { TraxDashboard } from '../../core/models/api.models';
import { ApiService, saveBlob } from '../../core/services/api.service';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { toCsv } from '../../core/utils/csv';
import { humanize } from '../../core/utils/format';
import { shortDate } from '../../core/utils/dates';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { PctPipe } from '../../shared/pipes';
import { LoadStateComponent } from '../../shared/ui/ui.components';

export type Perf = { name: string; assigned: number; submitted: number; flags: number; completionPct: number; compliancePct: number; id: number; extra?: string; frequency?: string; stores?: number };
export type PerfTab = 'checklist' | 'store' | 'user';

/** Normalises the three dashboard breakdowns into one row shape (for one table + CSV). */
export function perfRows(d: TraxDashboard | null | undefined, tab: PerfTab): Perf[] {
  if (!d) return [];
  if (tab === 'checklist') return d.byChecklist.map((x) => ({ id: x.templateId, name: x.name, extra: `${humanize(x.frequency)} · ${x.stores} store(s)`, frequency: x.frequency, stores: x.stores, assigned: x.assigned, submitted: x.submitted, flags: x.flags, completionPct: x.completionPct, compliancePct: x.compliancePct }));
  if (tab === 'store') return d.byStore.map((x) => ({ id: x.storeId, name: x.storeName, assigned: x.assigned, submitted: x.submitted, flags: x.flags, completionPct: x.completionPct, compliancePct: x.compliancePct }));
  return d.byUser.map((x) => ({ id: x.userId, name: x.name, assigned: x.assigned, submitted: x.submitted, flags: x.flags, completionPct: x.completionPct, compliancePct: x.compliancePct }));
}

const TABS: PerfTab[] = ['checklist', 'store', 'user'];
const TAB_LABEL: Record<PerfTab, string> = { checklist: 'Checklist', store: 'Store', user: 'User' };

/** Trax › Overview › Dashboard (reference 05): stat strip, Checklist / Store / User performance tabs, drill-down table. */
@Component({
  selector: 'ce-trax-dashboard-page',
  imports: [RouterLink, MatIconModule, MatMenuModule, MatTooltipModule, ...DS, LoadStateComponent, PctPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-checklist-dashboard">
      <ce-page title="Checklist dashboard" description="Completion and compliance of manual checklists across checklists, stores and users" [lastRefreshed]="true">
        <ng-container pageActions>
          <button type="button" class="ce-btn ce-btn-secondary" [matMenuTriggerFor]="exportMenu" data-testid="btn-export-menu"><mat-icon>ios_share</mat-icon> Export <mat-icon>expand_more</mat-icon></button>
          <mat-menu #exportMenu="matMenu" xPosition="before">
            <button mat-menu-item (click)="exportCsv()" [disabled]="!rows().length" data-testid="btn-export-performance-csv"><mat-icon>csv</mat-icon> {{ tabLabel() }} performance (CSV)</button>
            <button mat-menu-item (click)="exportServer()" data-testid="btn-export-checklists-xlsx"><mat-icon>table_view</mat-icon> Submissions (Excel)</button>
          </mat-menu>
          @if (canCreate()) {
            <a class="ce-btn ce-btn-primary" routerLink="/checklists/templates/new" data-testid="btn-create-checklist"><mat-icon>add</mat-icon> Create checklist</a>
          }
        </ng-container>
        <ce-load-state [loading]="data.loading()" [error]="data.error()" [hasData]="true" [rows]="0" />

        @let d = data.data();
        @let busy = !d && data.loading();
        <ce-stat-strip class="trax-strip" data-testid="trax-tiles" label="Checklist summary">
          <ce-stat-tile variant="strip" id="trax-active" label="Active checklists" [value]="d?.activeChecklists" [loading]="busy" link="/checklists" />
          <ce-stat-tile variant="strip" id="trax-instances" label="Checklist instances" [value]="d?.checklistInstances" [loading]="busy" hint="Assignments due in the period" />
          <span class="ce-stat-strip-sep" aria-hidden="true"></span>
          <ce-stat-tile variant="strip" id="trax-not-submitted" label="Not submitted" [value]="d?.notSubmitted" [loading]="busy" link="/checklists/assignments" />
          <ce-stat-tile variant="strip" id="trax-open" label="Open" [value]="d?.open" [loading]="busy" />
          <ce-stat-tile variant="strip" id="trax-in-progress" label="In progress" [value]="d?.inProgress" [loading]="busy" />
          <span class="ce-stat-strip-sep" aria-hidden="true"></span>
          <ce-stat-tile variant="strip" id="trax-submitted" label="Submitted" [value]="d?.submitted" [loading]="busy" link="/checklists/submissions" />
          <ce-stat-tile variant="strip" id="trax-completion" label="Completion score" format="pct" [value]="d?.completionScorePct" [loading]="busy" hint="Submitted ÷ instances" />
          <ce-stat-tile variant="strip" id="trax-compliance" label="Compliance score" format="pct" [value]="d?.complianceScorePct" [loading]="busy" hint="Average submission score" />
          <ce-stat-tile variant="strip" id="trax-flags" label="Total flags" [value]="d?.totalFlags" [loading]="busy" [link]="['/checklists/submissions']" hint="Answers flagged in submissions (wrong answer, failed AI check)" />
        </ce-stat-strip>

        <div class="trax-panel">
          <ce-tabs [tabs]="tabItems()" [value]="tab()" (valueChange)="setTab($event)" queryParam="tab" label="Performance" data-testid="trax-tabs" />
          <ce-table
            [rows]="rows()"
            [columns]="columns()"
            [loading]="busy"
            [title]="tabLabel() + ' info'"
            [subtitle]="'Showing data on ' + rangeLabel()"
            [searchable]="true"
            [searchPlaceholder]="'Search by ' + tabLabel().toLowerCase()"
            searchTestId="input-search-trax"
            [exportable]="true"
            exportTestId="btn-export-dashboard"
            (exportClick)="exportCsv()"
            [testId]="'table-trax-' + tab()"
            [rowTestId]="rowId()"
            [pageSize]="50"
            [defaultSort]="{ key: 'submitted', dir: 'desc' }"
            [bare]="true"
            emptyIcon="fact_check"
            emptyTitle="No checklist activity in this period"
            emptyMessage="Assignments due in the selected dates will show here."
          >
            <ng-template ceCell="compliancePct" let-r>
              @if (r.submitted) {
                <span class="score-cell" [class.low]="r.compliancePct < 80">{{ r.compliancePct | pct }}</span>
              } @else {
                <!-- nothing submitted: no score yet -->
                <span class="dash">--</span>
              }
            </ng-template>
            <ng-template ceCell="completionPct" let-r>
              <span class="mini-bar"><span [style.width.%]="r.completionPct"></span></span><span class="tabular">{{ r.completionPct | pct }}</span>
            </ng-template>
            <ng-template ceCell="action" let-r>
              <button type="button" class="ce-icon-btn sm" (click)="view(r)" [matTooltip]="'View ' + tabLabel().toLowerCase()" [attr.aria-label]="'View ' + r.name" data-testid="btn-view"><mat-icon>visibility</mat-icon></button>
            </ng-template>
          </ce-table>
        </div>
      </ce-page>
    </section>
  `,
})
export class TraxDashboardPage {
  private readonly v2 = inject(V2Api);
  private readonly api = inject(ApiService);
  private readonly filter = inject(FilterService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  readonly tab = signal<PerfTab>('checklist');
  readonly data = loadOn(() => this.filter.params(), (p) => this.v2.traxDashboard(p));
  readonly rows = computed(() => perfRows(this.data.data(), this.tab()));
  readonly canCreate = computed(() => this.auth.can('manageTemplates'));
  readonly tabLabel = computed(() => TAB_LABEL[this.tab()]);
  readonly rangeLabel = computed(() => {
    const r = this.filter.range();
    return r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} – ${shortDate(r.to)}`;
  });
  readonly tabItems = computed<TabItem[]>(() => {
    const d = this.data.data();
    return [
      { value: 'checklist', label: 'Checklist performance', count: d?.byChecklist.length ?? null, testId: 'tab-trax-checklist' },
      { value: 'store', label: 'Store performance', count: d?.byStore.length ?? null, testId: 'tab-trax-store' },
      { value: 'user', label: 'User performance', count: d?.byUser.length ?? null, testId: 'tab-trax-user' },
    ];
  });
  readonly rowId = computed(() => {
    const t = this.tab();
    return (r: Perf) => `row-trax-${t}-${r.id}`;
  });

  readonly columns = computed<CeColumn<Perf>[]>(() => {
    const t = this.tab();
    const submissions = (r: Perf): Record<string, number> | null =>
      t === 'checklist' ? { templateId: r.id } : t === 'store' ? { storeId: r.id } : null;
    const name: CeColumn<Perf> =
      t === 'checklist'
        ? { key: 'name', header: 'Checklist name', type: 'link', link: (r) => ['/checklists/templates', r.id], sortable: true, locked: true }
        : t === 'store'
          ? { key: 'name', header: 'Store', type: 'text', sortable: true, locked: true }
          : { key: 'name', header: 'User', type: 'avatar', sortable: true, locked: true };
    const cols: CeColumn<Perf>[] = [name];
    if (t === 'checklist') {
      cols.push({ key: 'frequency', header: 'Scheduled', format: (v) => (v ? humanize(String(v)) : null), sortable: true });
      cols.push({ key: 'stores', header: 'Coverage', format: (v) => (v === 1 ? 'Store' : v ? `${v} stores` : null), searchable: false });
    }
    cols.push(
      { key: 'assigned', header: 'Assigned to', type: 'number', sortable: true, align: 'left' },
      {
        key: 'submitted',
        header: 'Submitted',
        type: 'link-number',
        sortable: true,
        click: (r) => this.openSubmissions(submissions(r)),
      },
      {
        key: 'flags',
        header: 'Flags',
        type: 'link-number',
        sortable: true,
        click: (r) => this.openSubmissions({ ...(submissions(r) ?? {}), flagged: 1 }),
      },
      { key: 'completionPct', header: 'Completion', type: 'percent', sortable: true, align: 'left' },
      { key: 'compliancePct', header: 'Compliance', type: 'percent', sortable: true, align: 'left' },
      { key: 'action', header: 'Action', type: 'actions', align: 'center', locked: true, value: () => '' },
    );
    return cols;
  });

  setTab(v: string): void {
    this.tab.set((TABS as string[]).includes(v) ? (v as PerfTab) : 'checklist');
  }

  openSubmissions(q: Record<string, number> | null): void {
    void this.router.navigate(['/checklists/submissions'], { queryParams: q ?? {} });
  }

  view(r: Perf): void {
    const t = this.tab();
    if (t === 'checklist') void this.router.navigate(['/checklists/templates', r.id]);
    else this.openSubmissions(t === 'store' ? { storeId: r.id } : null);
  }

  exportCsv(): void {
    const r = this.filter.range();
    const csv = toCsv(this.rows(), [
      { label: humanize(this.tab()), value: (x) => x.name },
      { label: 'Assigned', value: (x) => x.assigned },
      { label: 'Submitted', value: (x) => x.submitted },
      { label: 'Flags', value: (x) => x.flags },
      { label: 'Completion %', value: (x) => x.completionPct },
      { label: 'Compliance %', value: (x) => x.compliancePct },
    ]);
    saveBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `checklist-${this.tab()}-performance_${r.from}_${r.to}.csv`);
  }

  exportServer(): void {
    const p = this.filter.params();
    this.api
      .download('/reports/export', { type: 'checklists', format: 'xlsx', storeIds: p.storeIds, from: p.from, to: p.to }, 'checklists.xlsx')
      .subscribe((f) => saveBlob(f.blob, f.filename));
  }
}
