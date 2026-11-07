import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injectable, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DateAdapter, MAT_DATE_LOCALE, NativeDateAdapter, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Store } from '../core/models/api.models';
import { FilterService } from '../core/services/filter.service';
import { LookupService } from '../core/services/lookup.service';
import { RANGE_PRESETS, RangePreset, parseIsoDate, shortDate, toIsoDate } from '../core/utils/dates';
import { humanize } from '../core/utils/format';

export interface StoreCluster {
  key: string;
  label: string;
  ids: number[];
}

/** Region / format clusters for the store selector (only clusters with ≥ 1 store, sorted by name). */
export function storeClusters(stores: Store[], by: 'region' | 'format'): StoreCluster[] {
  const m = new Map<string, StoreCluster>();
  for (const s of stores) {
    const raw = by === 'region' ? s.regionName || (s.regionId ? `Region ${s.regionId}` : '') : s.format ?? '';
    if (!raw) continue;
    const key = `${by}-${String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const c = m.get(key) ?? { key, label: by === 'format' ? humanize(String(raw)) : String(raw), ids: [] };
    c.ids.push(s.id);
    m.set(key, c);
  }
  return [...m.values()].map((c) => ({ ...c, ids: c.ids.sort((a, b) => a - b) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Label of the store selection: "All stores", a store name, a matching cluster, or "N stores". */
export function storeSelectionLabel(ids: number[], stores: Store[], clusters: StoreCluster[]): string {
  if (!ids.length) return 'All stores';
  if (ids.length === 1) return stores.find((s) => s.id === ids[0])?.name ?? `Store #${ids[0]}`;
  const key = [...ids].sort((a, b) => a - b).join(',');
  const c = clusters.find((x) => x.ids.join(',') === key);
  return c ? `${c.label} (${ids.length})` : `${ids.length} stores`;
}

/**
 * Global filter in the top bar: searchable multi-store selector (All stores / by Region / by Format / stores),
 * period presets + calendar range, Compare, Refresh and "Last refreshed". `stacked` renders it for the mobile sheet.
 */
/**
 * Native adapter that also understands the way Indian users type dates: 28/09/2026, 28-09-2026, 28.09.26, as well as
 * ISO (2026-09-28) and "28 Sep 2026" (the browser's Date.parse only knows the last two).
 */
@Injectable()
export class IndianDateAdapter extends NativeDateAdapter {
  override parse(value: unknown, parseFormat?: unknown): Date | null {
    if (typeof value === 'string') {
      const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\s*$/.exec(value);
      if (m) {
        const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
        const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
        return d.getFullYear() === y && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[1]) ? d : this.invalid();
      }
      const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(value);
      if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    }
    return super.parse(value, parseFormat);
  }
}

