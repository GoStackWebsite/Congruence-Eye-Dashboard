import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { AI_MANAGER_TYPES, AiManagerRule, Detection } from '../../core/models/api.models';
import { FilterService } from '../../core/services/filter.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { safeStorage } from '../../core/utils/storage';
import { AI_TYPE_INFO } from '../../core/utils/v2-helpers';
import { CeColumn, DS } from '../../shared/ds';
import { DateTimePipe } from '../../shared/pipes';
import { UiService } from '../../shared/ui/ui.service';
import { useOpsStyles } from '../../shared/ds/ops.styles';

type Review = 'VALID' | 'FALSE_POSITIVE';

/** BREACHED → critical chip, COMPLIED → good chip. */
export function detectionChip(status: string): { value: string; label: string } {
  return status === 'BREACHED' ? { value: 'OVERDUE', label: 'Breached' } : { value: 'DONE', label: 'Complied' };
}

export const REVIEW_LABEL: Record<Review, string> = { VALID: 'Valid', FALSE_POSITIVE: 'False positive' };

interface EvidenceData {
  items: Detection[];
  index: number;
  canReview: boolean;
  storeCode: (id: number) => string | null;
  review: (d: Detection, r: Review) => void;
}

/** Evidence lightbox: image with previous / next, metadata side panel and Valid / False positive review. */
@Component({
  selector: 'ce-detection-evidence',
  imports: [MatDialogModule, MatIconModule, MatTooltipModule, DateTimePipe, ...DS],
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    @let d = current();
    <div class="lightbox" data-testid="dialog-detection">
      <div class="lb-stage">
        @if (d.snapshotUrl) {
          <img [src]="d.snapshotUrl" [alt]="(d.ruleName ?? info(d).label) + ' evidence'" data-testid="detection-evidence" />
        } @else {
          <div class="ops-media-empty"><span class="material-symbols-outlined">hide_image</span>No snapshot was captured for this detection</div>
        }
        @if (data.items.length > 1) {
          <button type="button" class="lb-nav l" (click)="move(-1)" [disabled]="index() === 0" aria-label="Previous detection" data-testid="btn-lightbox-prev"><mat-icon>chevron_left</mat-icon></button>
          <button type="button" class="lb-nav r" (click)="move(1)" [disabled]="index() === data.items.length - 1" aria-label="Next detection" data-testid="btn-lightbox-next"><mat-icon>chevron_right</mat-icon></button>
          <span class="lb-count">{{ index() + 1 }} / {{ data.items.length }}</span>
        }
      </div>
      <aside class="lb-meta" aria-label="Detection details">
        <div class="lb-head">
          <div class="ce-card-title">{{ info(d).label }}</div>
          <button type="button" class="ce-icon-btn sm" mat-dialog-close aria-label="Close" data-testid="btn-close"><mat-icon>close</mat-icon></button>
        </div>
        <div class="ops-lb-status">
          <span class="caption">Detection status</span>
          <ce-pill [value]="d.status" size="sm" data-testid="chip-detection-status" />
        </div>
        <dl>
          <dt>Store</dt>
          <dd>{{ d.storeName }}@if (data.storeCode(d.storeId); as c) {<span class="caption"> · {{ c }}</span>}</dd>
          <dt>Camera</dt>
          <dd>{{ d.cameraName || '--' }}</dd>
          <dt>Area</dt>
          <dd>{{ d.zoneName || 'Whole frame' }}</dd>
          <dt>Time</dt>
          <dd>{{ d.ts | dt }}</dd>
          <dt>Rule</dt>
          <dd>{{ d.ruleName || '--' }}</dd>
          <dt>Confidence</dt>
          <dd>{{ d.confidence !== null ? (d.confidence * 100).toFixed(0) + '%' : '--' }}</dd>
          @if (d.details) {
            <dt>Details</dt>
            <dd>{{ d.details }}</dd>
          }
        </dl>
        @if (data.canReview) {
          <div class="ops-stack" style="gap: 6px">
            <span class="caption">Review — false positives are excluded from compliance</span>
            <div class="ops-lb-review">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" [class.active-valid]="d.reviewStatus === 'VALID'" [disabled]="d.reviewStatus === 'VALID'" (click)="review(d, 'VALID')" data-testid="btn-lightbox-valid"><mat-icon>thumb_up</mat-icon> Valid</button>
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" [class.active-false]="d.reviewStatus === 'FALSE_POSITIVE'" [disabled]="d.reviewStatus === 'FALSE_POSITIVE'" (click)="review(d, 'FALSE_POSITIVE')" data-testid="btn-lightbox-false"><mat-icon>thumb_down</mat-icon> False positive</button>
            </div>
          </div>
        } @else if (d.reviewStatus) {
          <ce-pill [value]="d.reviewStatus" [label]="reviewLabel(d.reviewStatus)" size="sm" />
        }
        @if (d.snapshotUrl) {
          <a class="ce-btn ce-btn-secondary lb-dl" [href]="d.snapshotUrl" target="_blank" rel="noopener" [attr.download]="'detection-' + d.id + '.jpg'" data-testid="btn-detection-download"><mat-icon>download</mat-icon> Download</a>
        }
        <div class="caption">Use ← → to move between detections.</div>
      </aside>
    </div>
  `,
})
export class DetectionEvidenceComponent {
  protected readonly opsCss = useOpsStyles();
  readonly data = inject<EvidenceData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef);
  readonly index = signal(this.data.index);
  readonly items = signal(this.data.items);
  readonly current = computed(() => this.items()[this.index()]);
  info(d: Detection) {
    return AI_TYPE_INFO[d.type] ?? { label: d.type, icon: 'smart_toy', desc: '' };
  }
  reviewLabel(r: Review) {
    return REVIEW_LABEL[r];
  }
  move(n: number): void {
    this.index.update((i) => Math.min(this.items().length - 1, Math.max(0, i + n)));
  }
  onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowRight') this.move(1);
    if (e.key === 'ArrowLeft') this.move(-1);
  }
  review(d: Detection, r: Review): void {
    this.data.review(d, r);
    this.items.update((list) => list.map((x) => (x.id === d.id ? { ...x, reviewStatus: r } : x)));
  }
}

/** AI Manager › Detections: evidence gallery (reference 09) with filters as dropdown chips, lightbox and table view. */
@Component({
  selector: 'ce-detections-page',
  imports: [FormsModule, MatPaginatorModule, MatSelectModule, MatIconModule, MatTooltipModule, MatDialogModule, ...DS, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-ai-detections">
      <ce-page title="Detections" description="Evidence from CCTV-driven checks — review each as valid or a false positive" [lastRefreshed]="true">
        <ng-container pageActions>
          <ce-segmented [options]="views" [value]="view()" (valueChange)="setView($any($event))" label="View" data-testid="toggle-detection-view" />
        </ng-container>

        <ce-stat-strip label="Detection summary">
          <ce-stat-tile variant="strip" id="det-total" label="Detections" [value]="totals()?.total" [loading]="!totals()" hint="All detections in range, false positives included" />
          <ce-stat-tile variant="strip" id="det-breached" label="Breached" [value]="totals()?.breached" [loading]="!totals()" />
          <ce-stat-tile variant="strip" id="det-complied" label="Complied" [value]="totals()?.complied" [loading]="!totals()" />
          <ce-stat-tile variant="strip" id="det-compliance" label="Compliance" format="pct" [value]="totals()?.pct" [loading]="!totals()" hint="Complied ÷ (breached + complied); false positives excluded" />
        </ce-stat-strip>

        <ce-card [flush]="true">
          <div class="ops-toolbar">
            <mat-select class="ops-chip-select" [class.is-set]="type() !== null" [ngModel]="type()" (ngModelChange)="setFilter(type, $event)" placeholder="Type: All" data-testid="filter-detection-type" aria-label="Detection type">
              <mat-select-trigger><span class="ops-chip-label">Type:</span>{{ type() ? info[type()!].label : 'All' }}</mat-select-trigger>
              <mat-option [value]="null">All types</mat-option>
              @for (t of types; track t) {
                <mat-option [value]="t">{{ info[t].label }}</mat-option>
              }
            </mat-select>
            <mat-select class="ops-chip-select" [class.is-set]="status() !== null" [ngModel]="status()" (ngModelChange)="setFilter(status, $event)" placeholder="Status: All" data-testid="filter-detection-status" aria-label="Detection status">
              <mat-select-trigger><span class="ops-chip-label">Status:</span>{{ status() === 'BREACHED' ? 'Breached' : status() === 'COMPLIED' ? 'Complied' : 'All' }}</mat-select-trigger>
              <mat-option [value]="null">All</mat-option>
              <mat-option value="BREACHED">Breached</mat-option>
              <mat-option value="COMPLIED">Complied</mat-option>
            </mat-select>
            <mat-select class="ops-chip-select" [class.is-set]="ruleId() !== null" [ngModel]="ruleId()" (ngModelChange)="setFilter(ruleId, $event)" placeholder="Rule: All" data-testid="filter-detection-rule" aria-label="Rule">
              <mat-select-trigger><span class="ops-chip-label">Rule:</span>{{ ruleName() }}</mat-select-trigger>
              <mat-option [value]="null">All rules</mat-option>
              @for (r of rules(); track r.id) {
                <mat-option [value]="r.id">{{ r.name }}</mat-option>
              }
            </mat-select>
            @if (filtered()) {
              <button type="button" class="ce-link-btn ops-clear" (click)="clear()" data-testid="btn-clear-filters">Clear filters</button>
            }
            <span class="ops-spacer"></span>
            <span class="ce-count-badge" data-testid="detection-total">{{ data.data()?.total ?? 0 }} detections</span>
          </div>

          @if (data.error() && !data.data()) {
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          } @else if (view() === 'gallery') {
            <div class="ops-gallery" data-testid="detection-gallery">
              @for (d of items(); track d.id; let i = $index) {
                <article class="ops-det-card" [class.highlight]="d.id === highlightId()" [attr.data-testid]="'detection-item-' + d.id">
                  <button type="button" class="ops-det-open" (click)="openEvidence(i)" [attr.aria-label]="'Open evidence for ' + (d.ruleName ?? info[d.type].label) + ', ' + d.storeName">
                    <span class="ops-media" [class.no-snap]="!d.snapshotUrl">
                      @if (d.snapshotUrl) {
                        <img [src]="d.snapshotUrl" [alt]="(d.ruleName ?? info[d.type].label) + ' evidence'" loading="lazy" />
                      } @else {
                        <!-- no evidence image: a calm card face with the detection type instead of a black "No snapshot" slab -->
                        <span class="ops-media-empty"><span class="material-symbols-outlined" aria-hidden="true">{{ info[d.type].icon }}</span>No snapshot for this detection</span>
                      }
                      <span class="ops-det-overlay">
                        <span class="ops-det-status">Detection status <ce-pill [value]="d.status" size="sm" data-testid="chip-detection-status" /></span>
                      </span>
                      <span class="ops-det-time">{{ d.ts | dt: 'time' }}</span>
                      @if (storeCode(d.storeId); as c) {
                        <span class="ops-det-code">{{ c }}</span>
                      }
                    </span>
                  </button>
                  <div class="ops-det-body">
                    <div class="ops-det-type">
                      <span class="material-symbols-outlined" aria-hidden="true">{{ info[d.type].icon }}</span>
                      <span class="ops-ellipsis" [title]="d.ruleName ?? ''">{{ info[d.type].label }}</span>
                    </div>
                    <div class="ops-det-meta ops-ellipsis" [title]="d.storeName + ' · ' + (d.cameraName ?? '')">{{ d.storeName }} · {{ d.cameraName || 'Camera' }}{{ d.zoneName ? ' · ' + d.zoneName : '' }}</div>
                    <div class="ops-det-meta">{{ d.ts | dt }}{{ d.confidence ? ' · ' + (d.confidence * 100).toFixed(0) + '% confidence' : '' }}</div>
                    @if (d.details) {
                      <div class="ops-det-details" [title]="d.details">{{ d.details }}</div>
                    }
                    <div class="ops-det-foot">
                      @if (d.reviewStatus) {
                        <ce-pill [value]="d.reviewStatus" [label]="reviewLabel(d.reviewStatus)" size="sm" data-testid="chip-review" />
                      }
                      <span class="ops-spacer"></span>
                      @if (canReview()) {
                        <button type="button" class="ce-btn ce-btn-secondary ops-review-btn" [class.on-valid]="d.reviewStatus === 'VALID'" (click)="review(d, 'VALID')" [disabled]="d.reviewStatus === 'VALID' || busyId() === d.id" matTooltip="Mark valid" data-testid="btn-review-valid"><mat-icon>thumb_up</mat-icon> Valid</button>
                        <button type="button" class="ce-btn ce-btn-secondary ops-review-btn" [class.on-false]="d.reviewStatus === 'FALSE_POSITIVE'" (click)="review(d, 'FALSE_POSITIVE')" [disabled]="d.reviewStatus === 'FALSE_POSITIVE' || busyId() === d.id" matTooltip="Mark as false positive" aria-label="Mark as false positive" data-testid="btn-review-false"><mat-icon>thumb_down</mat-icon></button>
                      }
                    </div>
                  </div>
                </article>
              } @empty {
                @if (data.loading()) {
                  @for (i of skeleton; track i) {
                    <span class="ops-gallery-skel"><span class="ce-skel"></span><span class="ce-skel" style="width: 70%"></span><span class="ce-skel" style="width: 40%"></span></span>
                  }
                }
              }
            </div>
          } @else {
            <ce-table
              [rows]="items()"
              [columns]="cols"
              [loading]="data.loading() && !data.data()"
              [paginate]="false"
              [toolbar]="false"
              [bare]="true"
              testId="table-detections"
              [rowTestId]="rowId"
              [rowClass]="rowClass"
              emptyIcon="center_focus_weak"
              emptyTitle="No detections"
            >
              <ng-template ceCell="snap" let-d>
                @if (d.snapshotUrl) {
                  <img class="ops-thumb" style="width: 72px" [src]="d.snapshotUrl" alt="Evidence" loading="lazy" (click)="openEvidence(indexOf(d))" />
                } @else {
                  <span class="ops-thumb empty" style="width: 72px">No snap</span>
                }
              </ng-template>
              <ng-template ceCell="status" let-d><ce-pill [value]="d.status" size="sm" data-testid="chip-detection-status" /></ng-template>
              <ng-template ceCell="review" let-d>
                <span class="ops-row-actions">
                  @if (d.reviewStatus) {
                    <ce-pill [value]="d.reviewStatus" [label]="reviewLabel(d.reviewStatus)" size="sm" data-testid="chip-review" />
                  }
                  @if (canReview()) {
                    <button type="button" class="ce-icon-btn sm" matTooltip="Valid" aria-label="Mark valid" (click)="review(d, 'VALID')" [disabled]="d.reviewStatus === 'VALID'" data-testid="btn-review-valid"><mat-icon>thumb_up</mat-icon></button>
                    <button type="button" class="ce-icon-btn sm" matTooltip="False positive" aria-label="Mark false positive" (click)="review(d, 'FALSE_POSITIVE')" [disabled]="d.reviewStatus === 'FALSE_POSITIVE'" data-testid="btn-review-false"><mat-icon>thumb_down</mat-icon></button>
                  }
                  <button type="button" class="ce-icon-btn sm" matTooltip="Open evidence" aria-label="Open evidence" (click)="openEvidence(indexOf(d))" data-testid="btn-open-evidence"><mat-icon>open_in_full</mat-icon></button>
                </span>
              </ng-template>
            </ce-table>
          }
          @if (data.loaded() && !items().length && !data.error()) {
            @if (filtered()) {
              <ce-empty-state kind="filtered" icon="filter_alt_off" title="No detections for these filters" message="Try another type, status or rule, or widen the date range in the top bar.">
                <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="clear()">Clear filters</button>
              </ce-empty-state>
            } @else if (view() === 'gallery') {
              <ce-empty-state icon="center_focus_weak" title="No detections in this period" message="Detections appear as the store cameras run the active AI checklists." />
            }
          }
          <div class="ops-pager">
            <mat-paginator [length]="data.data()?.total ?? 0" [pageIndex]="page() - 1" [pageSize]="pageSize()" [pageSizeOptions]="[24, 48, 96]" (page)="onPage($event)" showFirstLastButtons data-testid="paginator-detections" />
          </div>
        </ce-card>
      </ce-page>
    </section>
  `,
})
export class DetectionsPage {
  protected readonly opsCss = useOpsStyles();
  private readonly v2 = inject(V2Api);
  private readonly filter = inject(FilterService);
  private readonly lookup = inject(LookupService);
  private readonly ui = inject(UiService);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  readonly types = AI_MANAGER_TYPES;
  readonly info: Record<string, { label: string; icon: string; desc: string }> = AI_TYPE_INFO;
  readonly views = [
    { value: 'gallery', label: 'Gallery', testId: 'view-gallery' },
    { value: 'table', label: 'Table', testId: 'view-table' },
  ];
  readonly skeleton = Array.from({ length: 8 }, (_, i) => i);
  readonly canReview = computed(() => this.auth.can('reviewDetections'));
  readonly view = signal<'gallery' | 'table'>(safeStorage.get('ce.detections.view', 'gallery'));
  readonly type = signal<string | null>(this.route.snapshot.queryParamMap.get('type'));
  readonly status = signal<string | null>(this.route.snapshot.queryParamMap.get('status'));
  readonly ruleId = signal<number | null>(Number(this.route.snapshot.queryParamMap.get('ruleId')) || null);
  readonly page = signal(1);
  readonly pageSize = signal(24);
  readonly busyId = signal<number | null>(null);
  readonly highlightId = signal<number | null>(Number(this.route.snapshot.queryParamMap.get('id')) || null);
  readonly rules = signal<AiManagerRule[]>([]);

