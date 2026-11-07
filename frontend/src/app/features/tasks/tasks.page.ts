import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelect, MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth/auth.service';
import { PRIORITIES, TASK_STATUSES, Task, TaskStatus } from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { humanize } from '../../core/utils/format';
import { safeStorage } from '../../core/utils/storage';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { dueInfo, opsLabel, storeDate, storeDateTime, withMobileLabels } from '../checklists/_ui/ops';
import { LIST_STYLES, OpsTasksStyles } from '../checklists/_ui/styles';
import { CompleteTaskDialog, CompleteTaskResult } from './complete-task.dialog';
import { TASK_TYPE_ICON, TaskFormDrawer } from './task-form.drawer';

/** Which status moves are allowed from the board (VERIFIED only via the verify action, by managers). */
export function canMoveTask(from: TaskStatus, to: TaskStatus, canVerify: boolean): boolean {
  if (from === to) return false;
  if (from === 'VERIFIED') return false;
  if (to === 'VERIFIED') return canVerify && from === 'DONE';
  return true;
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const FINISHED: TaskStatus[] = ['DONE', 'VERIFIED', 'CANCELLED'];

export function isTaskOverdue(t: Pick<Task, 'dueAt' | 'status'>, now = Date.now()): boolean {
  return !!t.dueAt && !FINISHED.includes(t.status) && new Date(t.dueAt).getTime() < now;
}

/** Board columns: priority first, then the earliest due. */
export function groupTasks(list: Task[]): Record<TaskStatus, Task[]> {
  const out = Object.fromEntries(TASK_STATUSES.map((s) => [s, [] as Task[]])) as Record<TaskStatus, Task[]>;
  for (const t of list) (out[t.status] ?? out.TODO).push(t);
  for (const k of TASK_STATUSES) out[k].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
  return out;
}

/**
 * Tasks (reference 07): Task info table — name, created by, created on, priority, assigned to, due on, status — or a
 * kanban board (drag between columns); create / bulk-create side panels; task detail panel with a timeline, proof and
 * verify. Staff see "My tasks".
 */
@Component({
  selector: 'ce-tasks-page',
  imports: [FormsModule, DragDropModule, MatFormFieldModule, MatSelectModule, MatIconModule, MatMenuModule, MatTooltipModule, ...DS, ...LIST_STYLES, OpsTasksStyles, TaskFormDrawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles /><ce-ops-tasks-styles />
    <section class="ops-page" data-testid="page-tasks">
      <ce-page [title]="isStaff() ? 'My tasks' : 'Tasks'" [description]="isStaff() ? 'Your store tasks — drag a card or change its status when you start and finish' : 'Assign, prioritise, track and verify store tasks'">
        <ng-container pageActions>
          <ce-segmented [options]="viewOptions" [value]="view()" (valueChange)="setView($any($event))" label="View" data-testid="toggle-task-view" />
          @if (auth.can('createTasks')) {
            <button type="button" class="ce-btn ce-btn-secondary" (click)="openBulk()" data-testid="btn-bulk-tasks"><mat-icon>library_add</mat-icon> <span class="ops-hide-xs">Bulk create</span></button>
            <button type="button" class="ce-btn ce-btn-primary" (click)="openForm(null)" data-testid="btn-create-task"><mat-icon>add_task</mat-icon> New task</button>
          }
        </ng-container>

        <ce-stat-strip label="Task summary">
          <ce-stat-tile variant="strip" id="tasks-todo" label="To do" [value]="count('TODO')" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="tasks-progress" label="In progress" [value]="count('IN_PROGRESS')" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="tasks-overdue" label="Overdue" [value]="overdue()" [loading]="busy()" hint="Open tasks past their due time" />
          <span class="ce-stat-strip-sep" aria-hidden="true"></span>
          <ce-stat-tile variant="strip" id="tasks-done" label="Awaiting verification" [value]="count('DONE')" [loading]="busy()" hint="Marked done; a manager still has to verify" />
          <ce-stat-tile variant="strip" id="tasks-verified" label="Verified" [value]="count('VERIFIED')" [loading]="busy()" />
        </ce-stat-strip>

        <div class="ops-toolbar">
          <label class="ce-search">
            <mat-icon aria-hidden="true">search</mat-icon>
            <input type="search" placeholder="Search tasks, stores or people" [ngModel]="search()" (ngModelChange)="search.set($event)" aria-label="Search tasks" data-testid="input-search" />
          </label>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="ops-filter wide">
            <mat-select [ngModel]="storeId()" (ngModelChange)="storeId.set($event)" placeholder="All stores" data-testid="filter-task-store" aria-label="Store">
              <mat-option [value]="null">All stores</mat-option>
              @for (s of lookup.scopedStores(); track s.id) {
                <mat-option [value]="s.id">{{ s.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="ops-filter">
            <mat-select [ngModel]="priority()" (ngModelChange)="priority.set($event)" placeholder="All priorities" data-testid="filter-task-priority" aria-label="Priority">
              <mat-option [value]="null">All priorities</mat-option>
              @for (p of priorities; track p) {
                <mat-option [value]="p">{{ label(p) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          @if (!isStaff()) {
            <ce-segmented [options]="mineOptions" [value]="mine() ? 'mine' : 'all'" (valueChange)="mine.set($event === 'mine')" label="Scope" data-testid="toggle-mine" />
          }
          @if (filtered()) {
            <button type="button" class="ce-link-btn" (click)="clearFilters()" data-testid="btn-clear-filters">Clear filters</button>
          }
          <span class="spacer"></span>
          <span class="caption">{{ rows().length }} task{{ rows().length === 1 ? '' : 's' }}</span>
        </div>

        @if (data.error() && !data.data()) {
          <div class="ops-card">
            <ce-empty-state kind="error" [message]="data.error()"><button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button></ce-empty-state>
          </div>
        } @else if (view() === 'board') {
          @if (busy()) {
            <div class="kb-board" aria-busy="true">
              @for (c of columns; track c) {
                <div class="kb-col"><ce-skeleton kind="text" [count]="4" /></div>
              }
            </div>
          } @else {
            @if (!rows().length && data.data()?.length && filtered()) {
              <ce-info-banner tone="info" title="No tasks match these filters">
                <button type="button" class="ce-link-btn" (click)="clearFilters()">Clear filters</button>
              </ce-info-banner>
            }
            <div class="kb-board" cdkDropListGroup data-testid="task-board">
              @for (col of columns; track col) {
                <div class="kb-col" [attr.data-testid]="'task-column-' + col">
                  <div class="kb-head">
                    <ce-pill [value]="col" [label]="label(col)" />
                    <span class="ct">{{ byStatus()[col].length }}</span>
                  </div>
                  <div class="kanban-list" cdkDropList [cdkDropListData]="col" (cdkDropListDropped)="drop($event)" [id]="'col-' + col">
                    @for (t of byStatus()[col]; track t.id) {
                      <div class="kb-card" cdkDrag [cdkDragData]="t" [cdkDragDisabled]="t.status === 'VERIFIED'" [attr.data-testid]="'task-card-' + t.id">
                        <div class="top">
                          <span class="title" (click)="openDetail(t)" [title]="t.title" role="button" tabindex="0" (keydown.enter)="openDetail(t)">{{ t.title }}</span>
                          <button type="button" class="ce-icon-btn sm" [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()" aria-label="Task actions" data-testid="btn-task-menu" style="margin: -6px -6px 0 0"><mat-icon>more_vert</mat-icon></button>
                          <mat-menu #menu="matMenu" xPosition="before">
                            <button mat-menu-item (click)="openDetail(t)" data-testid="btn-view-task"><mat-icon>visibility</mat-icon> View details</button>
                            @for (s of nextStatuses(t); track s) {
                              <button mat-menu-item (click)="setStatus(t, s)" [attr.data-testid]="'btn-move-' + s"><mat-icon>arrow_forward</mat-icon> Move to {{ label(s) }}</button>
                            }
                            @if (t.status === 'DONE' && auth.can('verifyTasks')) {
                              <button mat-menu-item (click)="verify(t)" data-testid="btn-verify-task"><mat-icon>verified</mat-icon> Verify</button>
                            }
                            @if (auth.can('createTasks')) {
                              <button mat-menu-item (click)="openForm(t)" data-testid="btn-edit"><mat-icon>edit</mat-icon> Edit</button>
                              <button mat-menu-item (click)="remove(t)" data-testid="btn-delete"><mat-icon>delete</mat-icon> Delete</button>
                            }
                          </mat-menu>
                        </div>
                        <div class="meta">
                          <ce-pill [value]="t.priority" size="sm" data-testid="chip-priority" />
                          <span [title]="t.storeName"><span class="material-symbols-outlined">storefront</span><span class="ellipsis" style="max-width: 150px">{{ t.storeName }}</span></span>
                        </div>
                        @if (t.dueAt) {
                          <div class="meta">
                            <span [class.over]="overdueT(t)" [title]="'Due ' + dt(t.dueAt) + ' (store time)'"><span class="material-symbols-outlined">event</span>{{ overdueT(t) ? due(t).label : dt(t.dueAt) }}</span>
                          </div>
                        }
                        @if (isScheduled(t)) {
                          <div class="meta" data-testid="task-starts"><span><span class="material-symbols-outlined">schedule</span>Starts {{ dt(t.startAt!) }}</span></div>
                        }
                        @if (t.checklistAnswerId) {
                          <div class="meta" data-testid="task-from-checklist"><span><span class="material-symbols-outlined">fact_check</span>From a checklist response</span></div>
                        }
                        @if (t.proofUrl || t.remark) {
                          <div class="kb-proof" data-testid="task-proof">
                            @if (t.proofUrl) {
                              @if (isVideo(t.proofUrl)) {
                                <span class="material-symbols-outlined" style="font-size: 20px; color: var(--c-text-3)">movie</span>
                              } @else {
                                <a [href]="t.proofUrl" target="_blank" rel="noopener" (click)="$event.stopPropagation()"><img [src]="t.proofUrl" alt="Proof" /></a>
                              }
                            }
                            @if (t.remark) {
                              <span [title]="t.remark">“{{ t.remark }}”</span>
                            }
                          </div>
                        }
                        <div class="foot">
                          @if (t.assigneeName) {
                            <ce-avatar [name]="t.assigneeName" [size]="22" />
                            <span class="grow" [title]="t.assigneeName">{{ t.assigneeName }}</span>
                          } @else {
                            <span class="grow">Unassigned</span>
                          }
                          <span class="material-symbols-outlined" style="font-size: 16px; color: var(--c-text-3)" [matTooltip]="label(t.type)">{{ typeIcon[t.type] }}</span>
                        </div>
                      </div>
                    } @empty {
                      <div class="kb-empty">{{ col === 'VERIFIED' ? 'Managers verify done tasks' : 'Drop tasks here' }}</div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        } @else {
          <div class="ops-card">
            <ce-table
              [rows]="rows()"
              [columns]="cols"
              [loading]="busy()"
              title="Task info"
              [subtitle]="isStaff() ? 'Assigned to you' : null"
              testId="table-tasks"
              [rowTestId]="rowId"
              [bare]="true"
              [columnChooser]="true"
              [defaultSort]="{ key: 'dueAt', dir: 'asc' }"
              sortStart="asc"
              emptyIcon="task_alt"
              [emptyTitle]="filtered() ? 'No tasks match these filters' : isStaff() ? 'Nothing assigned to you' : 'No tasks yet'"
              [emptyMessage]="filtered() ? 'Clear the search or filters to see every task.' : auth.can('createTasks') ? 'Create a task, or raise one from a flagged checklist answer.' : 'Tasks from your manager will show here.'"
            >
              <ng-template ceCell="title" let-t>
                <div class="ops-cell-title" style="max-width: 250px" [title]="t.title">
                  <button type="button" class="ce-text-link t" style="text-align: left; padding: 0; border: 0; background: none; font: inherit; cursor: pointer" (click)="openDetail(t)">{{ t.title }}</button>
                  <span class="s">{{ label(t.type) }} · {{ t.storeName }}{{ isScheduled(t) ? ' · starts ' + dt(t.startAt!) : '' }}{{ t.remark ? ' · “' + t.remark + '”' : '' }}</span>
                </div>
              </ng-template>
              <ng-template ceCell="createdByName" let-t>
                <span class="cell-avatar" [title]="t.createdByName + ' · ' + date(t.createdAt)">
                  <ce-avatar [name]="t.createdByName" [size]="26" />
                  <span class="ops-cell-title"><span class="t">{{ t.createdByName || '--' }}</span><span class="s">{{ date(t.createdAt) }}</span></span>
                </span>
              </ng-template>
              <ng-template ceCell="priority" let-t>
                <ce-pill [value]="t.priority" data-testid="chip-priority" />
              </ng-template>
              <ng-template ceCell="assigneeName" let-t>
                @if (t.assigneeName) {
                  <span class="cell-avatar" style="max-width: 180px" [title]="t.assigneeName"><ce-avatar [name]="t.assigneeName" [size]="26" /><span class="ellipsis">{{ t.assigneeName }}</span></span>
                } @else {
                  <span class="dash">Unassigned</span>
                }
              </ng-template>
              <ng-template ceCell="dueAt" let-t>
                @let d = due(t);
                <span [class]="'ops-due ' + d.tone">
                  <span class="d">{{ t.dueAt ? dt(t.dueAt) : '--' }}</span>
                  @if (d.tone === 'overdue' || d.tone === 'soon') {
                    <span class="r">{{ d.label }}</span>
                  }
                </span>
              </ng-template>
              <ng-template ceCell="status" let-t>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="kb-status-select" (click)="$event.stopPropagation()">
                  <mat-select [value]="t.status" (selectionChange)="setStatus(t, $event.value, $event.source)" [disabled]="t.status === 'VERIFIED' || busyId() === t.id" data-testid="select-task-status" aria-label="Status">
                    @for (s of columnsFor(t); track s) {
                      <mat-option [value]="s">{{ label(s) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              </ng-template>
              <ng-template ceCell="action" let-t>
                <span class="ops-row-actions">
                  @if (t.status === 'DONE' && auth.can('verifyTasks')) {
                    <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="verify(t)" [disabled]="busyId() === t.id" data-testid="btn-verify-task"><mat-icon>verified</mat-icon> Verify</button>
                  }
                  <button type="button" class="ce-icon-btn sm" matTooltip="View" aria-label="View task" (click)="openDetail(t)" data-testid="btn-view-task"><mat-icon>visibility</mat-icon></button>
                  @if (auth.can('createTasks')) {
                    <button type="button" class="ce-icon-btn sm" matTooltip="Edit" aria-label="Edit" (click)="openForm(t)" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
                    <button type="button" class="ce-icon-btn sm" matTooltip="Delete" aria-label="Delete" (click)="remove(t)" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
                  }
                </span>
              </ng-template>
            </ce-table>
          </div>
        }
      </ce-page>
    </section>

    <ce-task-form-drawer [(open)]="formOpen" [task]="editing()" [bulk]="false" [defaultStoreId]="storeId() ?? lookup.scopedStores()[0]?.id ?? null" (saved)="onSaved($any($event), false)" />
    <ce-task-form-drawer [(open)]="bulkOpen" [bulk]="true" [defaultStoreId]="storeId()" (saved)="onSaved($any($event), true)" />

    <ce-drawer [(open)]="detailOpen" [title]="detail()?.title ?? 'Task'" [subtitle]="detail() ? label(detail()!.type) + ' · ' + detail()!.storeName : null" size="lg" testId="drawer-task">
      @if (detail(); as t) {
        <div class="stack" style="gap: 18px">
          <div class="row" style="gap: 8px; flex-wrap: wrap">
            <ce-pill [value]="t.status" data-testid="task-detail-status" />
            <ce-pill [value]="t.priority" />
            @if (overdueT(t)) {
              <ce-pill tone="critical" [label]="due(t).label" icon="schedule" />
            }
            @if (t.checklistAnswerId) {
              <ce-pill tone="info" label="From checklist" icon="fact_check" [dot]="false" />
            }
          </div>
          @if (t.description) {
            <p style="margin: 0; white-space: pre-wrap; overflow-wrap: anywhere" data-testid="task-detail-description">{{ t.description }}</p>
          }
          <dl class="ops-kv">
            <dt>Store</dt>
            <dd class="ellipsis" [title]="t.storeName">{{ t.storeName }}</dd>
            <dt>Assigned to</dt>
            <dd>
              @if (t.assigneeName) {
                <span class="cell-avatar" style="display: inline-flex; gap: 8px; align-items: center"><ce-avatar [name]="t.assigneeName" [size]="22" />{{ t.assigneeName }}</span>
              } @else {
                <span class="muted">Unassigned</span>
              }
            </dd>
            <dt>Created by</dt>
            <dd>{{ t.createdByName || '--' }}</dd>
            <dt>Due</dt>
            <dd [class.bad-text]="overdueT(t)">{{ t.dueAt ? dt(t.dueAt) : 'No due date' }}</dd>
          </dl>
          <div>
            <div class="ops-section-label" style="margin-bottom: 10px">Timeline</div>
            <ol class="ops-timeline" data-testid="task-timeline">
              <li><span class="ic on"><span class="material-symbols-outlined">add</span></span><span class="tx">Created by {{ t.createdByName || 'someone' }}<small>{{ dt(t.createdAt) }}</small></span></li>
              @if (t.startAt) {
                <li><span class="ic" [class.on]="!isScheduled(t)"><span class="material-symbols-outlined">visibility</span></span><span class="tx">{{ isScheduled(t) ? 'Becomes visible' : 'Visible to the assignee' }}<small>{{ dt(t.startAt) }}</small></span></li>
              }
              @if (t.status === 'IN_PROGRESS') {
                <li><span class="ic on"><span class="material-symbols-outlined">play_arrow</span></span><span class="tx">Work in progress</span></li>
              }
              @if (t.completedAt) {
                <li><span class="ic good"><span class="material-symbols-outlined">check</span></span><span class="tx">Marked done<small>{{ dt(t.completedAt) }}</small></span></li>
              }
              @if (t.verifiedAt) {
                <li><span class="ic good"><span class="material-symbols-outlined">verified</span></span><span class="tx">Verified<small>{{ dt(t.verifiedAt) }}</small></span></li>
              }
              @if (t.status === 'CANCELLED') {
                <li><span class="ic"><span class="material-symbols-outlined">block</span></span><span class="tx">Cancelled</span></li>
              }
              @if (!t.completedAt && t.status !== 'CANCELLED' && t.dueAt) {
                <li><span class="ic"><span class="material-symbols-outlined">flag</span></span><span class="tx">Due<small>{{ dt(t.dueAt) }}</small></span></li>
              }
            </ol>
          </div>
          @if (t.proofUrl || t.remark) {
            <div>
              <div class="ops-section-label" style="margin-bottom: 10px">Completion proof</div>
              @if (t.proofUrl) {
                @if (isVideo(t.proofUrl)) {
                  <video class="ops-proof-img" [src]="t.proofUrl" controls preload="metadata"></video>
                } @else {
                  <a [href]="t.proofUrl" target="_blank" rel="noopener"><img class="ops-proof-img" [src]="t.proofUrl" alt="Completion proof" /></a>
                }
              }
              @if (t.remark) {
                <p style="margin: 8px 0 0" class="muted">“{{ t.remark }}”</p>
              }
            </div>
          }
        </div>
      }
      <ng-container drawerFooter>
        @if (detail(); as t) {
          @if (auth.can('createTasks')) {
            <button type="button" class="ce-btn ce-btn-ghost" (click)="detailOpen.set(false); openForm(t)"><mat-icon>edit</mat-icon> Edit</button>
          }
          <span style="flex: 1"></span>
          @if (t.status === 'TODO') {
            <button type="button" class="ce-btn ce-btn-secondary" (click)="setStatus(t, 'IN_PROGRESS')" [disabled]="busyId() === t.id" data-testid="btn-detail-start"><mat-icon>play_arrow</mat-icon> Start</button>
          }
          @if (t.status === 'TODO' || t.status === 'IN_PROGRESS') {
            <button type="button" class="ce-btn ce-btn-primary" (click)="setStatus(t, 'DONE')" [disabled]="busyId() === t.id" data-testid="btn-detail-done"><mat-icon>task_alt</mat-icon> Mark done</button>
          }
          @if (t.status === 'DONE' && auth.can('verifyTasks')) {
            <button type="button" class="ce-btn ce-btn-primary" (click)="verify(t)" [disabled]="busyId() === t.id" data-testid="btn-detail-verify"><mat-icon>verified</mat-icon> Verify</button>
          }
        }
      </ng-container>
    </ce-drawer>
  `,
})
export class TasksPage {
  protected readonly auth = inject(AuthService);
  protected readonly lookup = inject(LookupService);
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly dialog = inject(MatDialog);

  readonly columns = TASK_STATUSES;
  readonly priorities = PRIORITIES;
  readonly typeIcon = TASK_TYPE_ICON;
  readonly viewOptions: TabItem[] = [
    { value: 'board', label: 'Board', testId: 'view-board' },
    { value: 'list', label: 'List', testId: 'view-list' },
  ];
  readonly mineOptions: TabItem[] = [
    { value: 'all', label: 'All', testId: 'toggle-mine-false' },
    { value: 'mine', label: 'Assigned to me', testId: 'toggle-mine-true' },
  ];
  readonly isStaff = computed(() => this.auth.role() === 'STAFF');
  // stored raw by safeStorage.set() → read with getString() (get() JSON-parses and would always fall back)
  readonly view = signal<'board' | 'list'>(safeStorage.getString('ce.tasks.view') === 'list' ? 'list' : 'board');
  readonly search = signal('');
  readonly storeId = signal<number | null>(null);
  readonly priority = signal<string | null>(null);
  readonly mine = signal(false);
  readonly busyId = signal<number | null>(null);
  readonly formOpen = signal(false);
  readonly bulkOpen = signal(false);
  readonly editing = signal<Task | null>(null);
  readonly detailOpen = signal(false);
  private readonly detailId = signal<number | null>(null);

  readonly data = loadOn(
    () => ({ storeIds: this.storeId() ? [this.storeId()!] : undefined, mine: this.isStaff() || this.mine() }),
    (q) => this.api.get<Task[]>('/tasks', q),
  );
  readonly busy = computed(() => this.data.loading() && !this.data.data());
  readonly rows = computed(() => {
    const s = this.search().toLowerCase().trim();
    const p = this.priority();
    return (this.data.data() ?? []).filter(
      (t) => (!p || t.priority === p) && (!s || `${t.title} ${t.description ?? ''} ${t.storeName} ${t.assigneeName ?? ''} ${t.createdByName ?? ''}`.toLowerCase().includes(s)),
    );
  });
  readonly filtered = computed(() => !!this.search().trim() || !!this.priority() || !!this.storeId() || this.mine());
  readonly byStatus = computed(() => groupTasks(this.rows()));
  readonly overdue = computed(() => (this.data.data() ? this.rows().filter((t) => isTaskOverdue(t)).length : undefined));
  readonly detail = computed(() => (this.data.data() ?? []).find((t) => t.id === this.detailId()) ?? null);
  readonly rowId = (t: Task) => `row-task-${t.id}`;
  readonly cols: CeColumn<Task>[] = withMobileLabels<Task>(
    [
      { key: 'title', header: 'Task name', type: 'custom', sortable: true, locked: true, searchable: true },
      { key: 'createdByName', header: 'Created by', type: 'custom', sortable: true, searchable: true, hidden: true },
      { key: 'createdAt', header: 'Created on', sortable: true, format: (v) => storeDate(String(v ?? '')), hidden: true },
      { key: 'priority', header: 'Priority', type: 'custom', sortable: true, value: (t) => PRIORITY_RANK[t.priority] },
      { key: 'assigneeName', header: 'Assigned to', type: 'custom', sortable: true },
      { key: 'dueAt', header: 'Due on', type: 'custom', sortable: true },
      { key: 'status', header: 'Status', type: 'custom', sortable: true },
      { key: 'action', header: 'Action', type: 'actions', align: 'right', locked: true, value: () => '' },
    ],
    ['createdByName'],
  );

  constructor() {
    this.lookup.loadStores().subscribe();
    if (this.auth.can('createTasks')) this.lookup.loadUsers();
  }

  count(s: TaskStatus): number | undefined {
    return this.data.data() ? this.rows().filter((t) => t.status === s).length : undefined;
  }
  label(v: string): string {
    return ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'TODO', 'IN_PROGRESS', 'DONE', 'VERIFIED', 'CANCELLED'].includes(v) ? (v === 'TODO' ? 'To do' : humanize(v)) : opsLabel(v);
  }
  dt(iso: string): string {
    return storeDateTime(iso);
  }
  date(iso: string): string {
    return storeDate(iso);
  }
  due(t: Task) {
    return dueInfo(t.dueAt, FINISHED.includes(t.status));
  }
  overdueT(t: Task): boolean {
    return isTaskOverdue(t);
  }
  isScheduled(t: Task): boolean {
    return !!t.startAt && new Date(t.startAt).getTime() > Date.now();
  }
  isVideo(url: string): boolean {
    return /\.(mp4|webm|mov)$/i.test(url);
  }
  clearFilters(): void {
    this.search.set('');
    this.priority.set(null);
    this.storeId.set(null);
    this.mine.set(false);
  }

  setView(v: 'board' | 'list'): void {
    this.view.set(v);
    safeStorage.set('ce.tasks.view', v);
  }

  nextStatuses(t: Task): TaskStatus[] {
    return TASK_STATUSES.filter((s) => s !== 'VERIFIED' && canMoveTask(t.status, s, false));
  }
  columnsFor(t: Task): TaskStatus[] {
    return TASK_STATUSES.filter((s) => s === t.status || (s !== 'VERIFIED' && canMoveTask(t.status, s, false)));
  }

  drop(e: CdkDragDrop<TaskStatus>): void {
    const t = e.item.data as Task;
    const to = e.container.data;
    if (t.status === to) return;
    if (!canMoveTask(t.status, to, this.auth.can('verifyTasks'))) {
      if (to === 'VERIFIED') this.ui.toast('Only DONE tasks can be verified, by a manager');
      return;
    }
    if (to === 'VERIFIED') this.verify(t);
    else this.setStatus(t, to);
  }

  setStatus(t: Task, status: TaskStatus, src?: MatSelect): void {
    if (status === t.status) return;
    if (status === 'DONE') {
      // completion asks for proof + remark
      this.dialog
        .open(CompleteTaskDialog, { data: t, width: '560px', maxWidth: '96vw' })
        .afterClosed()
        .subscribe((r?: CompleteTaskResult) => {
          if (r) this.patchStatus(t, 'DONE', r);
          else {
            // cancelled: put the list's status picker back
            if (src) src.writeValue(t.status);
            this.data.reload();
          }
        });
      return;
    }
    this.patchStatus(t, status);
  }

  private patchStatus(t: Task, status: TaskStatus, extra: CompleteTaskResult = {}): void {
    // optimistic update
    this.busyId.set(t.id);
    this.data.set((this.data.data() ?? []).map((x) => (x.id === t.id ? { ...x, status, ...extra } : x)));
    this.api.patch<Task>(`/tasks/${t.id}/status`, { status, ...extra }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.data.reload();
      },
      error: () => {
        this.busyId.set(null);
        this.data.reload();
      },
    });
  }

  verify(t: Task): void {
    if (this.busyId() === t.id) return;
    this.busyId.set(t.id);
    this.api.patch<Task>(`/tasks/${t.id}/verify`).subscribe({
      next: () => {
        this.busyId.set(null);
        this.ui.toast('Task verified');
        this.data.reload();
      },
      error: () => this.busyId.set(null),
    });
  }

  openDetail(t: Task): void {
    this.detailId.set(t.id);
    this.detailOpen.set(true);
  }
  openForm(t: Task | null): void {
    this.editing.set(t);
    this.formOpen.set(true);
  }
  openBulk(): void {
    this.bulkOpen.set(true);
  }
  onSaved(r: Task | Task[], bulk: boolean): void {
    if (bulk) this.ui.toast(`${Array.isArray(r) ? r.length : 0} task(s) created`);
    else this.ui.toast(this.editing() ? 'Task updated' : 'Task created');
    this.data.reload();
  }

  remove(t: Task): void {
    this.ui.confirm({ title: 'Delete task?', message: `Delete "${t.title}"? This can't be undone.`, confirmText: 'Delete', danger: true }).subscribe(() =>
      this.api.delete(`/tasks/${t.id}`).subscribe(() => {
        this.ui.toast('Task deleted');
        if (this.detailId() === t.id) this.detailOpen.set(false);
        this.data.reload();
      }),
    );
  }
}
