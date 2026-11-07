import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AiManagerRule } from '../../core/models/api.models';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { AI_PARAM_LABELS, AI_TYPE_INFO, daysLabel } from '../../core/utils/v2-helpers';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { catchError, forkJoin, map, of } from 'rxjs';
import { addDays, toIsoDate } from '../../core/utils/dates';
import { useOpsStyles } from '../../shared/ds/ops.styles';

export { DETECTION_ZONE_TYPES, emptyAiRule, validateAiRule } from './ai-rule.helpers';

type RuleFilter = 'all' | 'published' | 'draft';

/** AI Manager › Manage › AI checklists: rules list (management-list pattern) → full-page editor. */
@Component({
  selector: 'ce-ai-rules-page',
  imports: [RouterLink, MatIconModule, MatTooltipModule, MatSlideToggleModule, ...DS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-ai-rules">
      <ce-page title="AI checklists" description="CCTV-driven checklists: what to detect, where, when, and who to notify">
        <ng-container pageActions>
          @if (canManage()) {
            <a class="ce-btn ce-btn-primary" routerLink="/ai-manager/rules/new" data-testid="btn-create-ai-rule"><mat-icon>add</mat-icon> Create AI checklist</a>
          }
        </ng-container>
        <ce-stat-strip label="AI checklist summary">
          <ce-stat-tile variant="strip" id="ai-rules-total" label="AI checklists" [value]="all().length" [loading]="data.loading() && !data.data()" />
          <ce-stat-tile variant="strip" id="ai-rules-published" label="Published" [value]="published()" [loading]="data.loading() && !data.data()" />
          <ce-stat-tile variant="strip" id="ai-rules-draft" label="Drafts / paused" [value]="all().length - published()" [loading]="data.loading() && !data.data()" />
          <ce-stat-tile variant="strip" id="ai-rules-types" label="Detection types in use" [value]="typesInUse()" [loading]="data.loading() && !data.data()" />
        </ce-stat-strip>
        <div class="trax-panel ops-min0">
          <ce-tabs class="ops-scroll-tabs" [tabs]="tabs()" [value]="filterBy()" (valueChange)="filterBy.set($any($event))" label="Filter rules" />
          <ce-table
            [rows]="rows()"
            [columns]="cols"
            [loading]="data.loading() && !data.data()"
            title="AI checklist info"
            [searchable]="true"
            searchPlaceholder="Search by AI checklist"
            searchTestId="input-search-ai-rules"
            testId="table-ai-rules"
            [rowTestId]="rowId"
            [columnChooser]="true"
            [pageSize]="50"
            [bare]="true"
            [rowClickable]="true"
            (rowClick)="edit($event)"
            emptyIcon="smart_toy"
            emptyTitle="No AI checklists"
            emptyMessage="Create one to start detecting phone usage, store open/close, queues and more."
          >
            <ng-template ceCell="name" let-r>
              <div class="rule-name">
                <span class="re-ol-icon"><span class="material-symbols-outlined">{{ info[r.type]?.icon ?? 'smart_toy' }}</span></span>
                <div class="rule-name-text">
                  <a class="ce-text-link" [routerLink]="['/ai-manager/rules', r.id]" (click)="$event.stopPropagation()">{{ r.name }}</a>
                  <div class="cell-sub">{{ info[r.type]?.label ?? r.type }}</div>
                </div>
              </div>
            </ng-template>
            <ng-template ceCell="active" let-r>
              <span (click)="$event.stopPropagation()">
                <mat-slide-toggle [checked]="r.isActive" [disabled]="!canManage()" (change)="toggle(r, $event.checked)" data-testid="toggle-ai-rule-active" [aria-label]="'Published: ' + r.name" />
              </span>
            </ng-template>
            <ng-template ceCell="actions" let-r>
              <span class="row-actions" (click)="$event.stopPropagation()">
                <button type="button" class="ce-icon-btn sm" [matTooltip]="canManage() ? 'Edit' : 'View'" [attr.aria-label]="canManage() ? 'Edit' : 'View'" (click)="edit(r)" data-testid="btn-edit">
                  <mat-icon>{{ canManage() ? 'edit' : 'visibility' }}</mat-icon>
                </button>
                @if (canManage()) {
                  <button type="button" class="ce-icon-btn sm" matTooltip="Delete" aria-label="Delete" (click)="remove(r)" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
                }
              </span>
            </ng-template>
          </ce-table>
        </div>
      </ce-page>
    </section>
  `,
})
export class AiRulesPage {
  private readonly v2 = inject(V2Api);
  private readonly lookup = inject(LookupService);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  readonly info: Record<string, { label: string; icon: string; desc: string }> = AI_TYPE_INFO;
  readonly canManage = computed(() => this.auth.can('manageAiRules'));
  protected readonly opsCss = useOpsStyles();
  readonly data = loadOn(() => ({}), () => this.v2.aiRules());
  /** Breaches per rule over the last 7 days (one total-only request per rule). */
  private readonly breachData = loadOn(
    () => (this.data.data() ? { ids: this.data.data()!.map((r) => r.id) } : null),
    ({ ids }) => {
      const to = toIsoDate(new Date());
      const from = toIsoDate(addDays(new Date(), -6));
      if (!ids.length) return of({} as Record<number, number>);
      return forkJoin(ids.map((id) => this.v2.detections({ from, to, ruleId: id, status: 'BREACHED', page: 1, pageSize: 1 }).pipe(map((p) => [id, p.total] as const), catchError(() => of([id, null] as const))))).pipe(
        map((pairs) => Object.fromEntries(pairs.filter((p) => p[1] !== null)) as Record<number, number>),
      );
    },
  );
  readonly breaches = computed(() => this.breachData.data() ?? {});
  readonly filterBy = signal<RuleFilter>('all');
  readonly all = computed(() => this.data.data() ?? []);
  readonly published = computed(() => this.all().filter((r) => r.isActive).length);
  readonly typesInUse = computed(() => new Set(this.all().map((r) => r.type)).size);
  readonly rows = computed(() => {
    const f = this.filterBy();
    // newest first, so a rule just created is on the first page
    return this.all()
      .filter((r) => f === 'all' || (f === 'published' ? r.isActive : !r.isActive))
      .sort((a, b) => b.id - a.id);
  });
  readonly tabs = computed<TabItem[]>(() => [
    { value: 'all', label: 'All', count: this.all().length },
    { value: 'published', label: 'Published', count: this.published() },
    { value: 'draft', label: 'Drafts / paused', count: this.all().length - this.published() },
  ]);
  readonly rowId = (r: AiManagerRule) => `row-ai-rule-${r.id}`;

  readonly cols: CeColumn<AiManagerRule>[] = [
    { key: 'name', header: 'AI checklist', sortable: true, locked: true, wrap: true },
    {
      key: 'stores',
      header: 'Stores',
      value: (r) => (r.storeIds.length ? `${r.storeIds.length} store${r.storeIds.length === 1 ? '' : 's'}` : 'All stores'),
      secondary: (r) => (r.storeIds.length === 1 ? this.lookup.storeName()(r.storeIds[0]) : null),
      searchable: false,
    },
    { key: 'areas', header: 'Areas', value: (r) => (r.zoneIds.length ? `${r.zoneIds.length} zone${r.zoneIds.length === 1 ? '' : 's'}` : 'Full frame'), searchable: false },
    { key: 'window', header: 'Schedule', value: (r) => `${r.windowStart}–${r.windowEnd}`, secondary: (r) => daysLabel(r.daysOfWeek), searchable: false },
    { key: 'params', header: 'Settings', value: (r) => this.paramsText(r), searchable: false, hidden: true, wrap: true },
    { key: 'severity', header: 'Severity', type: 'pill', sortable: true },
    {
      key: 'breaches',
      header: 'Breaches',
      sub: '(7 days)',
      type: 'link-number',
      value: (r) => this.breaches()[r.id],
      click: (r) => void this.router.navigate(['/ai-manager/detections'], { queryParams: { ruleId: r.id, status: 'BREACHED' } }),
      sortable: true,
      searchable: false,
      align: 'right',
      cellTestId: () => 'ai-rule-breaches',
    },
    { key: 'notify', header: 'Notify', hidden: true, value: (r) => (r.notifyChannels ?? []).map((c) => (c === 'IN_APP' ? 'In-app' : c.charAt(0) + c.slice(1).toLowerCase())).join(', '), searchable: false },
    { key: 'active', header: 'Published', value: (r) => r.isActive, align: 'center' },
    { key: 'actions', header: 'Action', type: 'actions', value: () => 'x', align: 'right' },
  ];

  constructor() {
    this.lookup.loadStores().subscribe();
  }

  paramsText(r: AiManagerRule): string {
    return Object.entries(r.params ?? {})
      .map(([k, v]) => `${AI_PARAM_LABELS[k] ?? k}: ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : v}`)
      .join(' · ');
  }

  edit(r: AiManagerRule): void {
    void this.router.navigate(['/ai-manager/rules', r.id]);
  }

  toggle(r: AiManagerRule, isActive: boolean): void {
    const { id: _id, ...rest } = r;
    this.v2.saveAiRule({ ...rest, isActive }, r.id).subscribe({
      next: () => {
        this.ui.toast(isActive ? 'Rule activated' : 'Rule paused');
        this.data.reload();
      },
      error: () => this.data.reload(),
    });
  }

  remove(r: AiManagerRule): void {
    this.ui.confirm({ title: 'Delete AI checklist?', message: `Delete "${r.name}"? Past detections are kept.`, confirmText: 'Delete', danger: true }).subscribe(() =>
      this.v2.deleteAiRule(r.id).subscribe(() => {
        this.ui.toast('Rule deleted');
        this.data.reload();
      }),
    );
  }
}
