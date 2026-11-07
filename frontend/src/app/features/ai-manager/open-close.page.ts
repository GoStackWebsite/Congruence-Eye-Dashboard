import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { OpenCloseRow, OpenCloseStatus } from '../../core/models/api.models';
import { FilterService } from '../../core/services/filter.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { DS } from '../../shared/ds';
import { useOpsStyles } from '../../shared/ds/ops.styles';

/** On Time / Late / Early / Missing → chip tone + label. */
export function openCloseChip(s: OpenCloseStatus): { value: string; label: string } {
  switch (s) {
    case 'ON_TIME':
      return { value: 'DONE', label: 'On time' };
    case 'LATE':
      return { value: 'OVERDUE', label: 'Late' };
    case 'EARLY':
      return { value: 'PENDING', label: 'Early' };
    case 'PENDING':
      return { value: 'TODO', label: 'Pending' };
    default:
      return { value: 'UNKNOWN', label: 'Missing' };
  }
}

/** Pill label for the opening or closing side ("Late open", "Early close"). */
export function ocLabel(s: OpenCloseStatus, side: 'open' | 'close'): string {
  if (s === 'LATE') return side === 'open' ? 'Late open' : 'Late close';
  if (s === 'EARLY') return side === 'open' ? 'Early open' : 'Early close';
  return openCloseChip(s).label;
}

/** Signed minutes actual − scheduled (HH:mm), null when either is missing. */
export function minutesDelta(scheduled: string | null | undefined, actual: string | null | undefined): number | null {
  const m = (s: string | null | undefined) => (s && /^\d{1,2}:\d{2}/.test(s) ? Number(s.split(':')[0]) * 60 + Number(s.split(':')[1].slice(0, 2)) : null);
  const a = m(actual);
  const b = m(scheduled);
  return a === null || b === null ? null : a - b;
}

/** "12 mins early" / "3 mins late" / "On schedule". */
export function deltaText(delta: number | null): string | null {
  if (delta === null) return null;
  if (delta === 0) return 'On schedule';
  const n = Math.abs(delta);
  return `${n} min${n === 1 ? '' : 's'} ${delta < 0 ? 'early' : 'late'}`;
}

