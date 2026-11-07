import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subject, debounceTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuditLog, Paged } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { CeColumn, DS, Tone } from '../../shared/ds';
import { DateTimePipe } from '../../shared/pipes';
import { useOpsStyles } from '../../shared/ds/ops.styles';

export function auditDetails(d: unknown): string {
  if (d === null || d === undefined || d === '') return '';
  if (typeof d === 'string') {
    try {
      return JSON.stringify(JSON.parse(d));
    } catch {
      return d;
    }
  }
  return JSON.stringify(d);
}

export interface AuditPayload {
  method: string | null;
  path: string | null;
  body: Record<string, unknown> | null;
  /** Contract v4: the server's own snapshot of the changed fields (updates, deletes). */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/** The interceptor's `{ method, path, body }` details (string or object). */
export function parseAudit(d: unknown): AuditPayload {
  let o: unknown = d;
  if (typeof d === 'string') {
    try {
      o = JSON.parse(d);
    } catch {
      return { method: null, path: null, body: null };
    }
  }
  if (!o || typeof o !== 'object') return { method: null, path: null, body: null };
  const r = o as Record<string, unknown>;
  const body = r['body'] && typeof r['body'] === 'object' && !Array.isArray(r['body']) ? (r['body'] as Record<string, unknown>) : null;
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  return { method: typeof r['method'] === 'string' ? r['method'] : null, path: typeof r['path'] === 'string' ? r['path'] : null, body, before: obj(r['before']) ?? undefined, after: obj(r['after']) ?? undefined };
}

/**
 * Diff from the server's `before` / `after` (contract v4): those hold only the changed fields (the whole row on a
 * hard delete), so every key there is changed / removed; body fields the server saw as unchanged are listed as same.
 */
export function serverDiff(p: AuditPayload, action: string): DiffRow[] | null {
  if (!p.before) return null;
  if (action === 'DELETE') return Object.entries(p.before).map(([k, v]) => ({ key: k, before: show(v), after: null, kind: 'removed' as const })).sort((x, y) => x.key.localeCompare(y.key));
  const after = p.after ?? {};
  const rows: DiffRow[] = [...new Set([...Object.keys(p.before), ...Object.keys(after)])].map((k) => ({ key: k, before: show(p.before![k]), after: show(after[k]), kind: 'changed' as const }));
  for (const [k, v] of Object.entries(p.body ?? {})) if (!rows.some((r) => r.key === k)) rows.push({ key: k, before: show(v), after: show(v), kind: 'same' });
  const order: Record<DiffKind, number> = { changed: 0, added: 1, removed: 2, same: 3 };
  return rows.sort((x, y) => order[x.kind] - order[y.kind] || x.key.localeCompare(y.key));
}

export type DiffKind = 'added' | 'changed' | 'removed' | 'same';
export interface DiffRow {
  key: string;
  before: string | null;
  after: string | null;
  kind: DiffKind;
}

const show = (v: unknown): string | null => (v === undefined ? null : v === null ? 'null' : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Field-level diff of one change. `before` is the record as rebuilt from the earlier audit entries of the same
 * record (null when unknown); `body` the fields sent with this change. DELETE marks every known field removed.
 */
export function auditDiff(before: Record<string, unknown> | null, body: Record<string, unknown> | null, action: string): DiffRow[] {
  if (action === 'DELETE') return Object.entries(before ?? {}).map(([k, v]) => ({ key: k, before: show(v), after: null, kind: 'removed' as const }));
  const rows: DiffRow[] = [];
  for (const [k, v] of Object.entries(body ?? {})) {
    const had = before && k in before;
    const b = had ? show(before![k]) : null;
    const a = show(v);
    rows.push({ key: k, before: b, after: a, kind: !had ? 'added' : b === a ? 'same' : 'changed' });
  }
  const order: Record<DiffKind, number> = { changed: 0, added: 1, removed: 2, same: 3 };
  return rows.sort((x, y) => order[x.kind] - order[y.kind] || x.key.localeCompare(y.key));
}

/** Rebuilds a record's state just before entry `id` from its older CREATE / UPDATE entries (oldest first). */
export function stateBefore(entries: AuditLog[], id: number): Record<string, unknown> | null {
  const older = entries.filter((e) => e.id < id && (e.action === 'CREATE' || e.action === 'UPDATE')).sort((a, b) => a.id - b.id);
  if (!older.length) return null;
  return older.reduce<Record<string, unknown>>((acc, e) => ({ ...acc, ...(parseAudit(e.details).body ?? {}) }), {});
}

export function actionTone(a: string): Tone {
  return a === 'CREATE' ? 'good' : a === 'DELETE' ? 'critical' : a === 'UPDATE' ? 'info' : a === 'LOGIN' ? 'neutral' : 'warning';
}

/** Admin › Audit log: who changed what and when; a row opens the change with a field-level diff. */
@Component({
  selector: 'ce-audit-log-page',
  imports: [FormsModule, MatPaginatorModule, MatSelectModule, MatIconModule, MatTooltipModule, ...DS, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <section data-testid="page-admin-audit-log">
      <ce-page title="Audit log" description="Every create, update and delete made in the app, with who did it and what changed">
        <ce-card [flush]="true">
          <div class="ops-toolbar">
            <mat-select class="ops-chip-select" [class.is-set]="userId() !== null" [ngModel]="userId()" (ngModelChange)="userId.set($event); page.set(1)" placeholder="User: Everyone" data-testid="filter-audit-user" aria-label="User">
              <mat-select-trigger><span class="ops-chip-label">User:</span>{{ userName() }}</mat-select-trigger>
              <mat-option [value]="null">Everyone</mat-option>
              @for (u of lookup.users(); track u.id) {
                <mat-option [value]="u.id">{{ u.name }}</mat-option>
              }
            </mat-select>
            <input class="ops-chip-input" type="search" [ngModel]="entityInput()" (ngModelChange)="entityInput.set($event); entity$.next($event)" placeholder="Entity, e.g. stores" aria-label="Entity" data-testid="filter-audit-entity" />
            @if (userId() !== null || entity()) {
              <button type="button" class="ce-link-btn ops-clear" (click)="clear()" data-testid="btn-clear-filters">Clear filters</button>
            }
            <span class="ops-spacer"></span>
            <span class="ce-count-badge" data-testid="audit-total">{{ data.data()?.total ?? 0 }} entries</span>
          </div>
          @if (data.error() && !data.data()) {
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          } @else {
            <ce-table
              [rows]="items()"
              [columns]="cols"
              [loading]="data.loading() && !data.data()"
              [paginate]="false"
              [toolbar]="false"
              [bare]="true"
              testId="table-admin-audit-log"
              [rowTestId]="rowId"
              [rowClickable]="true"
              (rowClick)="open($event)"
              emptyIcon="history"
              [emptyTitle]="userId() !== null || entity() ? 'No entries for these filters' : 'No audit entries yet'"
            >
              <ng-template ceCell="user" let-a>
                <span class="cell-avatar"><ce-avatar [name]="a.userName || 'System'" [size]="24" /><span class="ops-ellipsis">{{ a.userName || 'System' }}</span></span>
              </ng-template>
              <ng-template ceCell="action" let-a><ce-pill [value]="a.action" [tone]="tone(a.action)" [label]="a.action" [dot]="false" size="sm" class="ops-action-pill" /></ng-template>
              <ng-template ceCell="summary" let-a><span class="caption ops-ellipsis" style="max-width: 420px; display: inline-block" [title]="details(a.details)">{{ summary(a) }}</span></ng-template>
            </ce-table>
          }
          <div class="ops-pager">
            <mat-paginator [length]="data.data()?.total ?? 0" [pageIndex]="page() - 1" [pageSize]="pageSize()" [pageSizeOptions]="[25, 50, 100]" (page)="onPage($event)" showFirstLastButtons data-testid="paginator-audit" />
          </div>
        </ce-card>
      </ce-page>

      <ce-drawer [(open)]="drawerOpen" [title]="sel() ? sel()!.action + ' · ' + sel()!.entity + (sel()!.entityId !== null ? ' #' + sel()!.entityId : '') : ''" [subtitle]="sel() ? ((sel()!.userName || 'System') + ' · ' + (sel()!.createdAt | dt)) : null" size="lg" testId="drawer-audit">
        @if (sel(); as a) {
          @let p = payload();
          <div class="ops-drawer-section">
            <dl class="ops-dl">
              <dt>When</dt>
              <dd>{{ a.createdAt | dt }}</dd>
              <dt>User</dt>
              <dd>{{ a.userName || 'System' }}</dd>
              <dt>Action</dt>
              <dd><ce-pill [tone]="tone(a.action)" [label]="a.action" [dot]="false" size="sm" /></dd>
              <dt>Request</dt>
              <dd class="ops-mono">{{ p.method ?? '--' }} {{ p.path ?? '' }}</dd>
            </dl>
          </div>
          <div class="ops-drawer-section" data-testid="audit-diff">
            <h3 class="ops-section-title">Changes</h3>
            @if (diffLoading()) {
              <ce-skeleton kind="text" [count]="4" />
            } @else if (diff().length) {
              <table class="ops-diff">
                <thead>
                  <tr><th>Field</th><th>Before</th><th>After</th></tr>
                </thead>
                <tbody>
                  @for (d of diff(); track d.key) {
                    <tr [attr.data-kind]="d.kind">
                      <td class="k">{{ d.key }}</td>
                      <td [class.del]="d.kind === 'changed' || d.kind === 'removed'" [class.same]="d.kind === 'same'">{{ d.before ?? '--' }}</td>
                      <td [class.add]="d.kind === 'changed' || d.kind === 'added'" [class.same]="d.kind === 'same'">{{ d.after ?? '--' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              @if (!hadHistory() && a.action === 'UPDATE') {
                <p class="caption" style="margin: 8px 0 0">Earlier values are unknown (the record was created before the audit history starts).</p>
              }
            } @else {
              <p class="ops-help" style="margin: 0">No field changes were recorded for this action.</p>
            }
          </div>
          @if (details(a.details)) {
            <div class="ops-drawer-section">
              <h3 class="ops-section-title">Raw details</h3>
              <pre class="ops-code">{{ pretty(a.details) }}</pre>
            </div>
          }
        }
      </ce-drawer>
    </section>
  `,
})
export class AuditLogPage {
  protected readonly opsCss = useOpsStyles();
  private readonly api = inject(ApiService);
  protected readonly lookup = inject(LookupService);
  readonly userId = signal<number | null>(null);
  readonly entityInput = signal('');
  readonly entity = signal('');
  readonly entity$ = new Subject<string>();
  readonly page = signal(1);
  readonly pageSize = signal(50);
  readonly drawerOpen = signal(false);
  readonly sel = signal<AuditLog | null>(null);
  readonly diff = signal<DiffRow[]>([]);
  readonly diffLoading = signal(false);
  readonly hadHistory = signal(false);
  readonly data = loadOn(
    () => ({ userId: this.userId(), entity: this.entity().trim(), page: this.page(), pageSize: this.pageSize() }),
    (q) => this.api.get<Paged<AuditLog>>('/audit-logs', q),
  );
  readonly items = computed(() => this.data.data()?.items ?? []);
  readonly payload = computed(() => parseAudit(this.sel()?.details));
  readonly userName = computed(() => this.lookup.users().find((u) => u.id === this.userId())?.name ?? 'Everyone');
  readonly rowId = (a: AuditLog) => `row-audit-${a.id}`;

  readonly cols: CeColumn<AuditLog>[] = [
    { key: 'createdAt', header: 'When', type: 'datetime' },
    { key: 'user', header: 'User', value: (a) => a.userName || 'System' },
    { key: 'action', header: 'Action' },
    { key: 'entity', header: 'Entity', value: (a) => `${a.entity}${a.entityId !== null && a.entityId !== undefined ? ' #' + a.entityId : ''}` },
    { key: 'summary', header: 'Details', value: (a) => this.summary(a) },
  ];

  constructor() {
    this.lookup.loadUsers();
    this.entity$.pipe(debounceTime(300), takeUntilDestroyed()).subscribe((v) => {
      this.entity.set(v);
      this.page.set(1);
    });
  }

  tone(a: string): Tone {
    return actionTone(a);
  }

  details(d: unknown): string {
    return auditDetails(d);
  }

  pretty(d: unknown): string {
    const s = auditDetails(d);
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return s;
    }
  }

  summary(a: AuditLog): string {
    const p = parseAudit(a.details);
    const keys = Object.keys(p.body ?? {});
    if (keys.length) return `${keys.length} field${keys.length === 1 ? '' : 's'}: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '…' : ''}`;
    return p.path ? `${p.method ?? ''} ${p.path}`.trim() : auditDetails(a.details) || '--';
  }

  clear(): void {
    this.userId.set(null);
    this.entityInput.set('');
    this.entity.set('');
    this.page.set(1);
  }

  onPage(e: PageEvent): void {
    this.page.set(e.pageIndex + 1);
    this.pageSize.set(e.pageSize);
  }

  open(a: AuditLog): void {
    this.sel.set(a);
    this.drawerOpen.set(true);
    const parsed = parseAudit(a.details);
    const body = parsed.body;
    const server = serverDiff(parsed, a.action);
    if (server) {
      this.hadHistory.set(true);
      this.diff.set(server);
      return;
    }
    if (a.entityId === null || a.entityId === undefined || (a.action !== 'UPDATE' && a.action !== 'DELETE')) {
      this.hadHistory.set(false);
      this.diff.set(auditDiff(null, body, a.action));
      return;
    }
    this.diffLoading.set(true);
    this.api.get<Paged<AuditLog>>('/audit-logs', { entity: a.entity, pageSize: 500 }, silent()).subscribe({
      next: (r) => {
        const same = r.items.filter((x) => String(x.entityId) === String(a.entityId));
        const before = stateBefore(same, a.id);
        this.hadHistory.set(!!before);
        this.diff.set(auditDiff(before, body, a.action));
        this.diffLoading.set(false);
      },
      error: () => {
        this.hadHistory.set(false);
        this.diff.set(auditDiff(null, body, a.action));
        this.diffLoading.set(false);
      },
    });
  }
}
