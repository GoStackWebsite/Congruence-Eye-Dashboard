import { Injectable, computed, effect, signal } from '@angular/core';
import { AnalyticsQuery } from '../models/api.models';
import { DateRange, RangePreset, isValidIsoDate, previousPeriod, rangeForPreset } from '../utils/dates';
import { safeStorage } from '../utils/storage';

export const FILTER_STORAGE_KEY = 'ce.filter';

export interface FilterState {
  /** Selected stores; empty = all stores in the user's scope. */
  storeIds: number[];
  preset: RangePreset;
  custom: DateRange | null;
  compare: boolean;
}

const DEFAULT_STATE: FilterState = { storeIds: [], preset: 'last7', custom: null, compare: false };

const PRESETS: RangePreset[] = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'custom'];

export function sanitizeFilterState(raw: unknown): FilterState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<FilterState>;
  const storeIds = Array.isArray(r.storeIds) ? r.storeIds.filter((n) => Number.isInteger(n) && n > 0) : [];
  const preset = PRESETS.includes(r.preset as RangePreset) ? (r.preset as RangePreset) : DEFAULT_STATE.preset;
  const custom =
    r.custom && isValidIsoDate(r.custom.from) && isValidIsoDate(r.custom.to) ? { from: r.custom.from, to: r.custom.to } : null;
  return { storeIds, preset: preset === 'custom' && !custom ? 'last7' : preset, custom, compare: !!r.compare };
}

/**
 * Global analytics filter (stores, date range, compare). Signal based and persisted
 * to localStorage. Every analytics page derives its query from `params()`.
 */
@Injectable({ providedIn: 'root' })
export class FilterService {
  private readonly state = signal<FilterState>(sanitizeFilterState(safeStorage.get(FILTER_STORAGE_KEY, DEFAULT_STATE)));
  /** Store ids the current user may pick from (null = unknown / not loaded yet). */
  private readonly available = signal<number[] | null>(null);
  /** Bumped by "refresh" so pages reload with the same params. */
  private readonly tick = signal(0);
  private readonly today = signal(new Date());
  /** When the current params were last (re)applied — shown as "Last refreshed" in the top bar. */
  readonly lastRefreshed = signal(new Date());

  readonly preset = computed(() => this.state().preset);
  readonly compare = computed(() => this.state().compare);
  readonly selectedStoreIds = computed(() => {
    const ids = this.state().storeIds;
    const avail = this.available();
    return avail ? ids.filter((id) => avail.includes(id)) : ids;
  });
  readonly range = computed<DateRange>(() => rangeForPreset(this.state().preset, this.today(), this.state().custom ?? undefined));
  readonly previousRange = computed(() => previousPeriod(this.range()));

  /** Query params for every analytics endpoint. */
  readonly params = computed<AnalyticsQuery>(
    () => {
      const r = this.range();
      const q: AnalyticsQuery = { from: r.from, to: r.to };
      const ids = this.selectedStoreIds();
      if (ids.length) q.storeIds = ids;
      if (this.state().compare) q.compare = true;
      // non-enumerable refresh counter: makes refresh() produce a "different" value without leaking into queries
      Object.defineProperty(q, '_tick', { value: this.tick(), enumerable: false });
      return q;
    },
    {
      // structurally equal params must not re-trigger (and cancel) in-flight requests
      equal: (a, b) =>
        a.from === b.from &&
        a.to === b.to &&
        !!a.compare === !!b.compare &&
        (a.storeIds ?? []).join(',') === (b.storeIds ?? []).join(',') &&
        (a as { _tick?: number })._tick === (b as { _tick?: number })._tick,
    },
  );

  constructor() {
    effect(() => safeStorage.set(FILTER_STORAGE_KEY, this.state()));
    effect(() => {
      this.params();
      this.lastRefreshed.set(new Date());
    });
  }

  snapshot(): FilterState {
    return this.state();
  }

  setStores(ids: number[]): void {
    this.state.update((s) => ({ ...s, storeIds: [...new Set(ids)].sort((a, b) => a - b) }));
  }

  setPreset(preset: RangePreset): void {
    if (preset === 'custom') {
      this.state.update((s) => ({ ...s, preset, custom: s.custom ?? this.range() }));
    } else {
      this.state.update((s) => ({ ...s, preset }));
    }
  }

  setCustomRange(from: string, to: string): void {
    if (!isValidIsoDate(from) || !isValidIsoDate(to)) return;
    const range = from <= to ? { from, to } : { from: to, to: from };
    this.state.update((s) => ({ ...s, preset: 'custom', custom: range }));
  }

  setCompare(compare: boolean): void {
    this.state.update((s) => ({ ...s, compare }));
  }

  /** Limits the selectable stores (from the user's scope); drops ids outside it. */
  setAvailableStores(ids: number[]): void {
    this.available.set(ids);
  }

  refresh(): void {
    this.today.set(new Date());
    this.tick.update((t) => t + 1);
  }

  reset(): void {
    this.state.set({ ...DEFAULT_STATE });
  }
}
