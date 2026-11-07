import { ComponentFixture, TestBed } from '@angular/core/testing';
import { KpiCardComponent, formatKpiValue, trendOf } from './kpi-card.component';

describe('KpiCardComponent', () => {
  let fixture: ComponentFixture<KpiCardComponent>;

  beforeEach(() => {
    fixture = TestBed.createComponent(KpiCardComponent);
    fixture.componentRef.setInput('id', 'revenue');
    fixture.componentRef.setInput('label', 'Revenue');
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('renders a test id, label and INR value', async () => {
    fixture.componentRef.setInput('format', 'inr');
    fixture.componentRef.setInput('kpi', { value: 1234567 });
    await fixture.whenStable();
    expect(el().getAttribute('data-testid')).toBe('kpi-revenue');
    expect(el().textContent).toContain('Revenue');
    expect(el().querySelector('[data-testid="kpi-value"]')?.textContent?.trim()).toBe('₹12,34,567');
  });

  it('shows change % only when compare is on', async () => {
    fixture.componentRef.setInput('kpi', { value: 120, previous: 100, changePct: 20 });
    await fixture.whenStable();
    expect(el().querySelector('[data-testid="kpi-change"]')).toBeNull();
    fixture.componentRef.setInput('compare', true);
    await fixture.whenStable();
    const change = el().querySelector('[data-testid="kpi-change"]')!;
    expect(change.textContent).toContain('+20.0%');
    expect(change.classList.contains('good')).toBe(true);
  });

  it('treats a rise as bad for lower-is-better metrics', async () => {
    fixture.componentRef.setInput('kpi', { value: 50, changePct: 10 });
    fixture.componentRef.setInput('compare', true);
    fixture.componentRef.setInput('lowerIsBetter', true);
    await fixture.whenStable();
    expect(el().querySelector('[data-testid="kpi-change"]')!.classList.contains('bad')).toBe(true);
  });

  it('shows a skeleton while loading', async () => {
    fixture.componentRef.setInput('loading', true);
    await fixture.whenStable();
    expect(el().querySelector('.skeleton')).not.toBeNull();
    expect(el().querySelector('[data-testid="kpi-value"]')).toBeNull();
  });

  it('helper functions', () => {
    expect(formatKpiValue(75, 'duration')).toBe('1m 15s');
    expect(formatKpiValue(12.34, 'pct')).toBe('12.3%');
    expect(trendOf(-5)).toEqual({ dir: 'down', good: false });
    expect(trendOf(0.01)).toEqual({ dir: 'flat', good: null });
    expect(trendOf(undefined)).toEqual({ dir: 'flat', good: null });
  });
});