@Component({
  selector: 'ce-global-filter',
  imports: [FormsModule, DatePipe, MatSelectModule, MatFormFieldModule, MatDatepickerModule, MatSlideToggleModule, MatIconModule, MatTooltipModule],
  providers: [
    { provide: MAT_DATE_LOCALE, useValue: 'en-IN' },
    provideNativeDateAdapter({
      parse: { dateInput: null },
      display: {
        dateInput: { day: 'numeric', month: 'short' },
        monthYearLabel: { year: 'numeric', month: 'short' },
        dateA11yLabel: { year: 'numeric', month: 'long', day: 'numeric' },
        monthYearA11yLabel: { year: 'numeric', month: 'long' },
      },
    }),
    // after provideNativeDateAdapter so it wins
    { provide: DateAdapter, useClass: IndianDateAdapter },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'global-filter', '[class.stacked]': 'stacked()', 'data-testid': 'global-filter' },
  template: `
    <div class="gf-store">
      <mat-form-field subscriptSizing="dynamic" class="gf-stores" appearance="outline">
        <mat-icon matPrefix aria-hidden="true">storefront</mat-icon>
        <mat-select
          multiple
          placeholder="All stores"
          aria-label="Stores"
          [ngModel]="filter.selectedStoreIds()"
          (ngModelChange)="filter.setStores($event)"
          (openedChange)="onOpened($event)"
          data-testid="filter-stores"
          panelClass="gf-store-panel"
          panelWidth="320px"
        >
          <mat-select-trigger>
            <span class="gf-trigger">{{ storeLabel() }}</span>
          </mat-select-trigger>
          <div class="gf-panel-head" (keydown)="keepKeys($event)">
            <label class="ce-search sm">
              <mat-icon aria-hidden="true">search</mat-icon>
              <input type="search" placeholder="Search stores" [value]="query()" (input)="query.set($any($event.target).value)" data-testid="filter-store-search" aria-label="Search stores" />
            </label>
            <div class="gf-quick">
              <button type="button" class="gf-q" [class.on]="!filter.selectedStoreIds().length" (click)="pick([])" data-testid="filter-store-all">
                All stores <span>{{ stores().length }}</span>
              </button>
            </div>
            @if (regions().length > 1) {
              <div class="gf-group-label">By region</div>
              <div class="gf-quick">
                @for (c of regions(); track c.key) {
                  <button type="button" class="gf-q" [class.on]="isExactly(c.ids)" (click)="pick(c.ids)" [attr.data-testid]="'filter-cluster-' + c.key">
                    {{ c.label }} <span>{{ c.ids.length }}</span>
                  </button>
                }
              </div>
            }
            @if (formats().length > 1) {
              <div class="gf-group-label">By format</div>
              <div class="gf-quick">
                @for (c of formats(); track c.key) {
                  <button type="button" class="gf-q" [class.on]="isExactly(c.ids)" (click)="pick(c.ids)" [attr.data-testid]="'filter-cluster-' + c.key">
                    {{ c.label }} <span>{{ c.ids.length }}</span>
                  </button>
                }
              </div>
            }
            <div class="gf-group-label">Stores</div>
          </div>
          @for (s of stores(); track s.id) {
            <mat-option [value]="s.id" [attr.data-testid]="'filter-store-option-' + s.id" [class.gf-hide]="!matches(s)">
              <span class="gf-opt"><span class="gf-opt-name">{{ s.name }}</span><span class="gf-opt-meta">{{ s.code }}{{ s.city ? ' · ' + s.city : '' }}</span></span>
            </mat-option>
          }
          @if (query() && !visibleCount()) {
            <div class="gf-none">No stores match “{{ query() }}”</div>
          }
        </mat-select>
      </mat-form-field>
      @if (filter.selectedStoreIds().length) {
        <button type="button" class="ce-icon-btn sm gf-clear" (click)="filter.setStores([])" matTooltip="Show all stores" aria-label="Clear store selection" data-testid="filter-stores-clear">
          <mat-icon>close</mat-icon>
        </button>
      }
    </div>

    <div class="gf-date">
      <mat-form-field subscriptSizing="dynamic" class="gf-preset" appearance="outline">
        <mat-icon matPrefix aria-hidden="true">calendar_today</mat-icon>
        <mat-select [ngModel]="filter.preset()" (ngModelChange)="setPreset($event)" data-testid="filter-range-preset" aria-label="Period" panelClass="gf-preset-panel">
          @for (p of presets; track p.value) {
            <mat-option [value]="p.value" [attr.data-testid]="'filter-preset-' + p.value">{{ p.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic" class="gf-range" appearance="outline">
        <mat-date-range-input [rangePicker]="picker" data-testid="filter-date-range" aria-label="Date range">
          <input matStartDate [ngModel]="fromDate()" (dateChange)="onStart($event.value)" placeholder="From" data-testid="filter-date-from" />
          <input matEndDate [ngModel]="toDate()" (dateChange)="onEnd($event.value)" placeholder="To" data-testid="filter-date-to" />
        </mat-date-range-input>
        <mat-datepicker-toggle matIconSuffix [for]="picker" data-testid="filter-date-toggle" />
        <mat-date-range-picker #picker />
      </mat-form-field>
    </div>

    <mat-slide-toggle class="gf-compare" [ngModel]="filter.compare()" (ngModelChange)="filter.setCompare($event)" data-testid="filter-compare" [matTooltip]="compareHint()">
      Compare
    </mat-slide-toggle>
    <div class="gf-refresh">
      <button type="button" class="ce-icon-btn" (click)="filter.refresh()" [matTooltip]="'Refresh · last refreshed at ' + (filter.lastRefreshed() | date: 'h:mm a')" aria-label="Refresh data" data-testid="filter-refresh">
        <mat-icon>refresh</mat-icon>
      </button>
      <span class="gf-refreshed" data-testid="last-refreshed">Last refreshed <b>{{ filter.lastRefreshed() | date: 'h:mm a' }}</b></span>
    </div>
  `,
})
export class GlobalFilterComponent {
  protected readonly filter = inject(FilterService);
  protected readonly lookup = inject(LookupService);
  protected readonly presets = RANGE_PRESETS;
  readonly stacked = input(false);
  protected readonly query = signal('');
  private pendingStart: string | null = null;

  protected readonly stores = this.lookup.scopedStores;
  protected readonly regions = computed(() => storeClusters(this.stores(), 'region'));
  protected readonly formats = computed(() => storeClusters(this.stores(), 'format'));
  protected readonly fromDate = computed(() => parseIsoDate(this.filter.range().from));
  protected readonly toDate = computed(() => parseIsoDate(this.filter.range().to));
  protected readonly storeLabel = computed(() => storeSelectionLabel(this.filter.selectedStoreIds(), this.stores(), [...this.regions(), ...this.formats()]));
  protected readonly visibleCount = computed(() => this.stores().filter((s) => this.matches(s)).length);
  protected readonly compareHint = computed(() => {
    const p = this.filter.previousRange();
    return `Compare with the previous period (${shortDate(p.from)} – ${shortDate(p.to)})`;
  });

  matches(s: Store): boolean {
    const q = this.query().trim().toLowerCase();
    return !q || `${s.name} ${s.code} ${s.city} ${s.regionName ?? ''}`.toLowerCase().includes(q);
  }

  isExactly(ids: number[]): boolean {
    const sel = this.filter.selectedStoreIds();
    return sel.length === ids.length && sel.every((id) => ids.includes(id));
  }

  pick(ids: number[]): void {
    this.filter.setStores(ids);
  }

  onOpened(open: boolean): void {
    if (!open) this.query.set('');
  }

  /** Typing in the search box must not drive the select's typeahead / option toggling. */
  keepKeys(e: KeyboardEvent): void {
    if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation();
  }

  setPreset(p: RangePreset): void {
    this.filter.setPreset(p);
  }

  onStart(d: Date | null): void {
    this.pendingStart = d ? toIsoDate(d) : null;
  }

  onEnd(d: Date | null): void {
    if (!d) return;
    const from = this.pendingStart ?? this.filter.range().from;
    const to = toIsoDate(d);
    // typed dates can arrive reversed: never send from > to
    if (from <= to) this.filter.setCustomRange(from, to);
    else this.filter.setCustomRange(to, from);
    this.pendingStart = null;
  }
}
