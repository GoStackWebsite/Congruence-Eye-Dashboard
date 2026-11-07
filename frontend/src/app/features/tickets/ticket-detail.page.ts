import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Ticket, TicketComment, TicketStatus } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { humanize } from '../../core/utils/format';
import { apiErrorText, httpStatus } from '../../core/utils/http-errors';
import { DS } from '../../shared/ds';
import { EntityDrawerComponent } from '../../shared/ds/entity-drawer.component';
import { relativeTime } from '../../shared/pipes';
import { UiService } from '../../shared/ui/ui.service';
import { TICKET_CATEGORY_ICON, slaInfo, storeDateTime } from '../checklists/_ui/ops';
import { LIST_STYLES, OpsServiceStyles } from '../checklists/_ui/styles';
import { isSlaBreached, ticketFields } from './tickets.page';

/** Ticket status workflow: allowed next states. */
export const TICKET_FLOW: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'OPEN'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['IN_PROGRESS', 'RESOLVED'],
};

/** Button label + icon for a workflow move. */
export const FLOW_ACTION: Record<TicketStatus, { label: string; icon: string; primary?: boolean }> = {
  OPEN: { label: 'Back to open', icon: 'undo' },
  IN_PROGRESS: { label: 'Start progress', icon: 'play_arrow', primary: true },
  RESOLVED: { label: 'Resolve', icon: 'task_alt', primary: true },
  CLOSED: { label: 'Close', icon: 'lock' },
  REOPENED: { label: 'Reopen', icon: 'replay' },
};

