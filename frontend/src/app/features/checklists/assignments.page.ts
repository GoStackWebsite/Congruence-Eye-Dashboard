import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Assignment, AssignmentStatus, Template } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { toIsoDate } from '../../core/utils/dates';
import { humanize } from '../../core/utils/format';
import { FieldDef } from '../../shared/crud/field';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { dueInfo, storeDate, storeDateTime, withMobileLabels } from './_ui/ops';
import { LIST_STYLES } from './_ui/styles';

// IN_PROGRESS = a saved draft: the assignee must be able to resume it
const FILLABLE: AssignmentStatus[] = ['PENDING', 'IN_PROGRESS', 'OVERDUE', 'REDO'];
const OPEN: AssignmentStatus[] = ['PENDING', 'IN_PROGRESS', 'OVERDUE', 'REDO'];

/** Due instant of an assignment (dueAt, else end of the due date in store time). */
export function assignmentDueIso(a: Pick<Assignment, 'dueAt' | 'dueDate'>): string | null {
  return a.dueAt ?? (a.dueDate ? `${a.dueDate}T23:59:00+05:30` : null);
}

/** Open work first (overdue → due soonest), then finished work newest first. */
export function sortAssignments(list: Assignment[]): Assignment[] {
  const open = (a: Assignment) => OPEN.includes(a.status);
  return [...list].sort((a, b) => {
    if (open(a) !== open(b)) return open(a) ? -1 : 1;
    const da = assignmentDueIso(a) ?? '';
    const db = assignmentDueIso(b) ?? '';
    return open(a) ? da.localeCompare(db) : db.localeCompare(da);
  });
}

