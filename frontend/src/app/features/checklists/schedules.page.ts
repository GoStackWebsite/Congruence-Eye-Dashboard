import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth/auth.service';
import { ChecklistSchedule, ChecklistScheduleInput, ScheduleFrequency, Template } from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { toIsoDate } from '../../core/utils/dates';
import { DOW_SHORT, scheduleSummary, validateSchedule } from '../../core/utils/v2-helpers';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { apiErrorText } from '../../core/utils/http-errors';
import { hm12, occursSentence, storeDate, withMobileLabels } from './_ui/ops';
import { LIST_STYLES, OpsEditorStyles } from './_ui/styles';

export function emptySchedule(): ChecklistScheduleInput {
  return {
    templateId: 0,
    storeIds: [],
    assigneeId: null,
    frequency: 'DAILY',
    repeatEvery: 1,
    daysOfWeek: [],
    dayOfMonth: null,
    windowStart: '09:30',
    windowEnd: '10:30',
    startDate: toIsoDate(new Date()),
    endDate: null,
    reminderMinutesBefore: 30,
    isActive: true,
  };
}

/** Payload with fields irrelevant to the frequency cleared. */
export function schedulePayload(f: ChecklistScheduleInput): ChecklistScheduleInput {
  return {
    ...f,
    repeatEvery: Math.max(1, Number(f.repeatEvery) || 1),
    daysOfWeek: f.frequency === 'WEEKLY' ? [...new Set(f.daysOfWeek)].sort() : [],
    dayOfMonth: f.frequency === 'MONTHLY' ? (f.dayOfMonth ? Number(f.dayOfMonth) : null) : null,
    endDate: f.frequency === 'ONCE' ? f.startDate : f.endDate || null,
    reminderMinutesBefore: Math.max(0, Number(f.reminderMinutesBefore) || 0),
  };
}

/** Field-level schedule problems (inline messages), on top of validateSchedule(). */
export function scheduleFieldErrors(f: ChecklistScheduleInput, dateRange: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.templateId) e['template'] = 'Choose a checklist';
  if (!f.storeIds.length) e['stores'] = 'Choose at least one store';
  if (!/^\d{2}:\d{2}$/.test(f.windowStart ?? '') || !/^\d{2}:\d{2}$/.test(f.windowEnd ?? '')) e['window'] = 'Enter both times';
  else if (f.windowStart >= f.windowEnd) e['window'] = 'The end time must be after the start time';
  if (f.frequency === 'WEEKLY' && !f.daysOfWeek.length) e['days'] = 'Pick at least one day';
  if (f.frequency === 'MONTHLY' && f.dayOfMonth !== null && f.dayOfMonth !== undefined && (Number(f.dayOfMonth) < 1 || Number(f.dayOfMonth) > 31)) e['dom'] = 'Day must be between 1 and 31';
  if (f.frequency !== 'ONCE' && !(Number(f.repeatEvery) >= 1)) e['repeat'] = 'Must be 1 or more';
  if (!f.startDate) e['start'] = 'Pick a start date';
  if (f.frequency !== 'ONCE' && dateRange) {
    if (!f.endDate) e['end'] = 'Pick an end date, or turn off the date range';
    else if (f.startDate && f.endDate < f.startDate) e['end'] = 'The end date must be on or after the start date';
  }
  if (!(Number(f.reminderMinutesBefore) >= 0)) e['reminder'] = 'Must be 0 or more';
  return e;
}

type Row = ChecklistSchedule & { status: 'ACTIVE' | 'PAUSED'; storesLabel: string; assigneeLabel: string; summary: string };

/**
 * Trax › Manage › Schedules: list of smart schedules and the schedule editor (reference 06) in a side panel —
 * For [Daily] At [9:30 AM] Ends [10:30 AM], Starts from, Repeat every [n] [days], Ends on, "Occurs every …" summary,
 * Response configuration and Advanced configuration accordions.
 */
