import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Observable } from 'rxjs';
import { BulkTaskRequest, PRIORITIES, Priority, Task, TaskType, Zone } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { V2Api } from '../../core/services/v2.api';
import { humanize } from '../../core/utils/format';
import { apiErrorText, httpStatus } from '../../core/utils/http-errors';
import { DS } from '../../shared/ds';
import { isoToZonedInput, opsLabel, zonedInputToIso } from '../checklists/_ui/ops';

export const TASK_TYPES: TaskType[] = ['GENERAL', 'ZONE_ALLOCATION', 'FOLLOW_UP', 'VISUAL_MERCHANDISING'];
export const TASK_TYPE_ICON: Record<string, string> = { GENERAL: 'task_alt', ZONE_ALLOCATION: 'grid_view', FOLLOW_UP: 'fact_check', VISUAL_MERCHANDISING: 'storefront' };

export interface TaskFormValue {
  title: string;
  description: string;
  storeId: number | null;
  storeIds: number[];
  type: TaskType;
  zoneId: number | null;
  priority: Priority;
  assigneeId: number | null;
  startAt: string;
  dueAt: string;
}

/** Inline problems of the task form; empty object = valid. `now` makes "due in the past" testable. */
export function taskFormErrors(v: TaskFormValue, bulk: boolean, isNew: boolean, now = Date.now()): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.title.trim()) e['title'] = 'Give the task a title';
  else if (v.title.trim().length > 200) e['title'] = 'Keep the title under 200 characters';
  if (bulk ? !v.storeIds.length : !v.storeId) e['store'] = bulk ? 'Choose at least one store' : 'Choose a store';
  if (!bulk && v.type === 'ZONE_ALLOCATION' && !v.zoneId) e['zone'] = 'Pick the zone to allocate';
  const s = zonedInputToIso(v.startAt);
  const d = zonedInputToIso(v.dueAt);
  if (v.startAt && !s) e['startAt'] = 'Enter a valid date and time';
  if (v.dueAt && !d) e['dueAt'] = 'Enter a valid date and time';
  if (s && d && d <= s) e['dueAt'] = 'Due time must be after the start time';
  else if (isNew && d && new Date(d).getTime() < now - 60_000) e['dueAt'] = 'Due time is in the past';
  return e;
}

/**
 * Create / edit task side panel, and the bulk (multi-store) variant. Keeps the generic-dialog testids
 * (`dialog-task` / `dialog-bulk-task`, `input-<apiField>`, `btn-save`) so the Playwright helpers keep working.
 * Date-times are entered in store time (Asia/Kolkata).
 */
