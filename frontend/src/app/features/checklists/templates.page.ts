import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { CHECKLIST_CATEGORIES, Template } from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { loadOn } from '../../core/services/loader';
import { humanize } from '../../core/utils/format';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { storeDate, withMobileLabels } from './_ui/ops';
import { LIST_STYLES } from './_ui/styles';

type Row = Template & { questionCount: number; maxScore: number; sections: number; photos: number; ai: number; status: 'PUBLISHED' | 'DRAFT' };

export function templateRows(list: Template[] | null | undefined): Row[] {
  return (list ?? []).map((t) => {
    const qs = t.questions ?? [];
    return {
      ...t,
      questionCount: qs.length,
      maxScore: qs.reduce((s, q) => s + (Number(q.weight) || 0), 0),
      sections: new Set(qs.map((q) => q.section || 'General')).size,
      photos: qs.filter((q) => q.type === 'PHOTO' || q.type === 'VIDEO' || q.requiresPhoto).length,
      ai: qs.filter((q) => q.aiCheck && q.aiCheck !== 'NONE').length,
      status: t.isActive ? 'PUBLISHED' : 'DRAFT',
    };
  });
}

/** Trax › Manage › Checklists (management-list pattern): stat strip → status tabs → toolbar → table. */
@Component({
  selector: 'ce-templates-page',
  imports: [FormsModule, RouterLink, MatFormFieldModule, MatSelectModule, MatIconModule, MatTooltipModule, ...DS, ...LIST_STYLES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles />
    <section class="ops-page" data-testid="page-checklist-templates">
      <ce-page title="Checklists" description="Audit and SOP checklists with sections, weighted scoring, photo evidence and AI checks">
        <ng-container pageActions>
          <a class="ce-btn ce-btn-secondary" routerLink="/checklists/assignments" data-testid="link-assignments"><mat-icon>assignment_ind</mat-icon> Assignments</a>
          @if (canManage()) {
            <a class="ce-btn ce-btn-primary" routerLink="/checklists/templates/new" data-testid="btn-create-template"><mat-icon>add</mat-icon> Create checklist</a>
          }
        </ng-container>

        <ce-stat-strip label="Checklist summary" data-testid="templates-summary">
          <ce-stat-tile variant="strip" id="tpl-total" label="Checklists" [value]="all().length" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="tpl-published" label="Published" [value]="count('PUBLISHED')" [loading]="busy()" hint="Active checklists that can be assigned and scheduled" />
          <ce-stat-tile variant="strip" id="tpl-draft" label="Drafts" [value]="count('DRAFT')" [loading]="busy()" hint="Saved but not yet published" />
          <span class="ce-stat-strip-sep" aria-hidden="true"></span>
          <ce-stat-tile variant="strip" id="tpl-questions" label="Questions" [value]="totalQuestions()" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="tpl-ai" label="With AI checks" [value]="withAi()" [loading]="busy()" hint="Checklists with at least one AI photo check" />
        </ce-stat-strip>

        @if (data.error() && !data.data()) {
          <div class="ops-card">
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </div>
        } @else {
          <div class="ops-card">
            <ce-tabs [tabs]="tabs()" [(value)]="tab" queryParam="status" label="Checklist status" data-testid="templates-tabs" />
            <ce-table
              [rows]="rows()"
              [columns]="cols"
              [loading]="busy()"
              title="Checklist info"
              [subtitle]="subtitle()"
              [searchable]="true"
              searchPlaceholder="Search by checklist"
              searchTestId="input-search"
              testId="table-templates"
              [rowTestId]="rowId"
              [bare]="true"
              [pageSize]="25"
              [defaultSort]="{ key: 'name', dir: 'asc' }"
              sortStart="asc"
              emptyIcon="fact_check"
              [emptyTitle]="filtered() ? 'No checklists match these filters' : 'No checklists yet'"
              [emptyMessage]="filtered() ? 'Clear the filters to see every checklist.' : canManage() ? 'Create a checklist to start running audits in your stores.' : 'Checklists created by your HQ team will show here.'"
            >
              <div tableFilters class="ops-toolbar" style="margin-top: 8px">
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="ops-filter">
                  <mat-select [ngModel]="category()" (ngModelChange)="category.set($event)" placeholder="All categories" data-testid="filter-template-category" aria-label="Category">
                    <mat-option [value]="null">All categories</mat-option>
                    @for (c of categories; track c) {
                      <mat-option [value]="c">{{ label(c) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                @if (filtered()) {
                  <button type="button" class="ce-link-btn" (click)="clearFilters()" data-testid="btn-clear-filters">Clear filters</button>
                }
              </div>
              <ng-template ceCell="name" let-t>
                <div class="ops-cell-title" [title]="t.name + (t.description ? ' — ' + t.description : '')">
                  <a class="t" [routerLink]="['/checklists/templates', t.id]" data-testid="link-template" (click)="$event.stopPropagation()">{{ t.name }}</a>
                  @if (t.description) {
                    <span class="s">{{ t.description }}</span>
                  }
                </div>
              </ng-template>
              <ng-template ceCell="questionCount" let-t>
                <span><span class="tabular">{{ t.questionCount }}</span><span class="caption"> · {{ t.sections }} section{{ t.sections === 1 ? '' : 's' }} · {{ t.maxScore }} pts</span></span>
              </ng-template>
              <ng-template ceCell="evidence" let-t>
                @if (t.photos || t.ai) {
                  <span class="ops-with-icon" [matTooltip]="t.photos + ' photo/video question(s) · ' + t.ai + ' AI check(s)'">
                    @if (t.photos) {
                      <span class="material-symbols-outlined">photo_camera</span>{{ t.photos }}
                    }
                    @if (t.ai) {
                      <span class="material-symbols-outlined" style="color: var(--c-primary-ink)">auto_awesome</span>{{ t.ai }}
                    }
                  </span>
                } @else {
                  <span class="dash">--</span>
                }
              </ng-template>
              <ng-template ceCell="action" let-t>
                <span class="ops-row-actions">
                  @if (canAssign()) {
                    <a class="ce-icon-btn sm" matTooltip="Assign" aria-label="Assign" [routerLink]="['/checklists/assignments']" [queryParams]="{ assign: t.id }" (click)="$event.stopPropagation()" data-testid="btn-assign"><mat-icon>assignment_add</mat-icon></a>
                  }
                  @if (canManage()) {
                    <button type="button" class="ce-icon-btn sm" matTooltip="Edit" aria-label="Edit" (click)="edit(t)" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
                    <button type="button" class="ce-icon-btn sm" matTooltip="Delete" aria-label="Delete" (click)="remove(t)" [disabled]="deleting() === t.id" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
                  } @else {
                    <button type="button" class="ce-icon-btn sm" matTooltip="View" aria-label="View" (click)="edit(t)" data-testid="btn-view"><mat-icon>visibility</mat-icon></button>
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
export class TemplatesPage {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);
  readonly categories = CHECKLIST_CATEGORIES;
  readonly category = signal<string | null>(null);
  readonly tab = signal('all');
  readonly deleting = signal<number | null>(null);
  readonly canManage = computed(() => this.auth.can('manageTemplates'));
  readonly canAssign = computed(() => this.auth.can('assignChecklists'));
  readonly data = loadOn(() => ({}), () => this.api.get<Template[]>('/checklists/templates'));
  readonly busy = computed(() => this.data.loading() && !this.data.data());
  readonly all = computed(() => templateRows(this.data.data()));
  readonly filtered = computed(() => !!this.category() || this.tab() !== 'all');
  readonly rows = computed(() => {
    const c = this.category();
    const t = this.tab();
    return this.all().filter((r) => (!c || r.category === c) && (t === 'all' || (t === 'published' ? r.isActive : !r.isActive)));
  });
  readonly totalQuestions = computed(() => this.all().reduce((s, r) => s + r.questionCount, 0));
  readonly withAi = computed(() => this.all().filter((r) => r.ai > 0).length);
  readonly subtitle = computed(() => (this.data.data() ? `${this.rows().length} of ${this.all().length} checklists` : null));
  readonly tabs = computed<TabItem[]>(() => [
    { value: 'all', label: 'All checklists', count: this.data.data() ? this.all().length : null, testId: 'tab-templates-all' },
    { value: 'published', label: 'Published', count: this.data.data() ? this.count('PUBLISHED') : null, testId: 'tab-templates-published' },
    { value: 'draft', label: 'Drafts', count: this.data.data() ? this.count('DRAFT') : null, testId: 'tab-templates-draft' },
  ]);
  readonly rowId = (t: Row) => `row-template-${t.id}`;
  readonly cols: CeColumn<Row>[] = withMobileLabels<Row>([
    { key: 'name', header: 'Checklist name', type: 'custom', sortable: true, locked: true, searchable: true, value: (t) => `${t.name} ${t.description ?? ''}` },
    { key: 'category', header: 'Category', sortable: true, format: (v) => humanize(String(v)), searchable: true },
    { key: 'frequency', header: 'Frequency', sortable: true, format: (v) => humanize(String(v)) },
    { key: 'questionCount', header: 'Questions', type: 'custom', sortable: true },
    { key: 'maxScore', header: 'Max score', type: 'number', sortable: true, align: 'left', hidden: true },
    { key: 'evidence', header: 'Evidence', type: 'custom', value: (t) => t.photos + t.ai },
    { key: 'status', header: 'Status', type: 'pill', sortable: true },
    { key: 'createdAt', header: 'Created on', sortable: true, format: (v) => storeDate(String(v ?? '')), hidden: true },
    { key: 'action', header: 'Action', type: 'actions', align: 'right', locked: true, value: () => '' },
  ], ['evidence', 'frequency']);

  count(s: 'PUBLISHED' | 'DRAFT'): number {
    return this.all().filter((r) => r.status === s).length;
  }
  label(c: string): string {
    return humanize(c);
  }
  clearFilters(): void {
    this.category.set(null);
    this.tab.set('all');
    void this.router.navigate([], { queryParams: { status: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  edit(t: Template): void {
    void this.router.navigate(['/checklists/templates', t.id]);
  }

  remove(t: Template): void {
    this.ui
      .confirm({ title: 'Delete checklist?', message: `Delete "${t.name}"? Existing submissions and their scores are kept.`, confirmText: 'Delete', danger: true })
      .subscribe(() => {
        this.deleting.set(t.id);
        this.api.delete(`/checklists/templates/${t.id}`).subscribe({
          next: () => {
            this.deleting.set(null);
            this.ui.toast('Template deleted');
            this.data.reload();
          },
          error: () => this.deleting.set(null),
        });
      });
  }
}
