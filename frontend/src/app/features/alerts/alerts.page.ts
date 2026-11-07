import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Alert, AlertStatus, Detection, Paged, SEVERITIES, Severity, SnapshotImage, Ticket } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { NotificationService } from '../../core/services/notification.service';
import { humanize } from '../../core/utils/format';
import { DS } from '../../shared/ds';
import { DateTimePipe } from '../../shared/pipes';
import { UiService } from '../../shared/ui/ui.service';
import { useOpsStyles } from '../../shared/ds/ops.styles';

/** Store-local calendar day (YYYY-MM-DD) of an ISO timestamp, for evidence lookups. */
export function localDay(iso: string, tz = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** Evidence kind for an alert metric: AI breaches show detections, the rest camera snapshots. */
export function evidenceKind(metric: string): 'detections' | 'snapshots' | 'none' {
  if (metric === 'AI_MANAGER_BREACH' || metric === 'SOP_BREACH') return 'detections';
  if (['EDGE_OFFLINE', 'CHECKLIST_OVERDUE', 'CHECKLIST_NON_COMPLIANCE', 'FOOTFALL_DROP', 'CONVERSION_DROP'].includes(metric)) return 'none';
  return 'snapshots';
}

interface Evidence {
  kind: 'detections' | 'snapshots' | 'none';
  items: { id: number; url: string; caption: string; link: unknown[] | null; query: Record<string, unknown> | null }[];
}

/** Store Ops › Alerts: severity-striped alert center with filters, bulk acknowledge, detail drawer with evidence. */
@Component({
  selector: 'ce-alerts-page',
  imports: [FormsModule, RouterLink, MatPaginatorModule, MatIconModule, MatSelectModule, MatTooltipModule, MatCheckboxModule, MatProgressSpinnerModule, ...DS, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-alerts">
      <ce-page title="Alerts" description="Rule-engine alerts across your stores — acknowledge, resolve or raise a ticket" [lastRefreshed]="refreshedAt()">
        <ng-container pageActions>
          <button type="button" class="ce-btn ce-btn-secondary ce-icon-btn" (click)="reload()" matTooltip="Refresh" aria-label="Refresh" data-testid="btn-refresh"><mat-icon>refresh</mat-icon></button>
          @if (auth.can('evaluateAlerts')) {
            <button type="button" class="ce-btn ce-btn-secondary" (click)="evaluate()" [disabled]="evaluating()" data-testid="btn-evaluate-alerts"><mat-icon>bolt</mat-icon> Evaluate rules now</button>
          }
          @if (auth.can('adminMaster')) {
            <a class="ce-btn ce-btn-secondary" routerLink="/admin/alert-rules" data-testid="link-alert-rules"><mat-icon>rule</mat-icon> Alert rules</a>
          }
        </ng-container>

        <ce-stat-strip label="Alert summary">
          <ce-stat-tile variant="strip" id="alerts-open" label="Open" [value]="counts()?.open" [loading]="!counts()" />
          <ce-stat-tile variant="strip" id="alerts-critical" label="Critical open" [value]="counts()?.critical" [loading]="!counts()" hint="Open alerts with Critical severity" />
          <ce-stat-tile variant="strip" id="alerts-acknowledged" label="Acknowledged" [value]="counts()?.acknowledged" [loading]="!counts()" hint="Being handled, not yet resolved" />
          <ce-stat-tile variant="strip" id="alerts-resolved" label="Resolved" [value]="counts()?.resolved" [loading]="!counts()" />
        </ce-stat-strip>

        <ce-card [flush]="true">
          <div class="ops-toolbar">
            <mat-select class="ops-chip-select" [class.is-set]="status() !== null" [ngModel]="status()" (ngModelChange)="setFilter(status, $event)" placeholder="Status: All" data-testid="filter-alert-status" aria-label="Status">
              <mat-select-trigger><span class="ops-chip-label">Status:</span>{{ status() ? label(status()!) : 'All' }}</mat-select-trigger>
              <mat-option [value]="null">All</mat-option>
              <mat-option value="OPEN">Open</mat-option>
              <mat-option value="ACKNOWLEDGED">Acknowledged</mat-option>
              <mat-option value="RESOLVED">Resolved</mat-option>
            </mat-select>
            <mat-select class="ops-chip-select" [class.is-set]="severity() !== null" [ngModel]="severity()" (ngModelChange)="setFilter(severity, $event)" placeholder="Severity: All" data-testid="filter-alert-severity" aria-label="Severity">
              <mat-select-trigger><span class="ops-chip-label">Severity:</span>{{ severity() ? label(severity()!) : 'All' }}</mat-select-trigger>
              <mat-option [value]="null">All</mat-option>
              @for (s of severities; track s) {
                <mat-option [value]="s">{{ label(s) }}</mat-option>
              }
            </mat-select>
            <mat-select class="ops-chip-select" [class.is-set]="storeId() !== null" [ngModel]="storeId()" (ngModelChange)="setFilter(storeId, $event)" placeholder="Store: All stores" data-testid="filter-alert-store" aria-label="Store">
              <mat-select-trigger><span class="ops-chip-label">Store:</span>{{ storeName(storeId()) }}</mat-select-trigger>
              <mat-option [value]="null">All stores</mat-option>
              @for (s of lookup.scopedStores(); track s.id) {
                <mat-option [value]="s.id">{{ s.name }}</mat-option>
              }
            </mat-select>
            @if (!isDefault()) {
              <button type="button" class="ce-link-btn ops-clear" (click)="resetFilters()" data-testid="btn-clear-filters">Reset filters</button>
            }
            <span class="ops-spacer"></span>
            <span class="ce-count-badge" data-testid="alert-total">{{ data.data()?.total ?? 0 }} alerts</span>
          </div>

          @if (selected().size) {
            <div class="ce-bulkbar" data-testid="alerts-bulkbar">
              <span>{{ selected().size }} selected</span>
              <button type="button" class="ce-link-btn" (click)="clearSelection()">Clear</button>
              <span class="ops-spacer"></span>
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" [disabled]="bulkBusy() || !bulkAckable().length" (click)="bulkAck()" data-testid="btn-bulk-ack">
                @if (bulkBusy()) {
                  <mat-spinner diameter="14" />
                }
                Acknowledge {{ bulkAckable().length }}
              </button>
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" [disabled]="bulkBusy() || !bulkResolvable().length" (click)="bulkResolve()" data-testid="btn-bulk-resolve">Resolve {{ bulkResolvable().length }}</button>
            </div>
          }

          @if (data.error() && !data.data()) {
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          } @else {
            <!-- phones: the DS stacked-card layout (cells carry data-label) so Acknowledge / Resolve stay reachable -->
            <div class="ce-table-wrap m-cards bare ops-alerts-table">
            <div class="ce-table-scroll">
              <table class="ce-dtable ops-dtable" data-testid="table-alerts">
                <thead>
                  <tr>
                    <th class="ops-sev-cell">
                      @if (canAct()) {
                        <mat-checkbox [checked]="allSelected()" [indeterminate]="someSelected()" (change)="toggleAll($event.checked)" [disabled]="!actionable().length" aria-label="Select all alerts on this page" />
                      }
                    </th>
                    <th>Alert</th>
                    <th>Store</th>
                    <th>Raised</th>
                    <th>Status</th>
                    <th class="al-right t-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @if (data.loading() && !data.data()) {
                    @for (i of skeleton; track i) {
                      <tr class="skel-row">
                        <td class="ops-sev-cell"></td>
                        <td><span class="ce-skel" style="width: 70%"></span></td>
                        <td><span class="ce-skel" style="width: 60%"></span></td>
                        <td><span class="ce-skel" style="width: 60%"></span></td>
                        <td><span class="ce-skel" style="width: 40%"></span></td>
                        <td></td>
                      </tr>
                    }
                  }
                  @for (a of items(); track a.id) {
                    <tr
                      class="clickable"
                      [class.ops-highlight]="a.id === highlightId()"
                      [class.selected]="selected().has(a.id)"
                      [class.ops-dim]="a.status === 'RESOLVED'"
                      [attr.data-testid]="'row-alert-' + a.id"
                      [attr.data-highlight]="a.id === highlightId() || null"
                      (click)="open(a)"
                    >
                      <td class="ops-sev-cell" [class]="'ops-sev-cell ops-sev-' + a.severity" data-label="" (click)="$event.stopPropagation()">
                        @if (canAct() && a.status !== 'RESOLVED') {
                          <mat-checkbox [checked]="selected().has(a.id)" (change)="toggle(a.id, $event.checked)" [aria-label]="'Select ' + a.ruleName" />
                        }
                      </td>
                      <td class="wrap" data-label="">
                        <div class="ops-alert-main">
                          <div class="ops-alert-title">
                            <ce-pill [value]="a.severity" size="sm" data-testid="chip-severity" />
                            <span class="ops-ellipsis" [title]="a.ruleName">{{ a.ruleName }}</span>
                          </div>
                          <div class="ops-alert-msg" [title]="a.message">{{ a.message }}</div>
                          <div class="cell-sub">{{ metric(a.metric) }} · value {{ a.value }}</div>
                        </div>
                      </td>
                      <td class="ops-ellipsis" style="max-width: 200px" [title]="a.storeName" data-label="Store">{{ a.storeName }}</td>
                      <td data-label="Raised">
                        <div>{{ a.createdAt | dt: 'relative' }}</div>
                        <div class="cell-sub">{{ a.createdAt | dt }}</div>
                      </td>
                      <td data-label="Status">
                        <ce-pill [value]="a.status" size="sm" data-testid="chip-status" />
                        @if (a.acknowledgedByName) {
                          <div class="cell-sub">by {{ a.acknowledgedByName }}</div>
                        }
                      </td>
                      <td class="al-right t-actions" data-label="" (click)="$event.stopPropagation()">
                        <span class="ops-row-actions">
                          @if (a.status === 'OPEN') {
                            <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="ack(a)" [disabled]="busyId() === a.id" data-testid="btn-ack">Acknowledge</button>
                          }
                          @if (a.status !== 'RESOLVED') {
                            <button type="button" class="ce-btn ce-btn-ghost ce-btn-sm" (click)="resolve(a)" [disabled]="busyId() === a.id" data-testid="btn-resolve">Resolve</button>
                          }
                          @if (a.ticketId) {
                            <a class="ce-icon-btn sm" [routerLink]="['/tickets', a.ticketId]" matTooltip="Open ticket" aria-label="Open ticket" data-testid="link-ticket"><mat-icon>confirmation_number</mat-icon></a>
                          } @else {
                            <button type="button" class="ce-icon-btn sm" matTooltip="Create ticket" aria-label="Create ticket" (click)="ticket(a)" data-testid="btn-create-ticket"><mat-icon>add_card</mat-icon></button>
                          }
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
              @if (data.loaded() && !items().length && !data.loading()) {
                @if (isDefault()) {
                  <ce-empty-state icon="notifications_off" title="No open alerts" message="All clear. New alerts appear here as soon as a rule fires." />
                } @else {
                  <ce-empty-state kind="filtered" icon="filter_alt_off" title="No alerts match these filters" message="Try another status, severity or store.">
                    <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="resetFilters()">Reset filters</button>
                  </ce-empty-state>
                }
              }
            </div>
          }
          <div class="ops-pager">
            <mat-paginator [length]="data.data()?.total ?? 0" [pageIndex]="page() - 1" [pageSize]="pageSize()" [pageSizeOptions]="[10, 25, 50, 100]" (page)="onPage($event)" showFirstLastButtons data-testid="paginator-alerts" />
          </div>
        </ce-card>
      </ce-page>

      <ce-drawer [(open)]="drawerOpen" [title]="sel()?.ruleName ?? 'Alert'" [subtitle]="sel() ? sel()!.storeName + ' · #' + sel()!.id : null" size="lg" testId="drawer-alert">
        @if (sel(); as a) {
          <div class="ops-drawer-section">
            <div class="ops-row" style="margin-bottom: 12px">
              <ce-pill [value]="a.severity" size="sm" />
              <ce-pill [value]="a.status" size="sm" />
              @if (a.ticketId) {
                <ce-pill tone="info" label="Ticket raised" icon="confirmation_number" size="sm" />
              }
            </div>
            <p style="margin: 0 0 12px; line-height: 20px">{{ a.message }}</p>
            <dl class="ops-dl">
              <dt>Store</dt>
              <dd>{{ a.storeName }}</dd>
              <dt>Metric</dt>
              <dd>{{ metric(a.metric) }} · value {{ a.value }}</dd>
              <dt>Raised</dt>
              <dd>{{ a.createdAt | dt }} <span class="caption">({{ a.createdAt | dt: 'relative' }})</span></dd>
              <dt>Rule</dt>
              <dd>{{ a.ruleName }}</dd>
            </dl>
          </div>
          <div class="ops-drawer-section">
            <h3 class="ops-section-title">Progress</h3>
            <ul class="ops-timeline">
              <li class="done"><span class="material-symbols-outlined">notifications_active</span><span><b>Raised</b> · {{ a.createdAt | dt }}</span></li>
              <li [class.done]="!!a.acknowledgedAt"><span class="material-symbols-outlined">{{ a.acknowledgedAt ? 'check_circle' : 'radio_button_unchecked' }}</span><span><b>Acknowledged</b> · {{ a.acknowledgedAt ? (a.acknowledgedAt | dt) + (a.acknowledgedByName ? ' by ' + a.acknowledgedByName : '') : 'not yet' }}</span></li>
              <li [class.done]="!!a.resolvedAt"><span class="material-symbols-outlined">{{ a.resolvedAt ? 'check_circle' : 'radio_button_unchecked' }}</span><span><b>Resolved</b> · {{ a.resolvedAt ? (a.resolvedAt | dt) : 'not yet' }}</span></li>
            </ul>
          </div>
          <div class="ops-drawer-section" data-testid="alert-evidence">
            <h3 class="ops-section-title">Evidence</h3>
            @if (evidenceLoading()) {
              <div class="ops-evidence-strip">
                <span class="ce-skel" style="aspect-ratio: 16/9; height: auto"></span><span class="ce-skel" style="aspect-ratio: 16/9; height: auto"></span>
              </div>
            } @else if (evidence()?.items?.length) {
              <div class="ops-evidence-strip">
                @for (e of evidence()!.items; track e.id) {
                  <a [routerLink]="e.link" [queryParams]="e.query" [title]="e.caption" (click)="drawerOpen.set(false)">
                    <span class="ops-media"><img [src]="e.url" [alt]="e.caption" loading="lazy" /></span>
                    <span class="caption">{{ e.caption }}</span>
                  </a>
                }
              </div>
            } @else {
              <p class="ops-help" style="margin: 0">{{ evidence()?.kind === 'none' ? 'This alert is based on counts, not camera images.' : 'No camera images were captured for this store on that day.' }}</p>
            }
          </div>
        }
        <ng-container drawerFooter>
          @if (sel(); as a) {
            @if (a.ticketId) {
              <a class="ce-btn ce-btn-ghost" [routerLink]="['/tickets', a.ticketId]">View ticket</a>
            } @else {
              <button type="button" class="ce-btn ce-btn-ghost" (click)="ticket(a)" data-testid="btn-drawer-ticket"><mat-icon>add_card</mat-icon> Create ticket</button>
            }
            @if (a.status === 'OPEN') {
              <button type="button" class="ce-btn ce-btn-secondary" (click)="ack(a)" [disabled]="busyId() === a.id" data-testid="btn-drawer-ack">Acknowledge</button>
            }
            @if (a.status !== 'RESOLVED') {
              <button type="button" class="ce-btn ce-btn-primary" (click)="resolve(a)" [disabled]="busyId() === a.id" data-testid="btn-drawer-resolve">Resolve</button>
            }
          }
        </ng-container>
      </ce-drawer>
    </section>
  `,
})
export class AlertsPage {
  protected readonly opsCss = useOpsStyles();
  protected readonly auth = inject(AuthService);
  protected readonly lookup = inject(LookupService);
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  readonly severities = SEVERITIES;
  readonly skeleton = [0, 1, 2, 3, 4, 5];

  /** Notification deep link /alerts/:alertId — shows all statuses and highlights the alert. */
  readonly highlightId = signal<number | null>(Number(inject(ActivatedRoute).snapshot.paramMap.get('alertId')) || null);
  readonly defaultStatus: AlertStatus | null = this.highlightId() ? null : 'OPEN';
  readonly status = signal<AlertStatus | null>(this.defaultStatus);
  readonly severity = signal<Severity | null>(null);
  readonly storeId = signal<number | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(25);
  readonly selected = signal<Set<number>>(new Set());
  readonly busyId = signal<number | null>(null);
  readonly bulkBusy = signal(false);
  readonly evaluating = signal(false);
  readonly drawerOpen = signal(false);
  readonly sel = signal<Alert | null>(null);
  readonly evidence = signal<Evidence | null>(null);
  readonly evidenceLoading = signal(false);
  private readonly tick = signal(0);

  readonly canAct = computed(() => this.auth.can('manageAlerts'));
  readonly data = loadOn(
    () => ({
      status: this.status(),
      severity: this.severity(),
      storeIds: this.storeId() ? [this.storeId()!] : undefined,
      page: this.page(),
      pageSize: this.pageSize(),
      t: this.tick(),
    }),
    ({ t: _t, ...q }) => this.api.get<Paged<Alert>>('/alerts', q),
  );
  readonly counts = loadOn(
    () => ({ t: this.tick(), store: this.storeId() }),
    ({ store }) => {
      const base = store ? { storeIds: [store] } : {};
      const total = (q: Record<string, unknown>) => this.api.get<Paged<Alert>>('/alerts', { ...base, ...q, pageSize: 1 }, silent()).pipe(map((p) => p.total), catchError(() => of(null)));
      return forkJoin({ open: total({ status: 'OPEN' }), critical: total({ status: 'OPEN', severity: 'CRITICAL' }), acknowledged: total({ status: 'ACKNOWLEDGED' }), resolved: total({ status: 'RESOLVED' }) });
    },
  ).data;
  readonly refreshedAt = signal<Date>(new Date());
  readonly items = computed(() => this.data.data()?.items ?? []);
  readonly actionable = computed(() => this.items().filter((a) => a.status !== 'RESOLVED'));
  readonly allSelected = computed(() => this.actionable().length > 0 && this.actionable().every((a) => this.selected().has(a.id)));
  readonly someSelected = computed(() => this.selected().size > 0 && !this.allSelected());
  readonly bulkAckable = computed(() => this.items().filter((a) => this.selected().has(a.id) && a.status === 'OPEN'));
  readonly bulkResolvable = computed(() => this.items().filter((a) => this.selected().has(a.id) && a.status !== 'RESOLVED'));
  readonly isDefault = computed(() => this.status() === this.defaultStatus && this.severity() === null && this.storeId() === null);

  constructor() {
    this.lookup.loadStores().subscribe();
    inject(NotificationService).alert$.pipe(takeUntilDestroyed()).subscribe(() => this.reload());
    // a new page of rows drops the selection; keep the drawer's alert in sync
    effect(() => {
      const list = this.items();
      untracked(() => {
        const keep = [...this.selected()].filter((id) => list.some((a) => a.id === id && a.status !== 'RESOLVED'));
        if (keep.length !== this.selected().size) this.selected.set(new Set(keep));
        const s = this.sel();
        const fresh = s ? list.find((a) => a.id === s.id) : null;
        if (fresh && fresh !== s) this.sel.set(fresh);
        this.refreshedAt.set(new Date());
      });
    });
    // scroll the deep-linked alert into view once it renders
    afterNextRender(() => {
      if (!this.highlightId()) return;
      const stop = effect(() => {
        if (!this.items().some((a) => a.id === this.highlightId())) return;
        queueMicrotask(() => (this.host.nativeElement as HTMLElement).querySelector(`[data-testid="row-alert-${this.highlightId()}"]`)?.scrollIntoView({ block: 'center' }));
        stop.destroy();
      }, { injector: this.injector });
    });
  }

  label(v: string): string {
    return humanize(v);
  }
  metric(m: string): string {
    return humanize(m).replace(/^Ai\b/, 'AI').replace(/^Sop\b/, 'SOP');
  }
  storeName(id: number | null): string {
    return id ? (this.lookup.scopedStores().find((s) => s.id === id)?.name ?? `Store ${id}`) : 'All stores';
  }

  reload(): void {
    this.tick.update((t) => t + 1);
  }

  setFilter<T>(sig: { set(v: T): void }, v: T): void {
    sig.set(v);
    this.page.set(1);
    this.selected.set(new Set());
  }

  resetFilters(): void {
    this.status.set(this.defaultStatus);
    this.severity.set(null);
    this.storeId.set(null);
    this.page.set(1);
  }

  onPage(e: PageEvent): void {
    this.page.set(e.pageIndex + 1);
    this.pageSize.set(e.pageSize);
  }

  toggle(id: number, on: boolean): void {
    const s = new Set(this.selected());
    if (on) s.add(id);
    else s.delete(id);
    this.selected.set(s);
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  toggleAll(on: boolean): void {
    this.selected.set(on ? new Set(this.actionable().map((a) => a.id)) : new Set());
  }

  open(a: Alert): void {
    this.sel.set(a);
    this.drawerOpen.set(true);
    this.loadEvidence(a);
  }

  private loadEvidence(a: Alert): void {
    const kind = evidenceKind(a.metric);
    this.evidence.set(null);
    if (kind === 'none') {
      this.evidence.set({ kind, items: [] });
      return;
    }
    const day = localDay(a.createdAt);
    this.evidenceLoading.set(true);
    const req: Observable<Evidence['items']> =
      kind === 'detections'
        ? this.api.get<Paged<Detection>>('/ai-manager/detections', { storeIds: [a.storeId], from: day, to: day, status: 'BREACHED', page: 1, pageSize: 4 }, silent()).pipe(
            map((p) => p.items.filter((d) => d.snapshotUrl).map((d) => ({ id: d.id, url: d.snapshotUrl!, caption: `${d.ruleName ?? humanize(d.type)} · ${new Date(d.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`, link: ['/ai-manager/detections'] as unknown[], query: { id: d.id } as Record<string, unknown> | null }))),
          )
        : this.api.get<Paged<SnapshotImage>>('/image-directory', { storeIds: [a.storeId], from: day, to: day, page: 1, pageSize: 4 }, silent()).pipe(
            map((p) => p.items.map((s) => ({ id: s.id, url: s.url, caption: `${s.cameraName} · ${new Date(s.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`, link: ['/traffic/image-directory'] as unknown[], query: null }))),
          );
    req.pipe(catchError(() => of([] as Evidence['items']))).subscribe((items) => {
      if (this.sel()?.id !== a.id) return;
      this.evidence.set({ kind, items });
      this.evidenceLoading.set(false);
    });
  }

  private act(a: Alert, verb: 'ack' | 'resolve'): void {
    if (this.busyId() === a.id) return;
    this.busyId.set(a.id);
    this.api.patch<Alert>(`/alerts/${a.id}/${verb}`).subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.ui.toast(verb === 'ack' ? 'Alert acknowledged' : 'Alert resolved');
        if (this.sel()?.id === a.id && res) this.sel.set({ ...a, ...res });
        this.reload();
      },
      error: () => this.busyId.set(null),
    });
  }

  ack(a: Alert): void {
    this.act(a, 'ack');
  }

  resolve(a: Alert): void {
    this.act(a, 'resolve');
  }

  private bulk(list: Alert[], verb: 'ack' | 'resolve'): void {
    if (!list.length || this.bulkBusy()) return;
    this.bulkBusy.set(true);
    forkJoin(list.map((a) => this.api.patch<Alert>(`/alerts/${a.id}/${verb}`, {}, silent()).pipe(map(() => true), catchError(() => of(false))))).subscribe((res) => {
      this.bulkBusy.set(false);
      const ok = res.filter(Boolean).length;
      const failed = res.length - ok;
      this.ui.toast(`${ok} alert(s) ${verb === 'ack' ? 'acknowledged' : 'resolved'}${failed ? ` · ${failed} failed` : ''}`);
      this.selected.set(new Set());
      this.reload();
    });
  }

  bulkAck(): void {
    this.bulk(this.bulkAckable(), 'ack');
  }

  bulkResolve(): void {
    const list = this.bulkResolvable();
    this.ui.confirm({ title: `Resolve ${list.length} alert(s)?`, message: 'Resolved alerts leave the open list. Raise a ticket first if work is still pending.', confirmText: 'Resolve' }).subscribe(() => this.bulk(list, 'resolve'));
  }

  ticket(a: Alert): void {
    this.ui
      .confirm({ title: 'Create ticket', message: `Raise a ticket for "${a.ruleName}" at ${a.storeName}?`, confirmText: 'Create ticket' })
      .subscribe(() =>
        this.api.post<Ticket>(`/alerts/${a.id}/ticket`).subscribe((t) => {
          this.ui.toast(`Ticket ${t.number ?? '#' + t.id} created`);
          if (this.sel()?.id === a.id) this.sel.set({ ...a, ticketId: t.id, status: a.status === 'OPEN' ? 'ACKNOWLEDGED' : a.status });
          this.reload();
        }),
      );
  }

  evaluate(): void {
    if (this.evaluating()) return;
    this.evaluating.set(true);
    this.api.post<{ created: number }>('/alerts/evaluate').subscribe({
      next: (r) => {
        this.evaluating.set(false);
        this.ui.toast(`${r.created} new alert(s)`);
        this.reload();
      },
      error: () => this.evaluating.set(false),
    });
  }
}
