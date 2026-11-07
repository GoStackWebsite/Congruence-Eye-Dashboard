import { TestBed } from '@angular/core/testing';
import { EmptyStateComponent, StatusChipComponent } from './ui.components';

describe('StatusChipComponent', () => {
  it('maps values to tone, icon and label', async () => {
    const f = TestBed.createComponent(StatusChipComponent);
    f.componentRef.setInput('value', 'CRITICAL');
    await f.whenStable();
    const chip = (f.nativeElement as HTMLElement).querySelector('.ce-chip')!;
    expect(chip.classList.contains('tone-critical')).toBe(true);
    expect(chip.textContent).toContain('Critical');
    expect(chip.getAttribute('data-value')).toBe('CRITICAL');
  });

  it('supports a custom label and unknown values', async () => {
    const f = TestBed.createComponent(StatusChipComponent);
    f.componentRef.setInput('value', 'SOMETHING_ELSE');
    f.componentRef.setInput('label', 'Custom');
    await f.whenStable();
    const chip = (f.nativeElement as HTMLElement).querySelector('.ce-chip')!;
    expect(chip.classList.contains('tone-neutral')).toBe(true);
    expect(chip.textContent).toContain('Custom');
  });
});

describe('EmptyStateComponent', () => {
  it('renders title and message with a testid', async () => {
    const f = TestBed.createComponent(EmptyStateComponent);
    f.componentRef.setInput('title', 'No data');
    f.componentRef.setInput('message', 'Try another range');
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.getAttribute('data-testid')).toBe('empty-state');
    expect(el.textContent).toContain('No data');
    expect(el.textContent).toContain('Try another range');
  });
});