  readonly data = loadOn(
    () => ({ ...this.filter.params(), type: this.type(), status: this.status(), ruleId: this.ruleId(), page: this.page(), pageSize: this.pageSize() }),
    (q) => this.v2.detections(q),
  );
  private readonly summary = loadOn(() => this.filter.params(), (p) => this.v2.aiSummary(p).pipe(catchError(() => of(null))));
  readonly items = computed(() => this.data.data()?.items ?? []);
  readonly filtered = computed(() => this.type() !== null || this.status() !== null || this.ruleId() !== null);
  readonly ruleName = computed(() => this.rules().find((r) => r.id === this.ruleId())?.name ?? 'All');
  readonly totals = computed(() => {
    const s = this.summary.data();
    if (!s) return this.summary.loaded() ? { total: null, breached: null, complied: null, pct: null } : null;
    // Contract v4: totals.detections matches the list total (false positives included).
    const t = s.totals;
    const breached = t?.breached ?? s.byType.reduce((a, x) => a + x.breached, 0);
    const complied = t?.complied ?? s.byType.reduce((a, x) => a + x.complied, 0);
    const total = t?.detections ?? breached + complied;
    return { total, breached, complied, pct: t ? t.compliancePct : breached + complied ? (complied / (breached + complied)) * 100 : null };
  });
  readonly rowId = (d: Detection) => `row-detection-${d.id}`;
  readonly rowClass = (d: Detection) => (d.id === this.highlightId() ? 'row-late' : null);

