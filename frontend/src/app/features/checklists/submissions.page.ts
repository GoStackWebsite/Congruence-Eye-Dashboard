import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import { Submission, SubmissionStatus, Template } from '../../core/models/api.models';
import { ApiService, saveBlob } from '../../core/services/api.service';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { toCsv } from '../../core/utils/csv';
import { shortDate } from '../../core/utils/dates';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { PctPipe } from '../../shared/pipes';
import { storeDateTime, withMobileLabels } from './_ui/ops';
import { LIST_STYLES } from './_ui/styles';

type Row = Submission & { flagCount: number };

export function scoreBand(pct: number | null | undefined): 'low' | 'mid' | 'good' {
  const v = Number(pct) || 0;
  return v < 60 ? 'low' : v < 85 ? 'mid' : 'good';
}

/** Trax › Manage › Submissions: completed checklists to review (deep-linkable from the dashboard: ?templateId=&storeId=&flagged=1). */
@Component({
  selector: 'ce-submissions-page',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule, MatIconModule, ...DS, ...LIST_STYLES, PctPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles />
    <section class="ops-page" data-testid="page-checklist-submissions">
      <ce-page title="Submissions" description="Completed checklists — open one to review, approve or request a redo" [lastRefreshed]="true">
        <ce-stat-strip label="Submission summary">
          <ce-stat-tile variant="strip" id="sub-total" label="Submissions" [value]="all().length" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="sub-review" label="Awaiting review" [value]="countOf('SUBMITTED')" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="sub-redo" label="Redo requested" [value]="countOf('REDO')" [loading]="busy()" />
          <span class="ce-stat-strip-sep" aria-hidden="true"></span>
          <ce-stat-tile variant="strip" id="sub-avg" label="Average score" format="pct" [value]="avg()" [loading]="busy()" hint="Mean score of the submissions listed" />
          <ce-stat-tile variant="strip" id="sub-flags" label="Flagged answers" [value]="flags()" [loading]="busy()" />
        </ce-stat-strip>

        @if (data.error() && !data.data()) {
          <div class="ops-card">
            <ce-empty-state kind="error" [message]="data.error()"><button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button></ce-empty-state>
          </div>
        } @else {
          <div class="ops-card">
            <ce-tabs [tabs]="tabs()" [value]="status() ?? 'all'" (valueChange)="status.set($event === 'all' ? null : $any($event))" label="Submission status" />
            <ce-table
              [rows]="rows()"
              [columns]="cols"
              [loading]="busy()"
              title="Submission info"
              [subtitle]="'Showing data on ' + rangeLabel()"
              [searchable]="true"
              searchPlaceholder="Search checklist, store or person"
              searchTestId="input-search-submissions"
              [exportable]="true"
              exportTestId="btn-export-submissions"
              (exportClick)="exportCsv($event)"
              testId="table-submissions"
              [rowTestId]="rowId"
              [rowClickable]="true"
              (rowClick)="open($event)"
              [bare]="true"
              [defaultSort]="{ key: 'submittedAt', dir: 'desc' }"
              emptyIcon="inventory"
              [emptyTitle]="filtered() ? 'No submissions match these filters' : 'No submissions in this period'"
              [emptyMessage]="filtered() ? 'Clear the filters, or widen the date range in the top bar.' : 'Change the date range or stores in the top bar.'"
            >
              <div tableFilters class="ops-toolbar" style="margin-top: 8px">
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="ops-filter wide">
                  <mat-select [ngModel]="templateId()" (ngModelChange)="templateId.set($event)" placeholder="All checklists" data-testid="filter-submission-template" aria-label="Checklist">
                    <mat-option [value]="null">All checklists</mat-option>
                    @for (t of templates(); track t.id) {
                      <mat-option [value]="t.id">{{ t.name }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="ops-filter">
                  <mat-select [ngModel]="status()" (ngModelChange)="status.set($event)" placeholder="All statuses" data-testid="filter-submission-status" aria-label="Status">
                    <mat-option [value]="null">All statuses</mat-option>
                    <mat-option value="SUBMITTED">Awaiting review</mat-option>
                    <mat-option value="APPROVED">Approved</mat-option>
                    <mat-option value="REDO">Redo</mat-option>
                  </mat-select>
                </mat-form-field>
                @if (flaggedOnly() || storeId()) {
                  <button type="button" class="ops-filter-chip" (click)="flaggedOnly.set(false); storeId.set(null)" data-testid="btn-clear-deeplink">
                    {{ flaggedOnly() ? 'Flagged only' : '' }}{{ flaggedOnly() && storeId() ? ' · ' : '' }}{{ storeId() ? 'One store' : '' }} <span class="material-symbols-outlined">close</span>
                  </button>
                }
                @if (filtered()) {
                  <button type="button" class="ce-link-btn" (click)="clearFilters()" data-testid="btn-clear-filters">Clear filters</button>
                }
              </div>
              <ng-template ceCell="templateName" let-s>
                <div class="ops-cell-title" [title]="s.templateName + ' — ' + s.storeName">
                  <span class="t">{{ s.templateName }}</span>
                  <span class="s">{{ s.storeName }}</span>
                </div>
              </ng-template>
              <ng-template ceCell="scorePct" let-s>
                <span class="ops-score" [class]="'ops-score ' + band(s.scorePct)" [title]="s.score + ' / ' + s.maxScore"><span class="bar"><span [style.width.%]="s.scorePct"></span></span><span class="v">{{ s.scorePct | pct }}</span></span>
              </ng-template>
              <ng-template ceCell="flagCount" let-s>
                <span class="ops-flags" [class.zero]="!s.flagCount"><span class="material-symbols-outlined">flag</span>{{ s.flagCount }}</span>
              </ng-template>
              <ng-template ceCell="status" let-s>
                <span class="sub-status" style="display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap"><ce-pill [value]="s.status" [label]="s.status === 'SUBMITTED' ? 'Awaiting review' : null" data-testid="chip-status" />@if (s.isLate) {<ce-pill tone="warning" label="Late" size="sm" data-testid="chip-late" />}</span>
              </ng-template>
              <ng-template ceCell="action" let-s>
                <button type="button" class="ce-icon-btn sm" aria-label="Open submission" data-testid="btn-view"><span class="material-symbols-outlined">visibility</span></button>
              </ng-template>
            </ce-table>
          </div>
        }
      </ce-page>
    </section>
  `,
})
export class SubmissionsPage {
  private readonly api = inject(ApiService);
  private readonly filter = inject(FilterService);
  private readonly router = inject(Router);
  readonly templateId = signal<number | null>(null);
  readonly status = signal<SubmissionStatus | null>(null);
  readonly templates = signal<Template[]>([]);
  /** Deep link from the Trax dashboard: ?templateId=&storeId=&flagged=1 */
  private readonly qp = inject(ActivatedRoute).snapshot.queryParamMap;
  readonly flaggedOnly = signal(this.qp.get('flagged') === '1');
  readonly storeId = signal<number | null>(Number(this.qp.get('storeId')) || null);

  readonly data = loadOn(
    () => {
      const p = this.filter.params();
      const sid = this.storeId();
      return { storeIds: sid ? [sid] : p.storeIds, from: p.from, to: p.to, templateId: this.templateId() };
    },
    (q) => this.api.get<Submission[]>('/checklists/submissions', q),
  );
  readonly busy = computed(() => this.data.loading() && !this.data.data());
  readonly all = computed<Row[]>(() => (this.data.data() ?? []).map((s) => ({ ...s, flagCount: s.flags ?? 0 })));
  readonly rows = computed(() => {
    const st = this.status();
    const flagged = this.flaggedOnly();
    return this.all().filter((s) => (!st || s.status === st) && (!flagged || s.flagCount > 0));
  });
  readonly filtered = computed(() => !!this.status() || !!this.templateId() || this.flaggedOnly() || !!this.storeId());
  readonly avg = computed(() => {
    const r = this.rows();
    return this.data.data() ? (r.length ? r.reduce((s, x) => s + x.scorePct, 0) / r.length : null) : undefined;
  });
  readonly flags = computed(() => (this.data.data() ? this.rows().reduce((s, x) => s + x.flagCount, 0) : undefined));
  readonly tabs = computed<TabItem[]>(() => {
    const d = !!this.data.data();
    return [
      { value: 'all', label: 'All', count: d ? this.all().length : null, testId: 'tab-submissions-all' },
      { value: 'SUBMITTED', label: 'Awaiting review', count: d ? this.countOf('SUBMITTED') : null, testId: 'tab-submissions-review' },
      { value: 'REDO', label: 'Redo', count: d ? this.countOf('REDO') : null, testId: 'tab-submissions-redo' },
      { value: 'APPROVED', label: 'Approved', count: d ? this.countOf('APPROVED') : null, testId: 'tab-submissions-approved' },
    ];
  });
  readonly rangeLabel = computed(() => {
    const r = this.filter.range();
    return r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} – ${shortDate(r.to)}`;
  });
  readonly rowId = (s: Row) => `row-submission-${s.id}`;
  readonly cols: CeColumn<Row>[] = withMobileLabels<Row>(
    [
      { key: 'templateName', header: 'Checklist', type: 'custom', sortable: true, locked: true, searchable: true, value: (s) => `${s.templateName} ${s.storeName}` },
      { key: 'submittedByName', header: 'Submitted by', type: 'avatar', sortable: true },
      { key: 'submittedAt', header: 'Submitted on', sortable: true, format: (v) => storeDateTime(String(v)) },
      { key: 'scorePct', header: 'Score', type: 'custom', sortable: true },
      { key: 'flagCount', header: 'Flags', type: 'custom', sortable: true },
      { key: 'status', header: 'Status', type: 'custom', sortable: true, value: (s) => s.status },
      { key: 'action', header: 'Action', type: 'actions', align: 'center', locked: true, value: () => '' },
    ],
    ['action'],
  );

  constructor() {
    const tid = Number(this.qp.get('templateId'));
    if (tid) this.templateId.set(tid);
    this.api.get<Template[]>('/checklists/templates').subscribe((t) => this.templates.set(t));
  }

  countOf(s: SubmissionStatus): number {
    return this.all().filter((x) => x.status === s).length;
  }
  band(p: number) {
    return scoreBand(p);
  }
  clearFilters(): void {
    this.status.set(null);
    this.templateId.set(null);
    this.flaggedOnly.set(false);
    this.storeId.set(null);
  }
  open(s: Submission): void {
    void this.router.navigate(['/checklists/submissions', s.id]);
  }
  exportCsv(rows: Row[]): void {
    const r = this.filter.range();
    const csv = toCsv(rows, [
      { label: 'Checklist', value: (x) => x.templateName },
      { label: 'Store', value: (x) => x.storeName },
      { label: 'Submitted by', value: (x) => x.submittedByName },
      { label: 'Submitted at', value: (x) => x.submittedAt },
      { label: 'Score', value: (x) => x.score },
      { label: 'Max score', value: (x) => x.maxScore },
      { label: 'Score %', value: (x) => x.scorePct },
      { label: 'Flags', value: (x) => x.flagCount },
      { label: 'Status', value: (x) => x.status },
      { label: 'Late', value: (x) => (x.isLate ? 'Yes' : 'No') },
    ]);
    saveBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `submissions_${r.from}_${r.to}.csv`);
  }
}