/** 24-hour HH:mm → "10:00 AM" (store-local). */
export function clock12(hm: string | null | undefined): string | null {
  if (!hm || !/^\d{1,2}:\d{2}/.test(hm)) return null;
  const [h, m] = hm.split(':').map((x) => Number(x.slice(0, 2)));
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

interface SnapData {
  url: string;
  title: string;
  store: string;
  date: string;
  kind: string;
  scheduled: string;
  actual: string | null;
  status: OpenCloseStatus;
  label: string;
}

@Component({
  selector: 'ce-snap-viewer',
  imports: [MatDialogModule, MatIconModule, ...DS],
  template: `
    <div class="lightbox" data-testid="dialog-snap">
      <div class="lb-stage"><img [src]="data.url" [alt]="data.title" /></div>
      <aside class="lb-meta" aria-label="Snap details">
        <div class="lb-head">
          <div class="ce-card-title">{{ data.kind }}</div>
          <button type="button" class="ce-icon-btn sm" mat-dialog-close aria-label="Close" data-testid="btn-close"><mat-icon>close</mat-icon></button>
        </div>
        <dl>
          <dt>Store</dt>
          <dd>{{ data.store }}</dd>
          <dt>Date</dt>
          <dd>{{ data.date }}</dd>
          <dt>Scheduled</dt>
          <dd>{{ data.scheduled }}</dd>
          <dt>Detected</dt>
          <dd>{{ data.actual ?? '--' }}</dd>
          <dt>Status</dt>
          <dd><ce-pill [value]="data.status" [label]="data.label" size="sm" /></dd>
        </dl>
        <a class="ce-btn ce-btn-secondary lb-dl" [href]="data.url" target="_blank" rel="noopener" download><mat-icon>download</mat-icon> Download</a>
      </aside>
    </div>
  `,
})
export class SnapViewerComponent {
  readonly data = inject<SnapData>(MAT_DIALOG_DATA);
}

const PAGE = 12;

/** AI Manager › Store open / close (reference 10): opening and closing snaps per store and day with their status. */
@Component({
  selector: 'ce-open-close-page',
  imports: [MatDialogModule, MatIconModule, ...DS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-ai-open-close">
      <ce-page title="Store open / close" description="Opening and closing snaps against each store's own timings" [lastRefreshed]="true">
        <ce-stat-strip label="Open / close summary">
          <ce-stat-tile variant="strip" id="oc-days" label="Store-days" [value]="stats()?.total" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="oc-breached" label="Breached" [value]="stats()?.breached" [loading]="busy()" />
          <span class="ce-stat-strip-sep" aria-hidden="true"></span>
          <ce-stat-tile variant="strip" id="oc-late-open" label="Late openings" [value]="stats()?.late" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="oc-early-close" label="Early closings" [value]="stats()?.early" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="oc-on-time" label="On-time rate" format="pct" [value]="stats()?.onTimePct" [loading]="busy()" hint="Store-days opened and closed on time" />
        </ce-stat-strip>

        <ce-info-banner>Open and close are judged against each store's timings (Admin › Stores) with the tolerance set in the Store open / close AI checklist.</ce-info-banner>

        <div class="ops-row">
          <ce-segmented [options]="statusOptions()" [value]="statusFilter()" (valueChange)="setStatus($any($event))" label="Detection status" data-testid="filter-oc-status" />
          <span class="ops-spacer"></span>
          <span class="ce-count-badge">{{ rows().length }} store-days</span>
        </div>

        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        } @else if (busy()) {
          <div class="ops-oc-list"><ce-skeleton kind="chart" height="320px" /><ce-skeleton kind="chart" height="320px" /></div>
        } @else if (noSnaps() && !showUnmonitored()) {
          <ce-card data-testid="oc-no-snaps">
            <ce-empty-state icon="no_photography" title="No opening or closing snaps received"
              [message]="'None of the ' + (data.data()?.length ?? 0) + ' store-days in this period has an opening or closing snap. Check that the store has an entrance camera and the Store open / close AI checklist is published for it.'">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="showUnmonitored.set(true)" data-testid="btn-show-store-days">Show the store-days</button>
            </ce-empty-state>
          </ce-card>
        } @else {
          <div class="ops-oc-list" data-testid="open-close-cards" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 540px), 1fr)); gap: 16px">
            @for (r of shown(); track r.storeId + '-' + r.date) {
              <article class="ops-oc-card" [attr.data-testid]="'oc-card-' + r.storeId + '-' + r.date" [attr.data-status]="r.detectionStatus">
                <div class="ops-oc-head">
                  <dl class="ops-oc-kv">
                    <dt>Store name</dt>
                    <dd class="ops-ellipsis" [title]="r.storeName">{{ storeCode(r.storeId) ?? r.storeName }}@if (storeCode(r.storeId)) {<span class="caption"> · {{ r.storeName }}</span>}</dd>
                    <dt>Detection status</dt>
                    <dd><ce-pill [value]="r.detectionStatus" [label]="awaiting(r) ? 'Awaiting' : null" [tone]="awaiting(r) ? 'info' : null" size="sm" data-testid="chip-detection-status" /></dd>
                  </dl>
                  <span></span>
                  <div class="ops-oc-date"><span>Date :</span><span class="ops-strong">{{ longDate(r.date) }}</span></div>
                </div>
                <div class="ops-oc-snaps">
                  <figure class="ops-oc-snap">
                    @if (r.openingSnapUrl) {
                      <button type="button" class="ops-media" (click)="view(r, 'open')" [attr.aria-label]="'Open opening snap, ' + r.storeName + ' ' + r.date">
                        <img [src]="r.openingSnapUrl" alt="Opening snap" loading="lazy" data-testid="opening-snap" />
                        <span class="ops-oc-stamp">{{ stamp(r.date, r.actualOpen) }}</span>
                      </button>
                    } @else {
                      <div class="ops-oc-missing" data-testid="opening-snap-missing"><span class="material-symbols-outlined" aria-hidden="true">{{ r.openStatus === 'PENDING' ? 'schedule' : 'no_photography' }}</span>{{ r.openStatus === 'PENDING' ? 'Awaiting opening' : 'No opening snap' }}</div>
                    }
                    <figcaption class="ops-oc-cap">
                      <span>
                        <span class="ops-oc-cap-title">Opening snap</span>
                        <span class="ops-oc-cap-time">
                          @if (r.actualOpen) {
                            <span>{{ r.actualOpen }}</span>
                            @if (delta(r.scheduledOpen, r.actualOpen); as d) {
                              <span class="ops-oc-delta" [class.good]="r.openStatus === 'ON_TIME'">· {{ d }}</span>
                            }
                            <span class="ops-oc-sched">· scheduled {{ r.scheduledOpen }}</span>
                          } @else {
                            <span class="ops-oc-sched">Scheduled {{ r.scheduledOpen }}</span>
                          }
                        </span>
                      </span>
                      <ce-pill [value]="r.openStatus" [label]="label(r.openStatus, 'open')" size="sm" data-testid="chip-open-status" />
                    </figcaption>
                  </figure>
                  <figure class="ops-oc-snap">
                    @if (r.closingSnapUrl) {
                      <button type="button" class="ops-media" (click)="view(r, 'close')" [attr.aria-label]="'Open closing snap, ' + r.storeName + ' ' + r.date">
                        <img [src]="r.closingSnapUrl" alt="Closing snap" loading="lazy" data-testid="closing-snap" />
                        <span class="ops-oc-stamp">{{ stamp(r.date, r.actualClose) }}</span>
                      </button>
                    } @else {
                      <div class="ops-oc-missing" data-testid="closing-snap-missing"><span class="material-symbols-outlined" aria-hidden="true">{{ r.closeStatus === 'PENDING' ? 'schedule' : 'no_photography' }}</span>{{ r.closeStatus === 'PENDING' ? 'Awaiting closing' : 'No closing snap' }}</div>
                    }
                    <figcaption class="ops-oc-cap">
                      <span>
                        <span class="ops-oc-cap-title">Closing snap</span>
                        <span class="ops-oc-cap-time">
                          @if (r.actualClose) {
                            <span>{{ r.actualClose }}</span>
                            @if (delta(r.scheduledClose, r.actualClose); as d) {
                              <span class="ops-oc-delta" [class.good]="r.closeStatus === 'ON_TIME'">· {{ d }}</span>
                            }
                            <span class="ops-oc-sched">· scheduled {{ r.scheduledClose }}</span>
                          } @else {
                            <span class="ops-oc-sched">Scheduled {{ r.scheduledClose }}</span>
                          }
                        </span>
                      </span>
                      <ce-pill [value]="r.closeStatus" [label]="label(r.closeStatus, 'close')" size="sm" data-testid="chip-close-status" />
                    </figcaption>
                  </figure>
                </div>
              </article>
            }
          </div>
          @if (rows().length > shown().length) {
            <div class="ops-row" style="justify-content: center">
              <button type="button" class="ce-btn ce-btn-secondary" (click)="limit.set(limit() + page)" data-testid="btn-show-more">Show more ({{ rows().length - shown().length }} left)</button>
            </div>
          }
          @if (data.loaded() && !rows().length) {
            <ce-card>
              @if ((data.data() ?? []).length) {
                <ce-empty-state kind="filtered" icon="door_open" title="No store-days with this status" message="Every store-day in the period has the other status.">
                  <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="setStatus('ALL')">Show all</button>
                </ce-empty-state>
              } @else {
                <ce-empty-state icon="door_open" title="No open / close data for this period" message="Opening and closing are detected by the entrance cameras once the Store open / close AI checklist is published." />
              }
            </ce-card>
          }
        }
      </ce-page>
    </section>
  `,
})
export class OpenClosePage {
  protected readonly opsCss = useOpsStyles();
  private readonly v2 = inject(V2Api);
  private readonly filter = inject(FilterService);
  private readonly lookup = inject(LookupService);
  private readonly dialog = inject(MatDialog);
  readonly page = PAGE;
  readonly statusFilter = signal<'ALL' | 'BREACHED' | 'COMPLIED' | 'PENDING'>('ALL');
  readonly limit = signal(PAGE);
  readonly data = loadOn(() => this.filter.params(), (p) => this.v2.openClose(p));
  readonly busy = computed(() => this.data.loading() && !this.data.data());
  readonly rows = computed(() => {
    const f = this.statusFilter();
    return [...(this.data.data() ?? [])]
      .filter((r) => f === 'ALL' || r.detectionStatus === f)
      .sort((a, b) => b.date.localeCompare(a.date) || a.storeName.localeCompare(b.storeName));
  });
  readonly shown = computed(() => this.rows().slice(0, this.limit()));
  /** Not one snap or detected time in the whole selection: a wall of "No snap" placeholders helps nobody. */
  readonly noSnaps = computed(() => {
    const d = this.data.data() ?? [];
    return d.length > 0 && d.every((r) => !r.openingSnapUrl && !r.closingSnapUrl && !r.actualOpen && !r.actualClose);
  });
  readonly showUnmonitored = signal(false);
  readonly stats = computed(() => {
    const d: OpenCloseRow[] | undefined = this.data.data();
    if (!d) return null;
    const onTime = d.filter((r) => r.openStatus === 'ON_TIME' && r.closeStatus === 'ON_TIME').length;
    const judged = d.filter((r) => r.openStatus !== 'PENDING' && r.closeStatus !== 'PENDING').length;
    return {
      total: d.length,
      breached: d.filter((r) => r.detectionStatus === 'BREACHED').length,
      late: d.filter((r) => r.openStatus === 'LATE').length,
      early: d.filter((r) => r.closeStatus === 'EARLY').length,
      onTimePct: judged ? (onTime / judged) * 100 : null,
    };
  });
  readonly statusOptions = computed(() => {
    const d = this.data.data() ?? [];
    const n = (s: string) => d.filter((r) => r.detectionStatus === s).length;
    return [
      { value: 'ALL', label: 'All' },
      { value: 'BREACHED', label: 'Breached' + (d.length ? ` ${n('BREACHED')}` : '') },
      { value: 'COMPLIED', label: 'Complied' + (d.length ? ` ${n('COMPLIED')}` : '') },
      // Contract v4: today's rows before the window closes are PENDING (never COMPLIED); offer the filter only when present.
      ...(n('PENDING') ? [{ value: 'PENDING', label: `Awaiting ${n('PENDING')}` }] : []),
    ];
  });

  constructor() {
    this.lookup.loadStores().subscribe();
    effect(() => {
      this.filter.params();
      this.limit.set(PAGE);
    });
  }

  setStatus(s: 'ALL' | 'BREACHED' | 'COMPLIED' | 'PENDING'): void {
    this.statusFilter.set(s);
    this.limit.set(PAGE);
  }

  storeCode(id: number): string | null {
    return this.lookup.stores().find((s) => s.id === id)?.code ?? null;
  }
  label(s: OpenCloseStatus, side: 'open' | 'close'): string {
    return ocLabel(s, side);
  }
  /** Today, before opening: nothing to judge yet. */
  awaiting(r: OpenCloseRow): boolean {
    return r.detectionStatus === 'PENDING' || (r.openStatus === 'PENDING' && r.closeStatus === 'PENDING');
  }
  delta(sched: string, actual: string | null): string | null {
    const d = minutesDelta(sched, actual);
    return d === 0 ? null : deltaText(d);
  }
  longDate(d: string): string {
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  }
  stamp(date: string, hm: string | null): string {
    const [y, m, d] = date.split('-');
    return `${d}-${m}-${y}${hm ? '  ' + (clock12(hm) ?? hm) : ''}`;
  }

  view(r: OpenCloseRow, side: 'open' | 'close'): void {
    const open = side === 'open';
    const url = open ? r.openingSnapUrl : r.closingSnapUrl;
    if (!url) return;
    this.dialog.open(SnapViewerComponent, {
      data: {
        url,
        title: `${r.storeName} — ${open ? 'opening' : 'closing'} ${r.date}`,
        store: r.storeName,
        date: this.longDate(r.date),
        kind: open ? 'Opening snap' : 'Closing snap',
        scheduled: open ? r.scheduledOpen : r.scheduledClose,
        actual: open ? r.actualOpen : r.actualClose,
        status: open ? r.openStatus : r.closeStatus,
        label: ocLabel(open ? r.openStatus : r.closeStatus, side),
      } satisfies SnapData,
      width: '1180px',
      maxWidth: '96vw',
      panelClass: 'lightbox-panel',
    });
  }
}
