import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { navFor, navMatch } from '../../core/auth/permissions';
import { Store, ZoneAnalytics } from '../../core/models/api.models';
import { dominantAge, maxSharePct } from '../../features/analytics/zone-concentration.component';
import { openCloseExtras, parseEmails } from '../../features/ai-manager/ai-rule.helpers';
import { IndianDateAdapter, storeClusters, storeSelectionLabel } from '../../layout/global-filter.component';
import { avatarTone, initialsOf } from './avatar.component';
import { STATUS_LABELS, toneOf } from './status-tones';
import { DrawerComponent, drawerHasOverlayOnTop } from './layout.components';
import { shortDate } from '../../core/utils/dates';
import { guardConversionTotals, guardOverviewKpis, markPartialDay } from '../../features/analytics/analytics-helpers';
import { CeColumn, TableComponent } from './table.component';

describe('design system helpers', () => {
  it('maps statuses to one tone each (case-insensitive) and falls back to neutral', () => {
    expect(toneOf('BREACHED')).toBe('critical');
    expect(toneOf('on_time')).toBe('good');
    expect(toneOf('EARLY')).toBe('serious');
    expect(toneOf('whatever')).toBe('neutral');
    expect(toneOf(null)).toBe('neutral');
    // QA gaps: tasks and recorder / probe states
    expect(STATUS_LABELS['TODO']).toBe('To do');
    expect(toneOf('PARTIAL')).toBe('warning');
    expect(toneOf('RUNNING')).toBe('info');
    expect(toneOf('OK')).toBe('good');
    expect(toneOf('FAILED')).toBe('critical');
    expect(toneOf('EXPIRED')).toBe('warning');
  });

  it('formats date cells from plain dates and from full ISO timestamps (store-local day)', () => {
    expect(shortDate('2026-10-05')).toMatch(/05 Oct/);
    expect(shortDate('2026-10-05T20:00:00.000Z')).toMatch(/06 Oct/); // 01:30 IST on the 6th
    expect(shortDate('not a date')).toBe('not a date');
  });

  it('zero denominators become null ("--"), never 0 %', () => {
    const k = guardOverviewKpis({ footfall: { value: 0 }, transactions: { value: 0 }, conversionPct: { value: 0 }, atv: { value: 0 }, revenue: { value: 0 } } as never) as Record<string, { value: number | null }>;
    expect(k['conversionPct'].value).toBeNull();
    expect(k['atv'].value).toBeNull();
    expect(k['revenue'].value).toBe(0);
    const t = guardConversionTotals({ conversionPct: 0, atv: 0, itemsPerBill: 0, transactions: 0, revenue: 0 }, 0)!;
    expect([t.conversionPct, t.atv, t.itemsPerBill]).toEqual([null, null, null]);
  });

  it("marks today's point of a daily chart as partial and never plots a false 0", () => {
    const opt = { xAxis: { data: ['04 Oct', '05 Oct'] }, series: [{ type: 'bar', data: [10, 4] }, { type: 'line', data: [8, 0] }] };
    const out = markPartialDay(opt, 1, 4) as { xAxis: { data: string[] }; series: { data: unknown[] }[] };
    expect(out.xAxis.data[1]).toBe('05 Oct (so far)');
    expect((out.series[0].data[1] as { value: number }).value).toBe(4);
    expect(out.series[1].data[1]).toBeNull();
  });

  it('builds initials and a stable avatar colour', () => {
    expect(initialsOf('Arun Kumar')).toBe('AK');
    expect(initialsOf('Admin (HQ)')).toBe('AD');
    expect(initialsOf('priya.raman@congruence.in')).toBe('PI');
    expect(initialsOf('')).toBe('?');
    expect(avatarTone('Arun Kumar')).toEqual(avatarTone('Arun Kumar'));
  });

  it('groups stores by region/format and labels the selection', () => {
    const s = (id: number, regionName: string, format?: string) => ({ id, name: `Store ${id}`, regionName, format }) as unknown as Store;
    const stores = [s(1, 'Chennai', 'FLAGSHIP'), s(2, 'Chennai', 'MALL'), s(3, 'Coimbatore', 'MALL')];
    const regions = storeClusters(stores, 'region');
    expect(regions.map((c) => [c.label, c.ids])).toEqual([
      ['Chennai', [1, 2]],
      ['Coimbatore', [3]],
    ]);
    const formats = storeClusters(stores, 'format');
    expect(formats.find((c) => c.label === 'Mall')?.ids).toEqual([2, 3]);
    expect(storeSelectionLabel([], stores, regions)).toBe('All stores');
    expect(storeSelectionLabel([2], stores, regions)).toBe('Store 2');
    expect(storeSelectionLabel([2, 1], stores, regions)).toBe('Chennai (2)');
    expect(storeSelectionLabel([1, 3], stores, regions)).toBe('2 stores');
  });

  it('nav: modules per role and longest-prefix matching for breadcrumbs', () => {
    const admin = navFor('SUPER_ADMIN');
    expect(admin.map((m) => m.id)).toEqual(['home', 'traffic', 'zone', 'revenue', 'trax', 'ai-manager', 'store-ops', 'reports', 'admin']);
    const staff = navFor('STAFF');
    expect(staff.map((m) => m.id)).toEqual(['trax', 'store-ops']);
    expect(navMatch(admin, '/checklists/dashboard?tab=store')?.item.id).toBe('checklist-dashboard');
    expect(navMatch(admin, '/checklists')?.item.id).toBe('checklist-templates');
    expect(navMatch(admin, '/checklists/templates/new')).toBeNull();
    expect(navMatch(admin, '/admin/stores/3/cameras')?.module.id).toBe('admin');
  });

  it('zone concentration helpers', () => {
    const z = (visits: number, band: string | null) => ({ visits, dominantAgeBand: band }) as ZoneAnalytics;
    expect(dominantAge([z(10, '25-34'), z(30, '35-44'), z(25, '25-34')])).toBe('25-34');
    expect(dominantAge([])).toBeNull();
    expect(maxSharePct({ cameraId: 1, width: 2, height: 1, grid: [1, 3], max: 3 })).toBe(75);
    expect(maxSharePct(null)).toBe(0);
  });

  it('AI rule editor helpers', () => {
    expect(parseEmails(' a@x.in, b@x.in;a@x.in  c@x.in ')).toEqual(['a@x.in', 'b@x.in', 'c@x.in']);
    expect(parseEmails(null)).toEqual([]);
    expect(openCloseExtras({ toleranceMin: 10 })).toBeNull();
    expect(openCloseExtras({ monitorBeforeOpenMin: 30, monitorAfterCloseMin: 0 })).toEqual({ monitorBeforeOpenMin: 30, monitorAfterCloseMin: 0 });
  });
});