  readonly cols: CeColumn<Detection>[] = [
    { key: 'snap', header: 'Evidence', value: () => '' },
    { key: 'type', header: 'Detection', format: (v) => AI_TYPE_INFO[v as keyof typeof AI_TYPE_INFO]?.label ?? String(v), secondary: (d) => d.details },
    { key: 'storeName', header: 'Store', secondary: (d) => d.cameraName },
    { key: 'ts', header: 'When', type: 'datetime' },
    { key: 'status', header: 'Status' },
    { key: 'review', header: 'Review', value: () => '', align: 'right' },
  ];

  constructor() {
    this.v2.aiRules().pipe(catchError(() => of([] as AiManagerRule[]))).subscribe((r) => this.rules.set(r));
    this.lookup.loadStores().subscribe();
  }

  storeCode(id: number): string | null {
    return this.lookup.stores().find((s) => s.id === id)?.code ?? null;
  }

  reviewLabel(r: Review): string {
    return REVIEW_LABEL[r];
  }

  indexOf(d: Detection): number {
    return this.items().findIndex((x) => x.id === d.id);
  }

  setView(v: 'gallery' | 'table'): void {
    this.view.set(v);
    safeStorage.set('ce.detections.view', v);
  }

  setFilter<T>(sig: { set(v: T): void }, v: T): void {
    sig.set(v);
    this.page.set(1);
  }

