import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { PRIORITIES, TICKET_CATEGORIES, TICKET_STATUSES, Ticket } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { humanize } from '../../core/utils/format';
import { FieldDef, enumOptions } from '../../shared/crud/field';
import { relativeTime } from '../../shared/pipes';
import { CeColumn, DS } from '../../shared/ds';
import { EntityDrawerComponent } from '../../shared/ds/entity-drawer.component';
import { UiService } from '../../shared/ui/ui.service';
import { TICKET_CATEGORY_ICON, slaInfo, storeDateTime, withMobileLabels } from '../checklists/_ui/ops';
import { LIST_STYLES, OpsServiceStyles } from '../checklists/_ui/styles';

export const SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 168 };

/** Breached if backend says so, or if still open past slaDueAt. */
export function isSlaBreached(t: Pick<Ticket, 'isSlaBreached' | 'slaDueAt' | 'status' | 'resolvedAt'>, now = Date.now()): boolean {
  if (t.isSlaBreached) return true;
  if (!t.slaDueAt) return false;
  const due = new Date(t.slaDueAt).getTime();
  const end = t.resolvedAt ? new Date(t.resolvedAt).getTime() : t.status === 'RESOLVED' || t.status === 'CLOSED' ? due : now;
  return end > due;
}

export function ticketFields(lookup: LookupService): FieldDef[] {
  return [
    { key: 'title', label: 'Title', type: 'text', required: true, full: true, maxLength: 200, placeholder: 'e.g. Billing counter 2 POS terminal down' },
    { key: 'description', label: 'Description', type: 'textarea', maxLength: 4000, placeholder: 'What happened, where, since when' },
    { key: 'storeId', label: 'Store', type: 'select', required: true, options: () => lookup.scopedStores().map((s) => ({ value: s.id, label: s.name })) },
    { key: 'category', label: 'Category', type: 'select', required: true, options: enumOptions(TICKET_CATEGORIES, humanize), default: 'OTHER' },
    { key: 'priority', label: 'Priority', type: 'select', required: true, options: enumOptions(PRIORITIES, humanize), default: 'MEDIUM', hint: 'SLA: Urgent 4h · High 24h · Medium 72h · Low 7d' },
    { key: 'assigneeId', label: 'Assignee', type: 'select', options: (v) => lookup.usersForStore(v['storeId'] as number).map((u) => ({ value: u.id, label: u.name })) },
  ];
}

const OPEN_STATES = ['OPEN', 'IN_PROGRESS', 'REOPENED'];

