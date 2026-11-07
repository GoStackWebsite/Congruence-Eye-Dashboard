import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth/auth.service';
import { PosImportResult, REPORT_TYPES, ReportFormat, ReportSchedule, ReportType } from '../../core/models/api.models';
import { ApiService, saveBlob, silent } from '../../core/services/api.service';
import { FilterService } from '../../core/services/filter.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { shortDate } from '../../core/utils/dates';
import { humanize } from '../../core/utils/format';
import { enumOptions } from '../../shared/crud/field';
import { CeColumn, DS } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { AdminField, EntityDrawerComponent } from '../../shared/ds/entity-drawer.component';
import { useOpsStyles } from '../../shared/ds/ops.styles';

export const REPORT_INFO: Record<ReportType, { icon: string; desc: string }> = {
  traffic: { icon: 'directions_walk', desc: 'Daily footfall, unique, engaged and bounced' },
  zones: { icon: 'grid_view', desc: 'Zone visits, dwell and classification' },
  conversion: { icon: 'shopping_cart_checkout', desc: 'Conversion, revenue and ATV by day' },
  queue: { icon: 'queue', desc: 'Queue length, wait and breaches by counter' },
  storeops: { icon: 'storefront', desc: 'Open/close compliance and SOP events' },
  benchmark: { icon: 'leaderboard', desc: 'Store league table' },
  checklists: { icon: 'fact_check', desc: 'Checklist submissions and scores' },
  alerts: { icon: 'notifications_active', desc: 'Alerts raised and their status' },
  tasks: { icon: 'task_alt', desc: 'Tasks by status and assignee' },
  tickets: { icon: 'confirmation_number', desc: 'Tickets with SLA status' },
};

/** First columns of each export (as produced by the server), shown on the catalogue cards. */
export const REPORT_COLUMNS: Record<ReportType, string> = {
  traffic: 'Date, Store, Footfall in / out, Unique visitors, Engaged, Bounced, Avg dwell',
  zones: 'Store, Zone, Visits, Unique visitors, Avg dwell, Engaged %, Male / Female, Class',
  conversion: 'Date, Store, Footfall, Transactions, Conversion %, Revenue, ATV, Missed opportunities',
  queue: 'Date, Store, Avg / max queue, Avg / max wait, Breaches, Unattended minutes',
  storeops: 'Date, Store, Scheduled / actual open, Late minutes, Scheduled / actual close, Early minutes',
  benchmark: 'Rank, Store, Region, Footfall, Conversion %, Revenue, Revenue / sq ft, Compliance %',
  checklists: 'Date, Store, Template, Submitted by, Score, Score %, Status',
  alerts: 'Created at, Store, Rule, Metric, Severity, Value, Status, Resolved at',
  tasks: 'ID, Title, Store, Priority, Status, Assignee, Due at, Completed at',
  tickets: 'Ticket, Title, Store, Category, Priority, Status, SLA due, SLA breached',
};

export const REPORT_GROUPS: { id: string; label: string; icon: string; types: ReportType[] }[] = [
  { id: 'traffic', label: 'Traffic & revenue', icon: 'monitoring', types: ['traffic', 'zones', 'conversion', 'queue', 'benchmark'] },
  { id: 'ops', label: 'Store operations', icon: 'storefront', types: ['storeops', 'alerts', 'tickets'] },
  { id: 'trax', label: 'Trax (checklists & tasks)', icon: 'fact_check', types: ['checklists', 'tasks'] },
];