interface Row {
  id: number;
  name: string;
  submitted: number | null;
}

@Component({
  imports: [TableComponent],
  template: `<ce-table [rows]="rows()" [columns]="cols" testId="t" [rowTestId]="rowId" [searchable]="true" [pageSize]="10" />`,
})
class HostComponent {
  readonly rows = signal<Row[]>([
    { id: 1, name: 'Opening', submitted: 1200 },
    { id: 2, name: 'Closing', submitted: null },
    { id: 3, name: 'Hygiene', submitted: 40 },
  ]);
  readonly cols: CeColumn<Row>[] = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'submitted', header: 'Submitted', type: 'link-number', sortable: true, click: () => undefined },
  ];
  readonly rowId = (r: Row) => `row-${r.id}`;
}

describe('ce-table', () => {
  it('renders rows, "--" for empty values, link numbers, sorting and search', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideRouter([])] });
    const f = TestBed.createComponent(HostComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const ids = () => [...el.querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-testid'));
    expect(ids()).toEqual(['row-1', 'row-2', 'row-3']);
    expect(el.querySelector('[data-testid="row-2"]')?.textContent).toContain('--');
    expect(el.querySelector('[data-testid="row-1"] .ce-num-link')?.textContent?.trim()).toBe('1,200');
    // sort by submitted (desc first); blanks last
    (el.querySelectorAll('.ce-th-sort')[1] as HTMLButtonElement).click();
    await f.whenStable();
    expect(ids()).toEqual(['row-1', 'row-3', 'row-2']);
    // search
    const input = el.querySelector('input[type=search]') as HTMLInputElement;
    input.value = 'hyg';
    input.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(ids()).toEqual(['row-3']);
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(el.querySelector('[data-testid="empty-state"]')?.getAttribute('data-kind')).toBe('filtered');
  });
});

@Component({
  imports: [DrawerComponent],
  template: `<ce-drawer [(open)]="open" title="Edit"><input data-testid="x" /></ce-drawer>`,
})
class DrawerHost {
  readonly open = signal(true);
}

describe('ce-drawer', () => {
  it('closes on Escape, but not when the Escape was handled by something on top (defaultPrevented)', async () => {
    TestBed.configureTestingModule({ imports: [DrawerHost] });
    const f = TestBed.createComponent(DrawerHost);
    await f.whenStable();
    const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    handled.preventDefault();
    document.dispatchEvent(handled);
    await f.whenStable();
    expect(f.componentInstance.open()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await f.whenStable();
    expect(f.componentInstance.open()).toBe(false);
    expect(drawerHasOverlayOnTop(document)).toBe(false);
  });
});

@Component({
  imports: [TableComponent],
  template: `<ce-table [rows]="rows" [columns]="cols" [rowTestId]="rowId" />`,
})
class CardsHost {
  readonly rows = [{ id: 1, name: 'Opening', at: '2026-10-05T15:52:14.000Z', note: 'x' }];
  readonly cols: CeColumn<{ id: number; name: string; at: string; note: string }>[] = [
    { key: 'name', header: 'Checklist' },
    { key: 'at', header: 'Created', type: 'date' },
    { key: 'note', header: 'Note', mobileHide: true },
  ];
  readonly rowId = (r: { id: number }) => `row-${r.id}`;
}

describe('ce-table phone cards', () => {
  it('labels every cell for the stacked-card layout, hides mobileHide cells and formats ISO dates', async () => {
    TestBed.configureTestingModule({ imports: [CardsHost], providers: [provideRouter([])] });
    const f = TestBed.createComponent(CardsHost);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('ce-table')?.classList.contains('m-cards')).toBe(true);
    const tds = [...el.querySelectorAll('[data-testid="row-1"] td')];
    expect(tds.map((td) => td.getAttribute('data-label'))).toEqual(['Checklist', 'Created', 'Note']);
    expect(tds[2].hasAttribute('data-m-hide')).toBe(true);
    expect(tds[1].textContent?.trim()).toMatch(/^05 Oct$/);
  });
});

describe('global filter date typing', () => {
  it('parses dd/mm/yyyy, dd-mm-yy and ISO; rejects impossible dates', () => {
    TestBed.configureTestingModule({ providers: [IndianDateAdapter] });
    const a = TestBed.inject(IndianDateAdapter);
    const iso = (d: Date | null) => (d && a.isValid(d) ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : 'invalid');
    expect(iso(a.parse('28/09/2026'))).toBe('2026-9-28');
    expect(iso(a.parse('01-10-26'))).toBe('2026-10-1');
    expect(iso(a.parse('2026-10-05'))).toBe('2026-10-5');
    expect(iso(a.parse('31/02/2026'))).toBe('invalid');
  });
});