/** Store Ops › Tickets: planogram, infrastructure, camera and network issues with an SLA countdown per ticket. */
@Component({
  selector: 'ce-tickets-page',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule, MatIconModule, MatTooltipModule, ...DS, ...LIST_STYLES, OpsServiceStyles, EntityDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles /><ce-ops-service-styles />
    <section class="ops-page" data-testid="page-tickets">
      <ce-page title="Tickets" description="Planogram, infrastructure, camera and network issues — tracked against their SLA">
        <ng-container pageActions>
          <button type="button" class="ce-btn ce-btn-primary" (click)="create()" data-testid="btn-create-ticket"><mat-icon>add</mat-icon> New ticket</button>
        </ng-container>

        <ce-stat-strip label="Ticket summary">
          <ce-stat-tile variant="strip" id="tickets-open" label="Open" [value]="openCount()" [loading]="busy()" hint="Open, in progress and reopened" />
          <ce-stat-tile variant="strip" id="tickets-breached" label="SLA breached" [value]="breachedCount()" [loading]="busy()" hint="Open tickets past their SLA, or resolved late" />
          <ce-stat-tile variant="strip" id="tickets-risk" label="At risk" [value]="riskCount()" [loading]="busy()" hint="Open tickets that used 75% or more of their SLA" />
          <span class="ce-stat-strip-sep" aria-hidden="true"></span>
          <ce-stat-tile variant="strip" id="tickets-urgent" label="Urgent open" [value]="urgentCount()" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="tickets-resolved" label="Resolved / closed" [value]="resolvedCount()" [loading]="busy()" />
        </ce-stat-strip>

        @if (data.error() && !data.data()) {
          <div class="ops-card">
            <ce-empty-state kind="error" [message]="data.error()"><button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button></ce-empty-state>
          </div>
        } @else {
          <div class="ops-card">
            <ce-table
              [rows]="rows()"
              [columns]="cols"
              [loading]="busy()"
              title="Ticket info"
              [searchable]="true"
              searchPlaceholder="Search number, title, store or person"
              searchTestId="input-search"
              testId="table-tickets"
              [rowTestId]="rowId"
              [rowClickable]="true"
              (rowClick)="open($event)"
              [bare]="true"
              [pageSize]="100"
              [defaultSort]="{ key: 'createdAt', dir: 'desc' }"
              emptyIcon="confirmation_number"
              [emptyTitle]="filtered() ? 'No tickets match these filters' : 'No tickets yet'"
              [emptyMessage]="filtered() ? 'Clear the filters to see every ticket.' : 'Raise a ticket when something in the store needs fixing.'"
            >
              <div tableFilters class="ops-toolbar" style="margin-top: 8px">
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="ops-filter">
                  <mat-select [ngModel]="status()" (ngModelChange)="status.set($event)" placeholder="All statuses" data-testid="filter-ticket-status" aria-label="Status">
                    <mat-option [value]="null">All statuses</mat-option>
                    @for (s of statuses; track s) {
                      <mat-option [value]="s">{{ label(s) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="ops-filter">
                  <mat-select [ngModel]="category()" (ngModelChange)="category.set($event)" placeholder="All categories" data-testid="filter-ticket-category" aria-label="Category">
                    <mat-option [value]="null">All categories</mat-option>
                    @for (c of categories; track c) {
                      <mat-option [value]="c"><span class="material-symbols-outlined opt-icon">{{ catIcon[c] }}</span>{{ label(c) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="ops-filter">
                  <mat-select [ngModel]="priority()" (ngModelChange)="priority.set($event)" placeholder="All priorities" data-testid="filter-ticket-priority" aria-label="Priority">
                    <mat-option [value]="null">All priorities</mat-option>
                    @for (p of priorities; track p) {
                      <mat-option [value]="p">{{ label(p) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                @if (filtered()) {
                  <button type="button" class="ce-link-btn" (click)="clearFilters()" data-testid="btn-clear-filters">Clear filters</button>
                }
              </div>
              <ng-template ceCell="title" let-t>
                <span class="ops-with-icon" style="max-width: 420px">
                  <span class="ops-icon-tile sm" [matTooltip]="label(t.category)"><span class="material-symbols-outlined">{{ catIcon[t.category] || 'help' }}</span></span>
                  <span class="ops-cell-title" [title]="t.number + ' · ' + t.title">
                    <span class="t">{{ t.title }}</span>
                    <span class="s"><span class="mono">{{ t.number }}</span> · {{ t.storeName }}</span>
                  </span>
                </span>
              </ng-template>
              <ng-template ceCell="priority" let-t>
                <ce-pill [value]="t.priority" data-testid="chip-priority" />
              </ng-template>
              <ng-template ceCell="status" let-t>
                <ce-pill [value]="t.status" data-testid="chip-status" />
              </ng-template>
              <ng-template ceCell="assigneeName" let-t>
                @if (t.assigneeName) {
                  <span class="cell-avatar"><ce-avatar [name]="t.assigneeName" [size]="26" /><span class="ellipsis">{{ t.assigneeName }}</span></span>
                } @else {
                  <span class="dash">Unassigned</span>
                }
              </ng-template>
              <ng-template ceCell="sla" let-t>
                @let s = sla(t);
                @if (s.state === 'breached') {
                  <span class="stack" style="gap: 2px; align-items: flex-start">
                    <ce-pill tone="critical" label="Breached" icon="timer_off" size="sm" data-testid="sla-breached" />
                    <span class="caption">{{ s.label }}</span>
                  </span>
                } @else if (s.state === 'none') {
                  <span class="dash">--</span>
                } @else {
                  <span class="tk-sla" [class]="'tk-sla ' + s.state" [title]="'SLA due ' + dt(t.slaDueAt)">
                    <span class="lbl"><span class="material-symbols-outlined">{{ s.state === 'met' ? 'task_alt' : 'timer' }}</span>{{ s.label }}</span>
                    @if (s.state !== 'met') {
                      <span class="bar"><span [style.width.%]="s.usedPct"></span></span>
                    }
                  </span>
                }
              </ng-template>
            </ce-table>
          </div>
        }
      </ce-page>
      <ce-entity-drawer
        [(open)]="formOpen"
        entity="ticket"
        title="New ticket"
        subtitle="Raised against the store's SLA (Urgent 4 h · High 24 h · Medium 72 h · Low 7 d)"
        [fields]="formFields()"
        [value]="formValue()"
        [submit]="submitTicket"
        submitLabel="Create ticket"
        (saved)="onCreated($any($event))"
      />
    </section>
  `,
})
export class TicketsPage {
  protected readonly auth = inject(AuthService);
  private readonly lookup = inject(LookupService);
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);
  readonly statuses = TICKET_STATUSES;
  readonly categories = TICKET_CATEGORIES;
  readonly priorities = PRIORITIES;
  readonly catIcon = TICKET_CATEGORY_ICON;
  readonly status = signal<string | null>(null);
  readonly category = signal<string | null>(null);
  readonly priority = signal<string | null>(null);
  /** Ticks every minute so SLA countdowns stay current. */
  readonly now = signal(Date.now());

  readonly data = loadOn(
    () => ({ status: this.status(), category: this.category(), priority: this.priority() }),
    (q) => this.api.get<Ticket[]>('/tickets', q),
  );
  readonly busy = computed(() => this.data.loading() && !this.data.data());
  readonly rows = computed(() => this.data.data() ?? []);
  readonly filtered = computed(() => !!this.status() || !!this.category() || !!this.priority());
  readonly openCount = computed(() => (this.data.data() ? this.rows().filter((t) => OPEN_STATES.includes(t.status)).length : undefined));
  readonly breachedCount = computed(() => (this.data.data() ? this.rows().filter((t) => isSlaBreached(t, this.now())).length : undefined));
  readonly riskCount = computed(() => (this.data.data() ? this.rows().filter((t) => slaInfo(t, this.now()).state === 'at-risk').length : undefined));
  readonly urgentCount = computed(() => (this.data.data() ? this.rows().filter((t) => t.priority === 'URGENT' && OPEN_STATES.includes(t.status)).length : undefined));
  readonly resolvedCount = computed(() => (this.data.data() ? this.rows().filter((t) => !OPEN_STATES.includes(t.status)).length : undefined));
  readonly rowId = (t: Ticket) => `row-ticket-${t.id}`;
  readonly cols: CeColumn<Ticket>[] = withMobileLabels<Ticket>(
    [
      { key: 'title', header: 'Ticket', type: 'custom', sortable: true, locked: true, searchable: true, value: (t) => `${t.number} ${t.title} ${t.storeName}` },
      { key: 'priority', header: 'Priority', type: 'custom', sortable: true, value: (t) => ({ URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 })[t.priority] },
      { key: 'status', header: 'Status', type: 'custom', sortable: true, value: (t) => t.status, searchable: true },
      { key: 'assigneeName', header: 'Assignee', type: 'custom', sortable: true, searchable: true },
      { key: 'sla', header: 'SLA', type: 'custom', sortable: true, value: (t) => t.slaDueAt },
      { key: 'reporterName', header: 'Reported by', sortable: true, hidden: true },
      { key: 'createdAt', header: 'Opened', sortable: true, format: (v) => relativeTime(new Date(String(v)), this.now()), searchable: false },
    ],
    ['assigneeName'],
  );

  constructor() {
    this.lookup.loadStores().subscribe();
    this.lookup.loadUsers();
    const h = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(h));
  }

  label(v: string): string {
    return humanize(v);
  }
  sla(t: Ticket) {
    return slaInfo(t, this.now());
  }
  dt(iso: string | null): string {
    return storeDateTime(iso);
  }
  clearFilters(): void {
    this.status.set(null);
    this.category.set(null);
    this.priority.set(null);
  }

  open(t: Ticket): void {
    void this.router.navigate(['/tickets', t.id]);
  }

  readonly formOpen = signal(false);
  readonly formFields = computed(() => ticketFields(this.lookup).filter((f) => f.key !== 'assigneeId' || this.auth.can('manageTickets')));
  readonly formValue = signal<Record<string, unknown> | null>(null);
  readonly submitTicket = (v: Record<string, unknown>) => this.api.post<Ticket>('/tickets', v, null, silent());

  create(): void {
    this.formValue.set({ storeId: this.lookup.scopedStores()[0]?.id ?? null });
    this.formOpen.set(true);
  }

  onCreated(t: Ticket | null): void {
    this.ui.toast(`Ticket ${t?.number ?? ''} created`);
    this.data.reload();
  }
}
