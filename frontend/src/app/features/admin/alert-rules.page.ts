import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ALERT_METRICS, AlertMetric, AlertRule, SEVERITIES } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { humanize } from '../../core/utils/format';
import { enumOptions } from '../../shared/crud/field';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { AdminField, EntityDrawerComponent } from '../../shared/ds/entity-drawer.component';
import { useOpsStyles } from '../../shared/ds/ops.styles';

/** What the threshold means for each metric (from the API contract). */
export const THRESHOLD_UNITS: Record<AlertMetric, string> = {
  QUEUE_LENGTH: 'people in queue',
  QUEUE_WAIT: 'seconds of wait',
  CAMERA_OFFLINE: 'minutes offline',
  STORE_OPEN_LATE: 'minutes late',
  STORE_CLOSE_EARLY: 'minutes early',
  FOOTFALL_DROP: '% drop vs same weekday last week',
  CONVERSION_DROP: '% drop vs same weekday last week',
  SOP_BREACH: 'events in the last 15 min',
  STAFF_SHORTAGE: 'minimum staff present',
  COUNTER_UNATTENDED: 'events in the last 15 min',
  CHECKLIST_OVERDUE: 'overdue checklists',
  CHECKLIST_NON_COMPLIANCE: 'flags in a submission',
  AI_MANAGER_BREACH: 'breaches',
  EDGE_OFFLINE: 'minutes offline',
};

/** "AI manager breach", "SOP breach" (acronyms kept). */
export function metricLabel(m: string): string {
  return humanize(m).replace(/^Ai\b/, 'AI').replace(/^Sop\b/, 'SOP');
}