@Component({
  selector: 'ce-task-form-drawer',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule, ...DS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-drawer [(open)]="open" [title]="title()" [subtitle]="subtitle()" size="lg" [testId]="bulk() ? 'dialog-bulk-task' : 'dialog-task'">
      @if (open()) {
        <form class="ops-form" (ngSubmit)="save()" novalidate>
          @if (serverError()) {
            <ce-info-banner class="full" tone="danger" title="Couldn't save" data-testid="form-error">{{ serverError() }}</ce-info-banner>
          }
          @if (bulk()) {
            <div class="full">
              <label class="ce-field-label">Stores *</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <mat-select multiple [(ngModel)]="v.storeIds" name="storeIds" (ngModelChange)="touch()" placeholder="Choose stores" data-testid="input-storeIds" aria-label="Stores">
                  @for (s of lookup.scopedStores(); track s.id) {
                    <mat-option [value]="s.id">{{ s.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              @if (err()['store']) {
                <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ err()['store'] }}</div>
              } @else {
                <div class="ops-hint">One task is created per store{{ v.storeIds.length ? ' — ' + v.storeIds.length + ' selected' : '' }}.</div>
              }
            </div>
          }
          <div class="full">
            <label class="ce-field-label" for="tf-title">Title *</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
              <input id="tf-title" matInput [(ngModel)]="v.title" name="title" (ngModelChange)="touch()" maxlength="200" placeholder="e.g. Refill the sarees display before the evening peak" data-testid="input-title" />
            </mat-form-field>
            @if (err()['title']) {
              <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ err()['title'] }}</div>
            }
          </div>
          <div class="full">
            <label class="ce-field-label" for="tf-desc">Description</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
              <textarea id="tf-desc" matInput rows="3" [(ngModel)]="v.description" name="description" maxlength="2000" placeholder="What needs to be done, and how to prove it" data-testid="input-description"></textarea>
            </mat-form-field>
          </div>
          @if (!bulk()) {
            <div>
              <label class="ce-field-label">Store *</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <mat-select [(ngModel)]="v.storeId" name="storeId" (ngModelChange)="onStore()" placeholder="Choose a store" data-testid="input-storeId" aria-label="Store">
                  @for (s of lookup.scopedStores(); track s.id) {
                    <mat-option [value]="s.id">{{ s.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              @if (err()['store']) {
                <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ err()['store'] }}</div>
              }
            </div>
          }
          <div>
            <label class="ce-field-label">Type</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
              <mat-select [(ngModel)]="v.type" name="type" (ngModelChange)="onType()" data-testid="input-type" aria-label="Type">
                @for (t of types; track t) {
                  <mat-option [value]="t">{{ label(t) }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>
          @if (!bulk() && v.type === 'ZONE_ALLOCATION') {
            <div>
              <label class="ce-field-label">Zone *</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <mat-select [(ngModel)]="v.zoneId" name="zoneId" (ngModelChange)="touch()" [placeholder]="v.storeId ? 'Choose a zone' : 'Choose a store first'" data-testid="input-zoneId" aria-label="Zone">
                  @for (z of zones(); track z.id) {
                    <mat-option [value]="z.id">{{ z.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              @if (err()['zone']) {
                <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ err()['zone'] }}</div>
              }
            </div>
          }
          <div>
            <label class="ce-field-label">Priority</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
              <mat-select [(ngModel)]="v.priority" name="priority" data-testid="input-priority" aria-label="Priority">
                @for (p of priorities; track p) {
                  <mat-option [value]="p">{{ label(p) }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>
          <div [class.full]="bulk()">
            <label class="ce-field-label">Assign to</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
              <mat-select [(ngModel)]="v.assigneeId" name="assigneeId" [placeholder]="bulk() ? 'Each store’s manager' : 'Unassigned'" data-testid="input-assigneeId" aria-label="Assignee">
                <mat-option [value]="null">{{ bulk() ? 'Each store’s manager' : 'Unassigned' }}</mat-option>
                @for (u of assignees(); track u.id) {
                  <mat-option [value]="u.id">{{ u.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>
          <div>
            <label class="ce-field-label" for="tf-start">Visible from <span class="caption">(store time)</span></label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
              <input id="tf-start" matInput type="datetime-local" [(ngModel)]="v.startAt" name="startAt" (ngModelChange)="touch()" data-testid="input-startAt" />
            </mat-form-field>
            @if (err()['startAt']) {
              <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ err()['startAt'] }}</div>
            } @else {
              <div class="ops-hint">Hidden from the assignee until then</div>
            }
          </div>
          <div>
            <label class="ce-field-label" for="tf-due">Due <span class="caption">(store time)</span></label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
              <input id="tf-due" matInput type="datetime-local" [(ngModel)]="v.dueAt" name="dueAt" (ngModelChange)="touch()" data-testid="input-dueAt" />
            </mat-form-field>
            @if (err()['dueAt']) {
              <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ err()['dueAt'] }}</div>
            }
          </div>
          <button type="submit" hidden></button>
        </form>
      }
      <ng-container drawerFooter>
        <button type="button" class="ce-btn ce-btn-ghost" (click)="open.set(false)" data-testid="btn-cancel">Cancel</button>
        <button type="button" class="ce-btn ce-btn-primary" (click)="save()" [disabled]="saving()" data-testid="btn-save">
          @if (saving()) {
            <mat-spinner diameter="16" />
          }
          {{ bulk() ? 'Create tasks' : task() ? 'Save changes' : 'Create task' }}
        </button>
      </ng-container>
    </ce-drawer>
  `,
})
export class TaskFormDrawer {
  protected readonly lookup = inject(LookupService);
  private readonly api = inject(ApiService);
  private readonly v2 = inject(V2Api);
  readonly open = model(false);
  /** Server validation message (contract v4: assignee must work at the store, etc.), shown in the drawer. */
  readonly serverError = signal<string | null>(null);
  readonly bulk = input(false);
  /** Task being edited (null = create). */
  readonly task = input<Task | null>(null);
  readonly defaultStoreId = input<number | null>(null);
  readonly saved = output<Task | Task[]>();

  readonly types = TASK_TYPES;
  readonly priorities = PRIORITIES;
  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly zones = signal<Zone[]>([]);
  private readonly version = signal(0);
  v: TaskFormValue = this.blank();

  readonly title = computed(() => (this.bulk() ? 'Bulk create tasks across stores' : this.task() ? 'Edit task' : 'New task'));
  readonly subtitle = computed(() => (this.bulk() ? 'One copy per store, assigned to each store’s manager unless you pick someone' : this.task() ? this.task()!.title : 'Assign work to a store team'));
  readonly err = computed(() => {
    this.version();
    return this.submitted() ? taskFormErrors(this.v, this.bulk(), !this.task()) : {};
  });
  readonly assignees = computed(() => {
    this.version();
    if (this.bulk()) {
      const ids = this.v.storeIds;
      return this.lookup.users().filter((u) => (ids.length === 1 ? this.lookup.usersForStore(ids[0]).includes(u) : u.role === 'REGIONAL_MANAGER' || u.role === 'ADMIN' || u.role === 'SUPER_ADMIN'));
    }
    return this.lookup.usersForStore(this.v.storeId);
  });

  constructor() {
    // reset the form each time the drawer opens
    effect(() => {
      if (!this.open()) return;
      const t = this.task();
      this.v = t
        ? { title: t.title, description: t.description ?? '', storeId: t.storeId, storeIds: [], type: t.type, zoneId: t.zoneId, priority: t.priority, assigneeId: t.assigneeId, startAt: isoToZonedInput(t.startAt), dueAt: isoToZonedInput(t.dueAt) }
        : { ...this.blank(), storeId: this.defaultStoreId(), storeIds: this.defaultStoreId() ? [this.defaultStoreId()!] : [] };
      this.submitted.set(false);
      this.saving.set(false);
      this.serverError.set(null);
      this.loadZones();
      this.touch();
    });
  }

  private blank(): TaskFormValue {
    return { title: '', description: '', storeId: null, storeIds: [], type: 'GENERAL', zoneId: null, priority: 'MEDIUM', assigneeId: null, startAt: '', dueAt: '' };
  }
  label(v: string): string {
    return v === 'URGENT' || v === 'HIGH' || v === 'MEDIUM' || v === 'LOW' ? humanize(v) : opsLabel(v);
  }
  touch(): void {
    this.version.update((x) => x + 1);
  }
  onStore(): void {
    this.v.zoneId = null;
    if (this.v.assigneeId && !this.lookup.usersForStore(this.v.storeId).some((u) => u.id === this.v.assigneeId)) this.v.assigneeId = null;
    this.loadZones();
    this.touch();
  }
  onType(): void {
    this.loadZones();
    this.touch();
  }
  private loadZones(): void {
    const sid = this.v.storeId;
    if (this.bulk() || this.v.type !== 'ZONE_ALLOCATION' || !sid) {
      this.zones.set([]);
      return;
    }
    this.api.get<Zone[]>('/zones', { storeId: sid }, silent()).subscribe({
      next: (z) => {
        if (this.v.storeId === sid) this.zones.set(z.filter((x) => x.isActive !== false && (x.type === 'SECTION' || x.type === 'QUEUE')));
      },
      error: () => this.zones.set([]),
    });
  }

  save(): void {
    if (this.saving()) return;
    this.submitted.set(true);
    this.touch();
    if (Object.keys(taskFormErrors(this.v, this.bulk(), !this.task())).length) return;
    const v = this.v;
    const common = {
      title: v.title.trim(),
      description: v.description.trim() || null,
      type: v.type,
      priority: v.priority,
      assigneeId: v.assigneeId,
      startAt: zonedInputToIso(v.startAt),
      dueAt: zonedInputToIso(v.dueAt),
    };
    let req: Observable<Task | Task[]>;
    if (this.bulk()) req = this.v2.bulkTasks({ ...common, description: common.description ?? undefined, storeIds: v.storeIds } as BulkTaskRequest);
    else {
      const body: Record<string, unknown> = { ...common, storeId: v.storeId };
      if (v.type === 'ZONE_ALLOCATION') body['zoneId'] = v.zoneId;
      else if (this.task()) body['zoneId'] = null;
      const t = this.task();
      req = t ? this.api.patch<Task>(`/tasks/${t.id}`, body, silent()) : this.api.post<Task>('/tasks', body, null, silent());
    }
    this.saving.set(true);
    this.serverError.set(null);
    req.subscribe({
      next: (r) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(r);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        const st = httpStatus(e);
        this.serverError.set(st === 403 ? 'You do not have permission to make this change.' : st === 0 ? 'No connection. Check your network and try again.' : apiErrorText(e, 'The server rejected the change.'));
      },
    });
  }
}