/** Store Ops › Ticket: conversation thread on the left, properties + SLA + status workflow on the right. */
@Component({
  selector: 'ce-ticket-detail-page',
  imports: [FormsModule, RouterLink, MatIconModule, MatProgressSpinnerModule, ...DS, ...LIST_STYLES, OpsServiceStyles, EntityDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles /><ce-ops-service-styles />
    <section class="ops-page" data-testid="page-ticket-detail">
      @if (data.data(); as t) {
        <ce-page [title]="t.number + ' · ' + t.title" [description]="t.storeName + ' · ' + label(t.category) + ' · reported by ' + t.reporterName">
          <ng-container pageActions>
            <a class="ce-btn ce-btn-secondary" routerLink="/tickets" data-testid="btn-back"><mat-icon>arrow_back</mat-icon> Tickets</a>
            @if (canManage()) {
              <button type="button" class="ce-btn ce-btn-secondary" (click)="edit(t)" data-testid="btn-edit-ticket"><mat-icon>edit</mat-icon> Edit</button>
            }
          </ng-container>
          <div class="tk-layout">
            <div class="ops-card tk-thread">
              <div class="tk-msg origin">
                <ce-avatar [name]="t.reporterName" [size]="32" />
                <div class="bd">
                  <div class="who"><span class="n">{{ t.reporterName }}</span><span class="tag">Reporter</span><span class="t" [title]="dt(t.createdAt)">opened {{ rel(t.createdAt) }}</span></div>
                  <div class="tx" data-testid="ticket-description">{{ t.description || 'No description' }}</div>
                  @if (t.alertId) {
                    <div class="caption" style="margin-top: 6px"><a [routerLink]="['/alerts', t.alertId]">Raised from alert #{{ t.alertId }}</a></div>
                  }
                </div>
              </div>
              <div data-testid="ticket-comments">
                @for (c of t.comments ?? []; track c.id) {
                  <div class="tk-msg" [attr.data-testid]="'comment-' + c.id">
                    <ce-avatar [name]="c.userName" [size]="32" />
                    <div class="bd">
                      <div class="who">
                        <span class="n">{{ c.userName }}</span>
                        @if (c.userId === t.assigneeId) {
                          <span class="tag">Assignee</span>
                        }
                        <span class="t" [title]="dt(c.createdAt)">{{ rel(c.createdAt) }}</span>
                      </div>
                      <div class="tx">{{ c.body }}</div>
                    </div>
                  </div>
                } @empty {
                  <div class="tk-msg event"><span class="material-symbols-outlined">forum</span>No replies yet — add the first update below.</div>
                }
              </div>
              @if (t.resolvedAt) {
                <div class="tk-msg event"><span class="material-symbols-outlined">task_alt</span>Resolved {{ dt(t.resolvedAt) }}</div>
              }
              @if (t.status === 'CLOSED') {
                <div class="tk-msg event" data-testid="comment-closed"><span class="material-symbols-outlined">lock</span>{{ commentError() ?? 'This ticket is closed. Reopen it to add an update.' }}</div>
              } @else {
              <div class="tk-compose">
                <label class="ce-field-label" for="tk-comment" style="margin: 0">Add an update</label>
                <textarea id="tk-comment" [ngModel]="comment()" (ngModelChange)="comment.set($event)" maxlength="4000" placeholder="Share progress, ask a question or note what was done…" (keydown.control.enter)="addComment()" (keydown.meta.enter)="addComment()" data-testid="input-comment"></textarea>
                <div class="bar">
                  <span class="caption">Ctrl + Enter to post · visible to everyone on this ticket</span>
                  <button type="button" class="ce-btn ce-btn-primary" (click)="addComment()" [disabled]="!comment().trim() || posting()" data-testid="btn-add-comment">
                    @if (posting()) {
                      <mat-spinner diameter="16" />
                    } @else {
                      <mat-icon>send</mat-icon>
                    }
                    Post
                  </button>
                </div>
                @if (commentError()) {
                  <div role="alert" style="color: var(--c-danger-text); font-size: 13px" data-testid="comment-error">{{ commentError() }}</div>
                }
              </div>
              }
            </div>

            <aside class="tk-side">
              <ce-card title="Status">
                <div class="stack" style="gap: 14px">
                  <div class="row" style="gap: 8px; flex-wrap: wrap">
                    <ce-pill [value]="t.status" data-testid="ticket-status" />
                    <ce-pill [value]="t.priority" />
                  </div>
                  @let s = sla();
                  <div>
                    <div class="ops-section-label" style="margin-bottom: 6px">SLA</div>
                    @if (breached()) {
                      <div class="row" style="gap: 8px"><ce-pill tone="critical" label="Breached" icon="timer_off" data-testid="sla-breached" /><span class="caption">{{ s.label }}</span></div>
                    } @else if (s.state === 'none') {
                      <span class="caption">No SLA</span>
                    } @else {
                      <span class="tk-sla" [class]="'tk-sla ' + s.state" style="width: 100%">
                        <span class="lbl"><span class="material-symbols-outlined">{{ s.state === 'met' ? 'task_alt' : 'timer' }}</span>{{ s.label }} · due {{ dt(t.slaDueAt) }}</span>
                        @if (s.state !== 'met') {
                          <span class="bar"><span [style.width.%]="s.usedPct"></span></span>
                        }
                      </span>
                    }
                  </div>
                  @if (canChangeStatus()) {
                    <div>
                      <div class="ops-section-label" style="margin-bottom: 8px">Move to</div>
                      <div class="tk-flow" data-testid="ticket-status-actions">
                        @for (n of nextStatuses(); track n) {
                          <button type="button" class="ce-btn" [class.ce-btn-primary]="flow[n].primary" [class.ce-btn-secondary]="!flow[n].primary" (click)="setStatus(n)" [disabled]="moving()" [attr.data-testid]="'btn-status-' + n">
                            <mat-icon>{{ flow[n].icon }}</mat-icon> {{ flow[n].label }}
                          </button>
                        }
                      </div>
                    </div>
                  } @else {
                    <p class="caption" style="margin: 0">Only the assignee or a manager can change the status.</p>
                  }
                </div>
              </ce-card>
              <ce-card title="Properties">
                <dl class="ops-kv">
                  <dt>Category</dt>
                  <dd><span class="ops-with-icon"><span class="material-symbols-outlined">{{ catIcon[t.category] || 'help' }}</span>{{ label(t.category) }}</span></dd>
                  <dt>Store</dt>
                  <dd class="ellipsis" [title]="t.storeName">{{ t.storeName }}</dd>
                  <dt>Assignee</dt>
                  <dd>
                    @if (t.assigneeName) {
                      <span class="cell-avatar" style="display: inline-flex; gap: 8px; align-items: center"><ce-avatar [name]="t.assigneeName" [size]="22" /><span class="ellipsis">{{ t.assigneeName }}</span></span>
                    } @else {
                      <span class="muted">Unassigned</span>
                    }
                  </dd>
                  <dt>Reporter</dt>
                  <dd class="ellipsis">{{ t.reporterName }}</dd>
                  <dt>Opened</dt>
                  <dd>{{ dt(t.createdAt) }}</dd>
                  <dt>SLA due</dt>
                  <dd [class.bad-text]="breached()">{{ dt(t.slaDueAt) }}</dd>
                  @if (t.resolvedAt) {
                    <dt>Resolved</dt>
                    <dd>{{ dt(t.resolvedAt) }}</dd>
                  }
                </dl>
              </ce-card>
            </aside>
          </div>
        </ce-page>
        <ce-entity-drawer
          [(open)]="editOpen"
          entity="ticket"
          title="Edit ticket"
          [subtitle]="t.number"
          [fields]="editFields"
          [value]="editValue()"
          [submit]="submitEdit"
          (saved)="onEdited()"
        />
      } @else if (data.error()) {
        <div class="ops-card">
          <ce-empty-state [kind]="forbidden() ? 'no-permission' : 'error'" [title]="notFound() ? 'Ticket not found' : null" [message]="notFound() ? 'It may have been deleted.' : data.error()">
            @if (!notFound() && !forbidden()) {
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            }
            <a class="ce-btn ce-btn-ghost ce-btn-sm" routerLink="/tickets">Back to tickets</a>
          </ce-empty-state>
        </div>
      } @else {
        <div class="tk-layout"><ce-skeleton kind="chart" height="360px" /><ce-skeleton kind="text" [count]="8" /></div>
      }
    </section>
  `,
})
export class TicketDetailPage {
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly auth = inject(AuthService);
  private readonly lookup = inject(LookupService);
  readonly id = input.required<string>();
  readonly data = loadOn(() => this.id(), (id) => this.api.get<Ticket>(`/tickets/${id}`, null, silent()));
  readonly comment = signal('');
  readonly posting = signal(false);
  readonly moving = signal(false);
  readonly now = signal(Date.now());
  readonly flow = FLOW_ACTION;
  readonly catIcon = TICKET_CATEGORY_ICON;

  readonly canManage = computed(() => this.auth.can('manageTickets'));
  readonly canChangeStatus = computed(() => this.canManage() || this.data.data()?.assigneeId === this.auth.user()?.id);
  readonly nextStatuses = computed(() => TICKET_FLOW[this.data.data()?.status ?? 'OPEN'] ?? []);
  readonly breached = computed(() => (this.data.data() ? isSlaBreached(this.data.data()!, this.now()) : false));
  readonly sla = computed(() => {
    const t = this.data.data();
    return t ? slaInfo(t, this.now()) : { state: 'none' as const, label: '', usedPct: 0 };
  });
  readonly notFound = computed(() => /not found/i.test(this.data.error() ?? ''));
  readonly forbidden = computed(() => /forbidden|permission|access|scope/i.test(this.data.error() ?? ''));

  constructor() {
    this.lookup.loadStores().subscribe();
    if (this.auth.can('manageTickets')) this.lookup.loadUsers();
    const h = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(h));
  }

  label(v: string): string {
    return humanize(v);
  }
  dt(iso: string | null): string {
    return storeDateTime(iso);
  }
  rel(iso: string): string {
    return relativeTime(new Date(iso), this.now());
  }

  setStatus(status: TicketStatus): void {
    if (this.moving()) return;
    this.moving.set(true);
    this.api.patch<Ticket>(`/tickets/${this.id()}/status`, { status }).subscribe({
      next: () => {
        this.moving.set(false);
        this.ui.toast(`Ticket moved to ${status.replace('_', ' ').toLowerCase()}`);
        this.data.reload();
      },
      error: () => this.moving.set(false),
    });
  }

  readonly commentError = signal<string | null>(null);

  addComment(): void {
    const body = this.comment().trim();
    if (!body || this.posting()) return;
    this.posting.set(true);
    this.commentError.set(null);
    this.api.post<TicketComment>(`/tickets/${this.id()}/comments`, { body }, null, silent()).subscribe({
      next: () => {
        this.posting.set(false);
        this.comment.set('');
        this.data.reload();
      },
      error: (e: unknown) => {
        this.posting.set(false);
        // 409: closed meanwhile (contract v4) — keep the text, say why, and refresh so the Reopen action shows
        this.commentError.set(httpStatus(e) === 409 ? 'This ticket was closed while you were writing. Reopen it to post your update (your text is kept).' : apiErrorText(e, 'Could not post the update.'));
        if (httpStatus(e) === 409) this.data.reload();
      },
    });
  }

  readonly editOpen = signal(false);
  readonly editValue = signal<Record<string, unknown> | null>(null);
  readonly editFields = ticketFields(this.lookup);
  private editId = 0;
  readonly submitEdit = (v: Record<string, unknown>) => this.api.patch(`/tickets/${this.editId}`, v, silent());

  edit(t: Ticket): void {
    this.editId = t.id;
    this.editValue.set({ ...t });
    this.editOpen.set(true);
  }

  onEdited(): void {
    this.ui.toast('Ticket updated');
    this.data.reload();
  }
}