  clear(): void {
    this.type.set(null);
    this.status.set(null);
    this.ruleId.set(null);
    this.page.set(1);
  }

  onPage(e: PageEvent): void {
    this.page.set(e.pageIndex + 1);
    this.pageSize.set(e.pageSize);
  }

  openEvidence(index: number): void {
    if (index < 0) return;
    this.dialog.open(DetectionEvidenceComponent, {
      data: { items: this.items(), index, canReview: this.canReview(), storeCode: (id: number) => this.storeCode(id), review: (d: Detection, r: Review) => this.review(d, r) } satisfies EvidenceData,
      width: '1180px',
      maxWidth: '96vw',
      panelClass: 'lightbox-panel',
    });
  }

  review(d: Detection, reviewStatus: Review): void {
    if (this.busyId() === d.id) return;
    this.busyId.set(d.id);
    this.v2.reviewDetection(d.id, reviewStatus).subscribe({
      next: () => {
        this.busyId.set(null);
        const cur = this.data.data();
        if (cur) this.data.set({ ...cur, items: cur.items.map((x) => (x.id === d.id ? { ...x, reviewStatus } : x)) });
        this.ui.toast(reviewStatus === 'VALID' ? 'Marked valid' : 'Marked as false positive');
      },
      error: () => this.busyId.set(null),
    });
  }
}