/** Trax › Manage › Assignments ("My checklists" for staff): who fills which checklist, by when. */
@Component({
  selector: 'ce-assignments-page',
  imports: [FormsModule, RouterLink, MatFormFieldModule, MatSelectModule, MatIconModule, MatTooltipModule, ...DS, ...LIST_STYLES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles />
    <section class="ops-page" data-testid="page-checklist-assignments">
      <ce-page [title]="canAssign() ? 'Checklist assignments' : 'My checklists'" [description]="canAssign() ? 'Who needs to fill which checklist, and by when (store time)' : 'Checklists assigned to you — overdue and due-soon first'">
        <ng-container pageActions>
          @if (canAssign()) {
            <button type="button" class="ce-btn ce-btn-primary" (click)="assign()" data-testid="btn-create-assignment"><mat-icon>assignment_add</mat-icon> Assign checklist</button>
          }
        </ng-container>

        <ce-stat-strip label="Assignment summary">
          <ce-stat-tile variant="strip" id="asg-due" label="To do" [value]="countOf(['PENDING', 'IN_PROGRESS'])" [loading]="busy()" hint="Pending and in-progress (draft saved)" />
          <ce-stat-tile variant="strip" id="asg-overdue" label="Overdue" [value]="countOf(['OVERDUE'])" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="asg-redo" label="Redo" [value]="countOf(['REDO'])" [loading]="busy()" hint="Sent back by the reviewer" />
          <span class="ce-stat-strip-sep" aria-hidden="true"></span>
          <ce-stat-tile variant="strip" id="asg-submitted" label="Submitted" [value]="countOf(['SUBMITTED'])" [loading]="busy()" hint="Waiting for review" />
          <ce-stat-tile variant="strip" id="asg-approved" label="Approved" [value]="countOf(['APPROVED'])" [loading]="busy()" />
        </ce-stat-strip>

        @if (data.error() && !data.data()) {
          <div class="ops-card">
            <ce-empty-state kind="error" [message]="data.error()"><button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button></ce-empty-state>
          </div>
        } @else {
          <div class="ops-card">
            <ce-table
              [rows]="rows()"
              [columns]="cols()"
              [loading]="busy()"
              [title]="mine() ? 'Assigned to me' : 'All assignments'"
              [searchable]="true"
              searchPlaceholder="Search checklist, store or person"
              searchTestId="input-search-assignments"
              testId="table-assignments"
              [rowTestId]="rowId"
              [bare]="true"
              emptyIcon="assignment_turned_in"
              [emptyTitle]="status() ? 'Nothing ' + label(status()!).toLowerCase() : mine() ? 'Nothing assigned to you' : 'No assignments yet'"
              [emptyMessage]="status() ? 'Clear the status filter to see everything.' : mine() ? 'New checklists from your manager will show here.' : 'Assign a checklist, or create a schedule to assign it every day.'"
            >
              <div tableFilters class="ops-toolbar" style="margin-top: 8px">
                @if (canAssign()) {
                  <ce-segmented [options]="scopeOptions" [value]="mine() ? 'true' : 'false'" (valueChange)="mine.set($event === 'true')" label="Scope" data-testid="toggle-mine" />
                }
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="ops-filter">
                  <mat-select [ngModel]="status()" (ngModelChange)="status.set($event)" placeholder="All statuses" data-testid="filter-assignment-status" aria-label="Status">
                    <mat-option [value]="null">All statuses</mat-option>
                    @for (s of statuses; track s) {
                      <mat-option [value]="s">{{ label(s) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                @if (status()) {
                  <button type="button" class="ce-link-btn" (click)="status.set(null)" data-testid="btn-clear-filters">Clear filters</button>
                }
              </div>
              <ng-template ceCell="templateName" let-a>
                <div class="ops-cell-title" [title]="a.templateName">
                  <span class="t">{{ a.templateName }}</span>
                  <span class="s">{{ a.storeName }}</span>
                </div>
              </ng-template>
              <ng-template ceCell="due" let-a>
                @let d = due(a);
                <span class="ops-due" [class]="'ops-due ' + d.tone" [title]="dueTitle(a)">
                  <span class="d">{{ a.dueAt ? dt(a.dueAt) : date(a.dueDate) }}</span>
                  @if (d.tone === 'overdue' || d.tone === 'soon') {
                    <span class="r">{{ d.label }}</span>
                  }
                </span>
              </ng-template>
              <ng-template ceCell="status" let-a>
                <ce-pill [value]="a.status" data-testid="chip-status" />
              </ng-template>
              <ng-template ceCell="action" let-a>
                <span class="ops-row-actions">
                  @if (canFill(a)) {
                    <a class="ce-btn ce-btn-primary ce-btn-sm" [routerLink]="['/checklists/fill', a.id]" data-testid="btn-fill">
                      {{ a.status === 'REDO' ? 'Redo' : a.status === 'IN_PROGRESS' ? 'Resume' : 'Fill' }}
                    </a>
                  }
                  @if (a.submissionId) {
                    <a class="ce-btn ce-btn-ghost ce-btn-sm" [routerLink]="['/checklists/submissions', a.submissionId]" data-testid="btn-view-submission">View</a>
                  }
                </span>
              </ng-template>
            </ce-table>
          </div>
        }
      </ce-page>
    </section>
  `,
})
export class AssignmentsPage {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly lookup = inject(LookupService);
  private readonly ui = inject(UiService);
  private readonly route = inject(ActivatedRoute);
  readonly statuses: AssignmentStatus[] = ['PENDING', 'IN_PROGRESS', 'OVERDUE', 'REDO', 'SUBMITTED', 'APPROVED'];
  readonly scopeOptions: TabItem[] = [
    { value: 'true', label: 'My checklists', testId: 'toggle-mine-true' },
    { value: 'false', label: 'All assignments', testId: 'toggle-mine-false' },
  ];
  readonly canAssign = computed(() => this.auth.can('assignChecklists'));
  readonly mine = signal(!this.auth.can('assignChecklists'));
  readonly status = signal<AssignmentStatus | null>(null);
  private readonly templates = signal<Template[]>([]);

  readonly data = loadOn(
    () => ({ mine: this.mine() || !this.canAssign(), status: this.status() }),
    (q) => this.api.get<Assignment[]>('/checklists/assignments', { mine: q.mine, status: q.status }),
  );
  readonly busy = computed(() => this.data.loading() && !this.data.data());
  readonly rows = computed(() => sortAssignments(this.data.data() ?? []));
  readonly rowId = (a: Assignment) => `row-assignment-${a.id}`;
  readonly cols = computed<CeColumn<Assignment>[]>(() => withMobileLabels<Assignment>(
    [
      { key: 'templateName', header: 'Checklist', type: 'custom', sortable: true, locked: true, searchable: true, value: (a) => `${a.templateName} ${a.storeName}` },
      { key: 'storeName', header: 'Store', sortable: true, hidden: true },
      { key: 'assigneeName', header: 'Assigned to', type: 'avatar', sortable: true, hidden: !this.canAssign() },
      { key: 'due', header: 'Due (store time)', type: 'custom', sortable: true, value: (a) => assignmentDueIso(a) },
      { key: 'status', header: 'Status', type: 'custom', sortable: true, value: (a) => a.status, searchable: true },
      { key: 'action', header: 'Action', type: 'actions', align: 'right', locked: true, value: () => '' },
    ],
    ['storeName'],
  ));

  constructor() {
    if (this.canAssign()) {
      this.lookup.loadStores().subscribe();
      this.lookup.loadUsers();
      this.api.get<Template[]>('/checklists/templates').subscribe((t) => {
        this.templates.set(t.filter((x) => x.isActive));
        const pre = Number(this.route.snapshot.queryParamMap.get('assign'));
        if (pre) this.assign(pre);
      });
    }
  }

  countOf(s: AssignmentStatus[]): number | undefined {
    const d = this.data.data();
    return d ? d.filter((a) => s.includes(a.status)).length : undefined;
  }
  label(s: string): string {
    return s === 'IN_PROGRESS' ? 'In progress (draft)' : humanize(s);
  }
  due(a: Assignment) {
    return dueInfo(assignmentDueIso(a), !FILLABLE.includes(a.status));
  }
  dueTitle(a: Assignment): string {
    return `Due ${a.dueAt ? storeDateTime(a.dueAt) : storeDate(a.dueDate)} (store time)`;
  }
  dt(iso: string): string {
    return storeDateTime(iso);
  }
  date(d: string): string {
    return storeDate(d);
  }

  canFill(a: Assignment): boolean {
    return a.assigneeId === this.auth.user()?.id && FILLABLE.includes(a.status);
  }

  assign(templateId?: number): void {
    const fields: FieldDef[] = [
      { key: 'templateId', label: 'Checklist', type: 'select', required: true, full: true, options: () => this.templates().map((t) => ({ value: t.id, label: t.name })) },
      { key: 'storeId', label: 'Store', type: 'select', required: true, options: () => this.lookup.scopedStores().map((s) => ({ value: s.id, label: s.name })) },
      {
        key: 'assigneeId',
        label: 'Assignee',
        type: 'select',
        required: true,
        options: (v) => this.lookup.usersForStore(v['storeId'] as number).map((u) => ({ value: u.id, label: `${u.name} (${u.role.replace(/_/g, ' ').toLowerCase()})` })),
      },
      { key: 'dueDate', label: 'Due date', type: 'date', required: true, min: undefined },
    ];
    this.ui
      .form({
        title: 'Assign checklist',
        entity: 'assignment',
        fields,
        value: { templateId: templateId ?? null, storeId: null, assigneeId: null, dueDate: toIsoDate(new Date()) },
        submitLabel: 'Assign',
        submit: (v) => this.api.post('/checklists/assignments', v, null, silent()),
      })
      .subscribe(() => {
        this.ui.toast('Checklist assigned');
        this.data.reload();
      });
  }
}
