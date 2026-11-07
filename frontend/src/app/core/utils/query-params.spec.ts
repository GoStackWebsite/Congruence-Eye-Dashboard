import { buildHttpParams, buildQueryString, toQueryRecord } from './query-params';

describe('query param builder', () => {
  it('joins arrays with commas (storeIds=1,2,3)', () => {
    expect(toQueryRecord({ storeIds: [1, 2, 3] })).toEqual({ storeIds: '1,2,3' });
  });

  it('drops null, undefined, empty strings and empty arrays', () => {
    expect(toQueryRecord({ a: null, b: undefined, c: '', d: [], e: '  ', f: 'x' })).toEqual({ f: 'x' });
  });

  it('only emits true booleans by default (compare=true)', () => {
    expect(toQueryRecord({ compare: true, mine: false })).toEqual({ compare: 'true' });
    expect(toQueryRecord({ mine: false }, true)).toEqual({ mine: 'false' });
  });

  it('keeps zero and drops NaN', () => {
    expect(toQueryRecord({ page: 0, x: NaN })).toEqual({ page: '0' });
  });

  it('builds HttpParams and query strings', () => {
    const p = buildHttpParams({ from: '2026-10-01', to: '2026-10-05', storeIds: [4, 7] });
    expect(p.get('storeIds')).toBe('4,7');
    expect(p.get('from')).toBe('2026-10-01');
    expect(buildQueryString({ type: 'traffic', format: 'csv' })).toBe('?type=traffic&format=csv');
    expect(buildQueryString({})).toBe('');
  });

  it('handles a null object', () => {
    expect(toQueryRecord(null)).toEqual({});
  });
});