const EMAILS = /^\s*[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+(\s*[,;]\s*[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+)*\s*$/;

/** Reports: export catalogue grouped by module, POS import and scheduled reports (table + editor drawer). */
@Component({
  selector: 'ce-reports-page',
  imports: [MatIconModule, MatProgressSpinnerModule, MatTooltipModule, ...DS, EntityDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-reports">
      <ce-page title="Reports" [description]="'Exports use the top-bar filter · ' + rangeLabel()">
        <ng-container pageActions>
          <span class="caption">Format</span>
          <ce-segmented [options]="formats" [value]="format()" (valueChange)="format.set($any($event))" label="Export format" data-testid="select-report-format" />
        </ng-container>

        <div class="ops-stack" data-testid="report-exports" style="gap: 20px">
          @for (g of groups; track g.id) {
            <div class="ops-cat-group">
              <div class="ops-cat-title"><span class="material-symbols-outlined" aria-hidden="true">{{ g.icon }}</span>{{ g.label }}</div>
              <div class="ops-cat-grid">
                @for (t of g.types; track t) {
                  <div class="ops-report" [attr.data-testid]="'report-card-' + t">
                    <div class="ops-report-head">
                      <span class="ops-report-icon" aria-hidden="true"><span class="material-symbols-outlined">{{ info[t].icon }}</span></span>
                      <div class="ops-user-text">
                        <span class="ops-report-name">{{ title(t) }}</span>
                        <span class="ops-report-desc">{{ info[t].desc }}</span>
                      </div>
                    </div>
                    <div class="ops-report-cols" [title]="cols[t]">Columns: {{ cols[t] }}</div>
                    <div class="ops-report-foot">
                      <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="exportReport(t, format())" [disabled]="busy() === t" [attr.data-testid]="'btn-export-' + t">
                        @if (busy() === t) {
                          <mat-spinner diameter="14" />
                        } @else {
                          <mat-icon>download</mat-icon>
                        }
                        {{ format().toUpperCase() }}
                      </button>
                      <button type="button" class="ce-btn ce-btn-ghost ce-btn-sm" (click)="exportReport(t, other())" [disabled]="busy() === t" [attr.data-testid]="'btn-export-' + t + '-alt'" [attr.aria-label]="'Download ' + title(t) + ' as ' + other().toUpperCase()">{{ other().toUpperCase() }}</button>
                      <span class="ops-spacer"></span>
                      @if (canSchedule()) {
                        <button type="button" class="ce-icon-btn sm" matTooltip="Schedule this report" [attr.aria-label]="'Schedule ' + title(t)" (click)="scheduleFor(t)" [attr.data-testid]="'btn-schedule-' + t"><mat-icon>schedule_send</mat-icon></button>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        </div>

        @if (auth.can('posImport')) {
          <ce-card title="POS import" subtitle="CSV header: storeCode, billNo, ts, amount, itemsCount, staffCode — duplicates are skipped" icon="point_of_sale" data-testid="pos-import">
            <div class="ops-row">
              <input #pos type="file" accept=".csv,text/csv" hidden (change)="importPos(pos)" data-testid="input-pos-file" />
              <button type="button" class="ce-btn ce-btn-secondary" (click)="pos.click()" [disabled]="importing()" data-testid="btn-import-pos">
                @if (importing()) {
                  <mat-spinner diameter="14" />
                } @else {
                  <mat-icon>upload</mat-icon>
                }
                Upload POS CSV
              </button>
              @if (importResult(); as r) {
                <span data-testid="pos-import-result">Accepted {{ r.accepted }} · duplicates {{ r.duplicates }} · errors {{ r.errors.length }}</span>
              } @else {
                <span class="caption">Transactions feed conversion, ATV and revenue.</span>
              }
            </div>
            @if (importResult()?.errors?.length) {
              <ul class="ops-noc-issues" style="padding: 10px 0 0">
                @for (e of importResult()!.errors.slice(0, 10); track $index) {
                  <li><span class="material-symbols-outlined" aria-hidden="true">error</span><span>{{ e }}</span></li>
                }
              </ul>
            }
          </ce-card>
        }

        <div class="ops-min0" data-testid="page-report-schedules">
          @if (schedules.error() && !schedules.data()) {
            <ce-card title="Scheduled reports">
              <ce-empty-state kind="error" [message]="schedules.error()">
                <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="schedules.reload()" data-testid="btn-retry">Retry</button>
              </ce-empty-state>
            </ce-card>
          } @else {
            <ce-table
              [rows]="schedules.data() ?? []"
              [columns]="schedCols"
              [loading]="schedules.loading() && !schedules.data()"
              title="Scheduled reports"
              subtitle="Emailed automatically when SMTP is set up in Settings; otherwise saved on the server"
              [searchable]="true"
              searchPlaceholder="Search schedules"
              searchTestId="input-search"
              testId="table-report-schedules"
              [rowTestId]="schedRowId"
              [rowClass]="schedRowClass"
              emptyIcon="schedule_send"
              emptyTitle="No scheduled reports"
              emptyMessage="Send a daily, weekly or monthly report to the CEO and area managers."
            >
              @if (canSchedule()) {
                <button tableActions type="button" class="ce-btn ce-btn-primary" (click)="openForm(null)" data-testid="btn-create-schedule"><mat-icon>add</mat-icon> New schedule</button>
              }
              <button tableActions type="button" class="ce-btn ce-btn-secondary ce-icon-btn" (click)="schedules.reload()" matTooltip="Refresh" aria-label="Refresh" data-testid="btn-refresh"><mat-icon>refresh</mat-icon></button>
            <ng-template ceCell="stores" let-s>
                @let names = storeNames(s);
                @if (!names.length) {
                  <span class="ops-chip all">All stores</span>
                } @else {
                  <span class="ops-chips" [title]="names.join(', ')">
                    @for (n of names.slice(0, 2); track n) {
                      <span class="ops-chip">{{ n }}</span><span class="ops-sr">, </span>
                    }
                    @if (names.length > 2) {
                      <span class="ops-chip">+{{ names.length - 2 }}</span>
                    }
                  </span>
                }
              </ng-template>
              <ng-template ceCell="isActive" let-s><ce-pill [value]="s.isActive ? 'YES' : 'NO'" [label]="s.isActive ? 'Active' : 'Paused'" size="sm" /></ng-template>
              <ng-template ceCell="actions" let-s>
                <span class="ops-row-actions">
                  @if (canSchedule()) {
                    <button type="button" class="ce-icon-btn sm" matTooltip="Run now" aria-label="Run now" (click)="run(s)" [disabled]="running() === s.id" data-testid="btn-run-schedule">
                      @if (running() === s.id) {
                        <mat-spinner diameter="14" />
                      } @else {
                        <mat-icon>play_arrow</mat-icon>
                      }
                    </button>
                    <button type="button" class="ce-icon-btn sm" matTooltip="Edit" aria-label="Edit schedule" (click)="openForm(s)" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
                    <button type="button" class="ce-icon-btn sm" matTooltip="Delete" aria-label="Delete schedule" (click)="remove(s)" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
                  }
                </span>
              </ng-template>
            </ce-table>
          }
        </div>
      </ce-page>

      <ce-entity-drawer
        [(open)]="formOpen"
        entity="schedule"
        [title]="editing() ? 'Edit schedule' : 'New scheduled report'"
        subtitle="Covers the previous day, week or month for the chosen stores"
        [fields]="fields"
        [value]="formValue()"
        [submit]="submit"
        [submitLabel]="editing() ? 'Save changes' : 'Create schedule'"
        (saved)="onSaved()"
      />
    </section>
  `,
})
export class ReportsPage {
  protected readonly opsCss = useOpsStyles();
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly filter = inject(FilterService);
  private readonly lookup = inject(LookupService);
  private readonly ui = inject(UiService);
  readonly types = REPORT_TYPES;
  readonly groups = REPORT_GROUPS;
  readonly info = REPORT_INFO;
  readonly cols = REPORT_COLUMNS;
  readonly formats = [
    { value: 'csv', label: 'CSV', testId: 'format-csv' },
    { value: 'xlsx', label: 'XLSX', testId: 'format-xlsx' },
  ];
  readonly format = signal<ReportFormat>('csv');
  readonly other = computed<ReportFormat>(() => (this.format() === 'csv' ? 'xlsx' : 'csv'));
  readonly busy = signal<ReportType | null>(null);
  readonly importing = signal(false);
  readonly importResult = signal<PosImportResult | null>(null);
  readonly running = signal<number | null>(null);
  readonly formOpen = signal(false);
  readonly editing = signal<ReportSchedule | null>(null);
  readonly preset = signal<ReportType | null>(null);
  readonly canSchedule = computed(() => this.auth.can('reports'));
  readonly rangeLabel = computed(() => {
    const r = this.filter.range();
    const n = this.filter.selectedStoreIds().length;
    return `${shortDate(r.from)} – ${shortDate(r.to)} · ${n ? n + ' store(s)' : 'all stores'}`;
  });

  readonly schedules = loadOn(() => ({}), () => this.api.get<ReportSchedule[]>('/reports/schedules'));
  readonly schedRowId = (s: ReportSchedule) => `row-schedule-${s.id}`;
  readonly schedRowClass = (s: ReportSchedule) => (s.isActive ? null : 'ops-dim');
  readonly schedCols: CeColumn<ReportSchedule>[] = [
    { key: 'name', header: 'Name', sortable: true, locked: true, secondary: (s) => s.recipients },
    { key: 'type', header: 'Report', format: (v) => this.title(v as ReportType), sortable: true },
    { key: 'format', header: 'Format', format: (v) => String(v ?? '').toUpperCase() },
    { key: 'frequency', header: 'Frequency', format: (v) => humanize(String(v ?? '')), sortable: true },
    { key: 'stores', header: 'Stores', value: (s) => this.storeNames(s).join(', ') || 'All stores' },
    { key: 'isActive', header: 'Status', value: (s) => (s.isActive ? 'Active' : 'Paused'), sortable: true },
    { key: 'lastRunAt', header: 'Last run', type: 'datetime', sortable: true },
    { key: 'actions', header: 'Action', type: 'actions', value: () => '', align: 'right', locked: true },
  ];
  readonly formValue = computed(() => this.editing() ?? (this.preset() ? { type: this.preset(), name: `${this.title(this.preset()!)} report` } : null));
  readonly fields: AdminField[] = [
    { key: 'name', label: 'Name', type: 'text', required: true, full: true, placeholder: 'Weekly benchmark for the CEO' },
    { key: 'type', label: 'Report', type: 'select', required: true, options: enumOptions(REPORT_TYPES, humanize), default: 'traffic' },
    { key: 'format', label: 'Format', type: 'select', required: true, options: [{ value: 'csv', label: 'CSV' }, { value: 'xlsx', label: 'XLSX' }], default: 'xlsx' },
    { key: 'frequency', label: 'Frequency', type: 'select', required: true, options: enumOptions(['DAILY', 'WEEKLY', 'MONTHLY'], humanize), default: 'DAILY', helper: 'Daily at 07:00, weekly on Monday, monthly on the 1st' },
    { key: 'storeIds', label: 'Stores', type: 'multiselect', placeholder: 'All stores', options: () => this.lookup.scopedStores().map((s) => ({ value: s.id, label: s.name })), full: true, hint: 'Leave empty for all stores' },
    {
      key: 'recipients',
      label: 'Recipients',
      type: 'text',
      required: true,
      full: true,
      placeholder: 'ceo@congruence.in, ops@congruence.in',
      hint: 'Comma-separated email addresses',
      validate: (v) => (EMAILS.test(String(v ?? '')) ? null : 'Separate valid email addresses with commas'),
    },
    { key: 'isActive', label: 'Active', type: 'checkbox', default: true },
  ];

  readonly submit = (v: Record<string, unknown>) => {
    const s = this.editing();
    return s ? this.api.patch(`/reports/schedules/${s.id}`, v, silent()) : this.api.post('/reports/schedules', v, null, silent());
  };

  constructor() {
    this.lookup.loadStores().subscribe();
  }

  title(t: ReportType): string {
    return t === 'storeops' ? 'Store operations' : humanize(t);
  }

  storeNames(s: ReportSchedule): string[] {
    return (s.storeIds ?? []).map((id) => this.lookup.storeName()(id));
  }

  exportReport(type: ReportType, fmt: ReportFormat): void {
    if (this.busy()) return;
    const p = this.filter.params();
    this.busy.set(type);
    this.api.download('/reports/export', { type, format: fmt, storeIds: p.storeIds, from: p.from, to: p.to }, `${type}_${p.from}_${p.to}.${fmt}`).subscribe({
      next: (f) => {
        this.busy.set(null);
        saveBlob(f.blob, f.filename);
      },
      error: () => this.busy.set(null),
    });
  }

  scheduleFor(t: ReportType): void {
    this.editing.set(null);
    this.preset.set(t);
    this.formOpen.set(true);
  }

  openForm(s: ReportSchedule | null): void {
    this.preset.set(null);
    this.editing.set(s);
    this.formOpen.set(true);
  }

  onSaved(): void {
    this.ui.toast(this.editing() ? 'Saved' : 'Created');
    this.schedules.reload();
  }

  run(s: ReportSchedule): void {
    if (this.running()) return;
    this.running.set(s.id);
    this.api.post<{ ok: boolean; file: string }>(`/reports/schedules/${s.id}/run`).subscribe({
      next: (r) => {
        this.running.set(null);
        this.ui.toast(r.file ? `Report generated: ${r.file}` : 'Report run');
        this.schedules.reload();
      },
      error: () => this.running.set(null),
    });
  }

  remove(s: ReportSchedule): void {
    this.ui.confirm({ title: 'Delete schedule?', message: `Delete "${s.name}"? Recipients stop receiving it.`, confirmText: 'Delete', danger: true }).subscribe(() =>
      this.api.delete(`/reports/schedules/${s.id}`).subscribe(() => {
        this.ui.toast('Deleted');
        this.schedules.reload();
      }),
    );
  }

  importPos(input: HTMLInputElement): void {
    const file = input.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file, file.name);
    this.importing.set(true);
    this.api.upload<PosImportResult>('/pos/import', fd).subscribe({
      next: (r) => {
        this.importing.set(false);
        this.importResult.set(r);
        input.value = '';
        this.ui.toast(`Imported ${r.accepted} transactions`);
      },
      error: () => {
        this.importing.set(false);
        input.value = '';
      },
    });
  }
}