@Component({
  selector: 'ce-schedules-page',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule, MatCheckboxModule, MatSlideToggleModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, ...DS, ...LIST_STYLES, OpsEditorStyles],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles /><ce-ops-editor-styles />
    <section class="ops-page" data-testid="page-checklist-schedules">
      <ce-page title="Schedules" description="Smart scheduling — repeat pattern, time window, start and end dates, stores and reminders">
        <ng-container pageActions>
          @if (canEdit()) {
            <button type="button" class="ce-btn ce-btn-primary" (click)="edit(null)" data-testid="btn-create-checklist-schedule"><mat-icon>event_repeat</mat-icon> New schedule</button>
          }
        </ng-container>

        <ce-stat-strip label="Schedule summary">
          <ce-stat-tile variant="strip" id="sched-active" label="Active schedules" [value]="count('ACTIVE')" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="sched-paused" label="Paused" [value]="count('PAUSED')" [loading]="busy()" />
          <span class="ce-stat-strip-sep" aria-hidden="true"></span>
          <ce-stat-tile variant="strip" id="sched-stores" label="Stores covered" [value]="storesCovered()" [loading]="busy()" hint="Distinct stores with at least one active schedule" />
          <ce-stat-tile variant="strip" id="sched-today" label="Generated today" [value]="generatedToday()" [loading]="busy()" hint="Schedules that already created today's assignments" />
        </ce-stat-strip>

        @if (data.error() && !data.data()) {
          <div class="ops-card">
            <ce-empty-state kind="error" [message]="data.error()"><button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button></ce-empty-state>
          </div>
        } @else {
          <div class="ops-card">
            <ce-tabs [tabs]="tabs()" [(value)]="tab" label="Schedule status" />
            <ce-table
              [rows]="rows()"
              [columns]="cols"
              [loading]="busy()"
              title="Schedule info"
              [searchable]="true"
              searchPlaceholder="Search by checklist"
              searchTestId="input-search-schedules"
              testId="table-schedules"
              [rowTestId]="rowId"
              [bare]="true"
              emptyIcon="event_repeat"
              [emptyTitle]="tab() !== 'all' ? 'No ' + tab() + ' schedules' : 'No schedules yet'"
              [emptyMessage]="tab() !== 'all' ? 'Switch to “All” to see every schedule.' : 'Schedule a checklist to auto-assign it to stores every day, week or month.'"
            >
              <ng-template ceCell="templateName" let-s>
                <div class="ops-cell-title" [title]="s.templateName + ' — ' + s.summary">
                  <span class="t">{{ s.templateName }}</span>
                  <span class="s">{{ s.summary }}</span>
                </div>
              </ng-template>
              <ng-template ceCell="stores" let-s>
                <span class="ops-with-icon" [matTooltip]="s.storesLabel"><span class="material-symbols-outlined">storefront</span>{{ s.storeIds.length }} store{{ s.storeIds.length === 1 ? '' : 's' }}</span>
              </ng-template>
              <ng-template ceCell="assignee" let-s>
                @if (s.assigneeId === null) {
                  <span class="ops-with-icon"><span class="material-symbols-outlined">badge</span>Store managers</span>
                } @else {
                  <span class="cell-avatar"><ce-avatar [name]="s.assigneeLabel" [size]="26" /><span class="ellipsis">{{ s.assigneeLabel }}</span></span>
                }
              </ng-template>
              <ng-template ceCell="action" let-s>
                <span class="ops-row-actions">
                  @if (canEdit()) {
                    <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="generate(s)" [disabled]="generating() === s.id || !s.isActive" [matTooltip]="s.isActive ? 'Create today\\'s assignments now' : 'Activate the schedule first'" data-testid="btn-generate-schedule">
                      @if (generating() === s.id) {
                        <mat-spinner diameter="14" />
                      } @else {
                        <mat-icon>bolt</mat-icon>
                      }
                      Generate
                    </button>
                    <button type="button" class="ce-icon-btn sm" matTooltip="Edit" aria-label="Edit" (click)="edit(s)" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
                    <button type="button" class="ce-icon-btn sm" matTooltip="Delete" aria-label="Delete" (click)="remove(s)" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
                  }
                </span>
              </ng-template>
            </ce-table>
          </div>
        }
      </ce-page>
    </section>

    <ce-drawer [(open)]="open" [title]="editing() ? 'Edit schedule' : 'Schedule checklist'" subtitle="Assignments are created automatically for each store" size="lg" testId="dialog-checklist-schedule">
      @if (open()) {
        <div class="stack" style="gap: 16px">
          @if (errors().length) {
            <ce-info-banner tone="danger" title="Fix these before saving" data-testid="schedule-errors">
              @for (e of errors(); track e) {
                <div>{{ e }}</div>
              }
            </ce-info-banner>
          }
          <div class="ops-form">
            <div class="full">
              <label class="ce-field-label">Checklist *</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <mat-select [(ngModel)]="f.templateId" (ngModelChange)="touch()" placeholder="Choose a published checklist" data-testid="input-schedule-template" aria-label="Checklist">
                  @for (t of templates(); track t.id) {
                    <mat-option [value]="t.id">{{ t.name }}</mat-option>
                  } @empty {
                    <mat-option disabled>No published checklists</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              @if (fe()['template']) {
                <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ fe()['template'] }}</div>
              }
            </div>
            <div class="full">
              <label class="ce-field-label">Stores *</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <mat-select multiple [(ngModel)]="f.storeIds" (ngModelChange)="touch()" placeholder="Choose stores" data-testid="input-schedule-stores" aria-label="Stores">
                  @for (s of lookup.scopedStores(); track s.id) {
                    <mat-option [value]="s.id">{{ s.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              @if (fe()['stores']) {
                <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ fe()['stores'] }}</div>
              }
            </div>
          </div>

          <div class="ce-divider"></div>
          <h3 class="ce-fs-title" style="margin: 0">Checklist configuration</h3>
          <div class="ce-sentence">
            <span class="lead sch-l">For</span>
            <ce-segmented [options]="freqOptions" [value]="f.frequency" (valueChange)="setFrequency($any($event))" label="Frequency" data-testid="input-schedule-frequency" />
          </div>
          <div class="ce-sentence">
            <span class="lead sch-l">At</span>
            <input class="ce-inline-input wide" type="time" [(ngModel)]="f.windowStart" (ngModelChange)="touch()" aria-label="Window start" data-testid="input-schedule-window-start" />
            <span>Ends</span>
            <input class="ce-inline-input wide" type="time" [(ngModel)]="f.windowEnd" (ngModelChange)="touch()" aria-label="Window end (due)" data-testid="input-schedule-window-end" />
            <span class="caption">store time ({{ hm12(f.windowStart) }} – {{ hm12(f.windowEnd) }})</span>
          </div>
          @if (fe()['window']) {
            <div class="ops-err" style="margin-top: -10px"><span class="material-symbols-outlined">error</span>{{ fe()['window'] }}</div>
          }
          @if (f.frequency === 'WEEKLY') {
            <div class="ce-sentence">
              <span class="lead sch-l">On</span>
              <div class="day-chips" data-testid="input-schedule-days">
                @for (d of weekOrder; track d) {
                  <mat-checkbox class="day-chip" [checked]="f.daysOfWeek.includes(d)" (change)="toggleDay(d, $event.checked)" [attr.data-testid]="'day-' + d">{{ dow[d] }}</mat-checkbox>
                }
              </div>
            </div>
            @if (fe()['days']) {
              <div class="ops-err" style="margin-top: -10px"><span class="material-symbols-outlined">error</span>{{ fe()['days'] }}</div>
            }
          }
          @if (f.frequency === 'MONTHLY') {
            <div class="ce-sentence">
              <span class="lead sch-l">On day</span>
              <input class="ce-inline-input" type="number" min="1" max="31" [(ngModel)]="f.dayOfMonth" (ngModelChange)="touch()" aria-label="Day of month" data-testid="input-schedule-day-of-month" />
              <span>of the month</span>
              @if (fe()['dom']) {
                <span class="ops-err" style="margin: 0"><span class="material-symbols-outlined">error</span>{{ fe()['dom'] }}</span>
              }
            </div>
          }
          @if (f.frequency !== 'ONCE') {
            <div class="ce-sentence">
              <span class="lead sch-l">Starts from</span>
              <input class="ce-inline-input xwide" style="width: 170px" type="date" [(ngModel)]="f.startDate" (ngModelChange)="touch()" aria-label="Start date" data-testid="input-schedule-start" />
              @if (fe()['start']) {
                <span class="ops-err" style="margin: 0"><span class="material-symbols-outlined">error</span>{{ fe()['start'] }}</span>
              }
            </div>
            <div class="ce-sentence">
              <span class="lead sch-l">Repeat every</span>
              <input class="ce-inline-input" type="number" min="1" [(ngModel)]="f.repeatEvery" (ngModelChange)="touch()" aria-label="Repeat every" data-testid="input-schedule-repeat" />
              <span>{{ unit() }}</span>
              @if (fe()['repeat']) {
                <span class="ops-err" style="margin: 0"><span class="material-symbols-outlined">error</span>{{ fe()['repeat'] }}</span>
              }
            </div>
            <ce-toggle-row label="Set defined date range" helper="Stop the schedule on a set date. Off = it runs until you pause it." [checked]="dateRange()" (checkedChange)="setDateRange($event)" testId="toggle-schedule-date-range">
              <div class="ce-sentence">
                <span class="lead sch-l">Ends on</span>
                <input class="ce-inline-input xwide" style="width: 170px" type="date" [min]="f.startDate" [(ngModel)]="f.endDate" (ngModelChange)="touch()" aria-label="End date" data-testid="input-schedule-end" />
                @if (fe()['end']) {
                  <span class="ops-err" style="margin: 0"><span class="material-symbols-outlined">error</span>{{ fe()['end'] }}</span>
                }
              </div>
            </ce-toggle-row>
          } @else {
            <div class="ce-sentence">
              <span class="lead sch-l">On</span>
              <input class="ce-inline-input xwide" style="width: 170px" type="date" [(ngModel)]="f.startDate" (ngModelChange)="touch()" aria-label="Date" data-testid="input-schedule-start" />
            </div>
          }
          <div class="caption" style="font-size: 12px; color: var(--c-text-2)" data-testid="schedule-preview">{{ preview() }}</div>

          <div class="ops-accordion">
            <button type="button" class="ops-acc-head" (click)="respOpen.set(!respOpen())" [attr.aria-expanded]="respOpen()" data-testid="acc-response">
              <span>Response configuration</span><span class="line"></span><mat-icon>{{ respOpen() ? 'expand_less' : 'expand_more' }}</mat-icon>
            </button>
            @if (respOpen()) {
              <div class="ops-acc-body">
                <div>
                  <label class="ce-field-label">Assign to</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                    <mat-select [(ngModel)]="f.assigneeId" (ngModelChange)="touch()" placeholder="Each store's manager" data-testid="input-schedule-assignee" aria-label="Assignee">
                      <mat-option [value]="null">Each store's manager</mat-option>
                      @for (u of assignees(); track u.id) {
                        <mat-option [value]="u.id">{{ u.name }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                </div>
                <div class="ce-sentence">
                  <span class="lead">Remind the assignee</span>
                  <input class="ce-inline-input" type="number" min="0" [(ngModel)]="f.reminderMinutesBefore" (ngModelChange)="touch()" aria-label="Reminder minutes" data-testid="input-schedule-reminder" />
                  <span>minutes before the window ends</span>
                </div>
                @if (fe()['reminder']) {
                  <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ fe()['reminder'] }}</div>
                }
                <div class="caption">Overdue nudges go to the assignee and the store manager once the window ends.</div>
              </div>
            }
            <button type="button" class="ops-acc-head" (click)="advOpen.set(!advOpen())" [attr.aria-expanded]="advOpen()" data-testid="acc-advanced">
              <span>Advanced configuration</span><span class="line"></span><mat-icon>{{ advOpen() ? 'expand_less' : 'expand_more' }}</mat-icon>
            </button>
            @if (advOpen()) {
              <div class="ops-acc-body">
                <ce-toggle-row label="Active" helper="Paused schedules keep their settings but don't create assignments" [checked]="f.isActive" (checkedChange)="f.isActive = $event; touch()" testId="input-schedule-active" />
              </div>
            }
          </div>
        </div>
      }
      <ng-container drawerFooter>
        <button type="button" class="ce-btn ce-btn-ghost" (click)="open.set(false)" data-testid="btn-cancel">Cancel</button>
        <button type="button" class="ce-btn ce-btn-primary" (click)="save()" [disabled]="saving()" data-testid="btn-save">
          @if (saving()) {
            <mat-spinner diameter="16" />
          }
          Save schedule
        </button>
      </ng-container>
    </ce-drawer>
  `,
})
export class SchedulesPage {
  private readonly v2 = inject(V2Api);
  private readonly api = inject(ApiService);
  protected readonly lookup = inject(LookupService);
  private readonly ui = inject(UiService);
  private readonly auth = inject(AuthService);
  readonly data = loadOn(() => ({}), () => this.v2.schedules());
  readonly templates = signal<Template[]>([]);
  readonly tab = signal('all');
  readonly open = signal(false);
  readonly editing = signal<ChecklistSchedule | null>(null);
  readonly saving = signal(false);
  readonly generating = signal<number | null>(null);
  readonly errors = signal<string[]>([]);
  readonly submitted = signal(false);
  readonly dateRange = signal(false);
  readonly respOpen = signal(true);
  readonly advOpen = signal(false);
  private readonly version = signal(0);
  f: ChecklistScheduleInput = emptySchedule();

  readonly hm12 = hm12;
  readonly weekOrder = [1, 2, 3, 4, 5, 6, 0];
  readonly dow = DOW_SHORT;
  readonly freqOptions: TabItem[] = (['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY'] as ScheduleFrequency[]).map((v) => ({ value: v, label: v === 'ONCE' ? 'Once' : v.charAt(0) + v.slice(1).toLowerCase(), testId: 'frequency-' + v }));
  readonly canEdit = computed(() => this.auth.can('checklistSchedules'));
  readonly busy = computed(() => this.data.loading() && !this.data.data());
  readonly assignees = computed(() => this.lookup.users().filter((u) => u.isActive !== false));
  readonly all = computed<Row[]>(() =>
    (this.data.data() ?? []).map((s) => ({
      ...s,
      status: s.isActive ? 'ACTIVE' : 'PAUSED',
      storesLabel: s.storeIds.map((id) => this.lookup.storeName()(id)).join(', '),
      assigneeLabel: s.assigneeId === null ? "Each store's manager" : (this.lookup.users().find((u) => u.id === s.assigneeId)?.name ?? `User #${s.assigneeId}`),
      summary: scheduleSummary(s).split(' · ')[0],
    })),
  );
  readonly rows = computed(() => this.all().filter((r) => this.tab() === 'all' || (this.tab() === 'active') === r.isActive));
  readonly tabs = computed<TabItem[]>(() => {
    const d = !!this.data.data();
    return [
      { value: 'all', label: 'All', count: d ? this.all().length : null, testId: 'tab-schedules-all' },
      { value: 'active', label: 'Active', count: d ? this.count('ACTIVE') : null, testId: 'tab-schedules-active' },
      { value: 'paused', label: 'Paused', count: d ? this.count('PAUSED') : null, testId: 'tab-schedules-paused' },
    ];
  });
  readonly storesCovered = computed(() => new Set(this.all().filter((s) => s.isActive).flatMap((s) => s.storeIds)).size);
  readonly generatedToday = computed(() => {
    const today = toIsoDate(new Date());
    return this.all().filter((s) => s.lastGeneratedDate === today).length;
  });
  readonly fe = computed(() => {
    this.version();
    return this.submitted() ? scheduleFieldErrors(this.f, this.dateRange()) : {};
  });
  readonly preview = computed(() => {
    this.version();
    return occursSentence(this.f);
  });
  readonly rowId = (s: Row) => `row-checklist-schedule-${s.id}`;
  readonly cols: CeColumn<Row>[] = withMobileLabels<Row>(
    [
      { key: 'templateName', header: 'Checklist', type: 'custom', sortable: true, locked: true, searchable: true },
      { key: 'stores', header: 'Stores', type: 'custom', value: (s) => s.storeIds.length, sortable: true, searchable: false },
      { key: 'assignee', header: 'Assignee', type: 'custom', value: (s) => s.assigneeLabel, searchable: true },
      { key: 'window', header: 'Window', value: (s) => `${hm12(s.windowStart)} – ${hm12(s.windowEnd)}` },
      { key: 'period', header: 'Period', value: (s) => `${storeDate(s.startDate)} – ${s.endDate ? storeDate(s.endDate) : 'Ongoing'}` },
      { key: 'reminderMinutesBefore', header: 'Reminder', format: (v) => (Number(v) ? `${v} min before` : 'Off'), hidden: true },
      { key: 'lastGeneratedDate', header: 'Last run', format: (v) => (v ? storeDate(String(v)) : null), sortable: true },
      { key: 'status', header: 'Status', type: 'pill', sortable: true },
      { key: 'action', header: 'Action', type: 'actions', align: 'right', locked: true, value: () => '' },
    ],
    ['period', 'reminderMinutesBefore'],
  );

  constructor() {
    this.lookup.loadStores().subscribe();
    this.lookup.loadUsers();
    this.api.get<Template[]>('/checklists/templates').subscribe((t) => this.templates.set(t.filter((x) => x.isActive)));
  }

  count(s: 'ACTIVE' | 'PAUSED'): number {
    return this.all().filter((r) => r.status === s).length;
  }
  unit(): string {
    const n = Number(this.f.repeatEvery) || 1;
    return { DAILY: n === 1 ? 'day' : 'days', WEEKLY: n === 1 ? 'week' : 'weeks', MONTHLY: n === 1 ? 'month' : 'months', ONCE: '' }[this.f.frequency];
  }
  touch(): void {
    this.version.update((v) => v + 1);
  }
  setFrequency(fr: ScheduleFrequency): void {
    this.f.frequency = fr;
    if (fr === 'WEEKLY' && !this.f.daysOfWeek.length) this.f.daysOfWeek = [new Date().getDay()];
    this.touch();
  }
  setDateRange(on: boolean): void {
    this.dateRange.set(on);
    if (!on) this.f.endDate = null;
    this.touch();
  }
  toggleDay(d: number, on: boolean): void {
    this.f.daysOfWeek = on ? [...new Set([...this.f.daysOfWeek, d])] : this.f.daysOfWeek.filter((x) => x !== d);
    this.touch();
  }

  edit(s: ChecklistSchedule | null): void {
    this.editing.set(s);
    this.f = s ? { ...emptySchedule(), ...s, daysOfWeek: [...(s.daysOfWeek ?? [])], storeIds: [...s.storeIds] } : emptySchedule();
    if (!s && this.f.frequency === 'WEEKLY') this.f.daysOfWeek = [];
    this.dateRange.set(!!s?.endDate && s.frequency !== 'ONCE');
    this.errors.set([]);
    this.submitted.set(false);
    this.advOpen.set(!!s && !s.isActive);
    this.saving.set(false);
    this.touch();
    this.open.set(true);
  }

  save(): void {
    if (this.saving()) return;
    this.submitted.set(true);
    this.touch();
    const body = schedulePayload({ ...this.f, endDate: this.dateRange() ? this.f.endDate : null });
    const errs = validateSchedule({ ...body, templateId: body.templateId || null });
    const fe = scheduleFieldErrors(this.f, this.dateRange());
    if (fe['end'] && !errs.some((e) => e.startsWith('End date'))) errs.push(fe['end']);
    if (fe['dom']) errs.push(fe['dom']);
    this.errors.set(errs);
    if (errs.length) return;
    this.saving.set(true);
    const id = this.editing()?.id;
    this.v2.saveSchedule(body, id).subscribe({
      next: () => {
        this.saving.set(false);
        this.open.set(false);
        this.ui.toast(id ? 'Schedule updated' : 'Schedule created');
        this.data.reload();
      },
      error: (e: unknown) => {
        this.saving.set(false);
        // contract v4: the server's schedule validation (past end date, empty stores, …) in the drawer's error list
        this.errors.set([apiErrorText(e, 'The server rejected the schedule.')]);
      },
    });
  }

  generate(s: ChecklistSchedule): void {
    if (this.generating() !== null) return;
    this.generating.set(s.id);
    this.v2.generateSchedule(s.id).subscribe({
      next: (r) => {
        this.generating.set(null);
        this.ui.toast(`${r.created} assignment(s) created for today`);
        this.data.reload();
      },
      error: () => this.generating.set(null),
    });
  }

  remove(s: ChecklistSchedule): void {
    this.ui.confirm({ title: 'Delete schedule?', message: `Stop scheduling "${s.templateName}"? Existing assignments stay.`, confirmText: 'Delete', danger: true }).subscribe(() =>
      this.v2.deleteSchedule(s.id).subscribe(() => {
        this.ui.toast('Schedule deleted');
        this.data.reload();
      }),
    );
  }
}
