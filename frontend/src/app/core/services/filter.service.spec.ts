import { TestBed } from '@angular/core/testing';
import { toIsoDate } from '../utils/dates';
import { FILTER_STORAGE_KEY, FilterService, sanitizeFilterState } from './filter.service';

describe('FilterService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  function create(): FilterService {
    return TestBed.inject(FilterService);
  }

  it('defaults to last 7 days, all stores, no compare', () => {
    const f = create();
    const p = f.params();
    expect(p.storeIds).toBeUndefined();
    expect(p.compare).toBeUndefined();
    expect(p.to).toBe(toIsoDate(new Date()));
    expect(f.preset()).toBe('last7');
  });

  it('produces params for stores and compare', () => {
    const f = create();
    f.setStores([3, 1, 3]);
    f.setCompare(true);
    expect(f.params().storeIds).toEqual([1, 3]);
    expect(f.params().compare).toBe(true);
  });

  it('switches presets and custom ranges', () => {
    const f = create();
    f.setPreset('today');
    expect(f.range().from).toBe(f.range().to);
    f.setCustomRange('2026-10-10', '2026-10-01');
    expect(f.preset()).toBe('custom');
    expect(f.range()).toEqual({ from: '2026-10-01', to: '2026-10-10' });
  });

  it('limits selected stores to the available scope', () => {
    const f = create();
    f.setStores([1, 2, 9]);
    f.setAvailableStores([1, 2]);
    expect(f.selectedStoreIds()).toEqual([1, 2]);
  });

  it('persists to localStorage and restores', () => {
    const f = create();
    f.setStores([2]);
    f.setPreset('last30');
    TestBed.tick();
    const saved = JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY)!);
    expect(saved.storeIds).toEqual([2]);
    expect(saved.preset).toBe('last30');

    TestBed.resetTestingModule();
    const g = TestBed.inject(FilterService);
    expect(g.preset()).toBe('last30');
    expect(g.selectedStoreIds()).toEqual([2]);
  });

  it('survives a throwing localStorage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const f = create();
    expect(f.preset()).toBe('last7');
    spy.mockRestore();
  });

  it('keeps params identity when nothing effectively changed', () => {
    const f = create();
    f.setStores([1]);
    const a = f.params();
    f.setAvailableStores([1, 2, 3]);
    expect(f.params()).toBe(a);
    expect(Object.keys(a)).not.toContain('_tick');
  });

  it('refresh() re-emits params', () => {
    const f = create();
    const a = f.params();
    f.refresh();
    expect(f.params()).not.toBe(a);
  });

  it('sanitizes garbage state', () => {
    expect(sanitizeFilterState({ storeIds: ['x', 2, -1], preset: 'nope', compare: 1 })).toEqual({
      storeIds: [2],
      preset: 'last7',
      custom: null,
      compare: true,
    });
    expect(sanitizeFilterState({ preset: 'custom' }).preset).toBe('last7');
  });
});