const EMAILS = /^\s*[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+(\s*[,;]\s*[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+)*\s*$/;

type RuleTab = 'all' | 'active' | 'paused';

/** Admin › Alert rules: thresholds evaluated after each ingest and every minute. */
@Component({
  selector: 'ce-alert-rules-page',
  imports: [MatIconModule, MatTooltipModule, MatSlideToggleModule, ...DS, EntityDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <section data-testid="page-admin-alert-rules">
      <ce-page title="Alert rules" description="Thresholds checked after each camera update and every minute. Each rule raises at most one alert per cooldown.">
        <ng-container pageActions>
          <button type="button" class="ce-btn ce-btn-primary" (click)="openForm(null)" data-testid="btn-create-alert-rule"><mat-icon>add</mat-icon> New alert rule</button>
        </ng-container>
        <ce-stat-strip label="Alert rule summary">
          <ce-stat-tile variant="strip" id="alert-rules-total" label="Rules" [value]="all().length" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="alert-rules-active" label="Active" [value]="active()" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="alert-rules-critical" label="Critical" [value]="critical()" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="alert-rules-auto" label="Auto ticket" [value]="autoTicket()" [loading]="busy()" />
        </ce-stat-strip>
        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        } @else {
          <div class="trax-panel ops-min0">
            <ce-tabs class="ops-scroll-tabs" [tabs]="tabs()" [value]="tab()" (valueChange)="tab.set($any($event))" label="Filter rules" />
            <ce-table
              [rows]="rows()"
              [columns]="cols"
              [loading]="busy()"
              title="Rule list"
              [searchable]="true"
              searchPlaceholder="Search by rule, store or metric"
              searchTestId="input-search"
              [columnChooser]="true"
              testId="table-admin-alert-rules"
              [rowTestId]="rowId"
              [rowClass]="rowClass"
              [bare]="true"
              emptyIcon="rule"
              emptyTitle="No alert rules"
              emptyMessage="Create a rule, e.g. “Queue wait above 240 seconds at T Nagar”."
            >
              <button tableActions type="button" class="ce-btn ce-btn-secondary ce-icon-btn" (click)="data.reload()" matTooltip="Refresh" aria-label="Refresh" data-testid="btn-refresh"><mat-icon>refresh</mat-icon></button>
            <ng-template ceCell="severity" let-r><ce-pill [value]="r.severity" size="sm" /></ng-template>
              <ng-template ceCell="channels" let-r>
                <span class="ops-chips">
                  @for (c of r.channels; track c) {
                    <span class="ops-chip">{{ channelLabel(c) }}</span>
                  }
                </span>
              </ng-template>
              <ng-template ceCell="autoTicket" let-r>
                @if (r.autoTicket) {
                  <ce-pill tone="info" label="Ticket" icon="confirmation_number" size="sm" />
                } @else {
                  <span class="dash">--</span>
                }
              </ng-template>
              <ng-template ceCell="isActive" let-r>
                <span class="ops-row" style="flex-wrap: nowrap; gap: 6px">
                  <mat-slide-toggle [checked]="r.isActive" [disabled]="busyId() === r.id" (change)="toggle(r, $event.checked)" [aria-label]="'Active: ' + r.name" data-testid="toggle-alert-rule-active" />
                  <ce-pill [value]="r.isActive ? 'YES' : 'NO'" [label]="r.isActive ? 'Active' : 'Paused'" [dot]="false" size="sm" />
                </span>
              </ng-template>
              <ng-template ceCell="actions" let-r>
                <span class="ops-row-actions">
                  <button type="button" class="ce-icon-btn sm" matTooltip="Edit" aria-label="Edit rule" (click)="openForm(r)" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
                  <button type="button" class="ce-icon-btn sm" matTooltip="Delete" aria-label="Delete rule" (click)="remove(r)" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
                </span>
              </ng-template>
            </ce-table>
          </div>
        }
      </ce-page>
      <ce-entity-drawer
        [(open)]="formOpen"
        entity="alert-rule"
        [title]="editing() ? 'Edit alert rule' : 'New alert rule'"
        subtitle="If [metric] reaches [threshold] at [store], raise an alert"
        [fields]="fields"
        [value]="editing()"
        [submit]="submit"
        [submitLabel]="editing() ? 'Save changes' : 'Create rule'"
        size="lg"
        (saved)="onSaved()"
      />
    </section>
  `,
})
export class AlertRulesPage {
  protected readonly opsCss = useOpsStyles();
  private readonly lookup = inject(LookupService);
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  readonly data = loadOn(() => ({}), () => this.api.get<AlertRule[]>('/alert-rules'));
  readonly all = computed(() => this.data.data() ?? []);
  readonly busy = computed(() => this.data.loading() && !this.data.data());
  readonly active = computed(() => this.all().filter((r) => r.isActive).length);
  readonly critical = computed(() => this.all().filter((r) => r.isActive && r.severity === 'CRITICAL').length);
  readonly autoTicket = computed(() => this.all().filter((r) => r.isActive && r.autoTicket).length);
  readonly tab = signal<RuleTab>('all');
  readonly busyId = signal<number | null>(null);
  readonly formOpen = signal(false);
  readonly editing = signal<AlertRule | null>(null);
  readonly rowId = (r: AlertRule) => `row-alert-rule-${r.id}`;
  readonly rowClass = (r: AlertRule) => (r.isActive ? null : 'ops-dim');
  readonly rows = computed(() => {
    const t = this.tab();
    return [...this.all()].filter((r) => t === 'all' || (t === 'active' ? r.isActive : !r.isActive)).sort((a, b) => b.id - a.id);
  });
  readonly tabs = computed<TabItem[]>(() => [
    { value: 'all', label: 'All rules', count: this.all().length },
    { value: 'active', label: 'Active', count: this.active() },
    { value: 'paused', label: 'Paused', count: this.all().length - this.active() },
  ]);

  readonly cols: CeColumn<AlertRule>[] = [
    { key: 'name', header: 'Rule', sortable: true, locked: true, secondary: (r) => metricLabel(r.metric) },
    { key: 'store', header: 'Store', value: (r) => (r.storeId ? this.lookup.storeName()(r.storeId) : 'All stores'), sortable: true },
    { key: 'threshold', header: 'Condition', value: (r) => `≥ ${r.threshold} ${THRESHOLD_UNITS[r.metric] ?? ''}`.trim() },
    { key: 'severity', header: 'Severity', sortable: true },
    { key: 'channels', header: 'Notify', value: (r) => (r.channels ?? []).map((c) => this.channelLabel(c)).join(', ') },
    { key: 'cooldownMin', header: 'Cooldown', hidden: true, type: 'number', align: 'left', format: (v) => (typeof v === 'number' ? `${v} min` : null), sortable: true },
    { key: 'autoTicket', header: 'Auto ticket', value: (r) => (r.autoTicket ? 'Yes' : '') },
    { key: 'isActive', header: 'Status', value: (r) => (r.isActive ? 'Active' : 'Paused'), sortable: true },
    { key: 'actions', header: 'Action', type: 'actions', value: () => '', align: 'right', locked: true },
  ];

  readonly fields: AdminField[] = [
    { key: 'name', label: 'Rule name', type: 'text', required: true, full: true, placeholder: 'Queue wait above 4 minutes', group: 'Condition' },
    { key: 'metric', label: 'Metric', type: 'select', required: true, options: enumOptions(ALERT_METRICS, humanize), default: 'QUEUE_LENGTH' },
    { key: 'threshold', label: 'Threshold', type: 'number', required: true, min: 0, hint: 'people · seconds · minutes · % — per metric' },
    { key: 'storeId', label: 'Store', type: 'select', placeholder: 'All stores', options: () => this.lookup.stores().map((s) => ({ value: s.id, label: s.name })), full: true },
    { key: 'severity', label: 'Severity', type: 'select', required: true, options: enumOptions(SEVERITIES, humanize), default: 'MEDIUM', group: 'Notification' },
    { key: 'cooldownMin', label: 'Cooldown (minutes)', type: 'number', required: true, min: 0, default: 30, hint: 'Quiet period after an alert' },
    { key: 'channels', label: 'Channels', type: 'multiselect', required: true, options: [{ value: 'IN_APP', label: 'In app' }, { value: 'EMAIL', label: 'Email' }, { value: 'WEBHOOK', label: 'Webhook' }], default: ['IN_APP'], full: true },
    {
      key: 'emails',
      label: 'Emails',
      type: 'text',
      full: true,
      placeholder: 'ops@congruence.in, area.manager@congruence.in',
      visible: (v) => ((v['channels'] as string[]) ?? []).includes('EMAIL'),
      validate: (v) => (!String(v ?? '').trim() ? 'Enter at least one email address' : EMAILS.test(String(v)) ? null : 'Separate valid email addresses with commas'),
    },
    {
      key: 'webhookUrl',
      label: 'Webhook URL',
      type: 'text',
      full: true,
      placeholder: 'https://hooks.example.com/alerts',
      visible: (v) => ((v['channels'] as string[]) ?? []).includes('WEBHOOK'),
      validate: (v) => (/^https?:\/\/\S+$/.test(String(v ?? '').trim()) ? null : 'Enter a full http(s) URL'),
    },
    { key: 'autoTicket', label: 'Automatically open a ticket for each alert', type: 'checkbox', default: false, helper: 'Camera offline → Camera ticket, AI box offline → Network ticket' },
    { key: 'isActive', label: 'Active', type: 'checkbox', default: true },
  ];

  readonly submit = (v: Record<string, unknown>) => {
    const r = this.editing();
    return r ? this.api.patch(`/alert-rules/${r.id}`, v, silent()) : this.api.post('/alert-rules', v, null, silent());
  };

  constructor() {
    this.lookup.loadStores().subscribe();
  }

  channelLabel(c: string): string {
    return c === 'IN_APP' ? 'In app' : humanize(c);
  }

  openForm(r: AlertRule | null): void {
    this.editing.set(r);
    this.formOpen.set(true);
  }

  onSaved(): void {
    this.ui.toast(this.editing() ? 'Saved' : 'Created');
    this.data.reload();
  }

  toggle(r: AlertRule, isActive: boolean): void {
    this.busyId.set(r.id);
    this.api.patch(`/alert-rules/${r.id}`, { isActive }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.ui.toast(isActive ? 'Rule activated' : 'Rule paused');
        this.data.reload();
      },
      error: () => {
        this.busyId.set(null);
        this.data.reload();
      },
    });
  }

  remove(r: AlertRule): void {
    this.ui.confirm({ title: 'Delete alert rule?', message: `Delete "${r.name}"? Alerts it already raised are kept.`, confirmText: 'Delete', danger: true }).subscribe(() =>
      this.api.delete(`/alert-rules/${r.id}`).subscribe(() => {
        this.ui.toast('Deleted');
        this.data.reload();
      }),
    );
  }
}
