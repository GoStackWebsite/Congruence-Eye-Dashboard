import { BenchmarkRow } from '../core/models/api.models';
import { emptyDraft, directionArrow, zonePayload } from './admin/zone-editor.component';
import { deviceHealth } from './admin/edge-devices.page';
import { auditDetails } from './admin/audit-log.page';
import { benchmarkCsv } from './analytics/benchmark.page';
import { paintHeatmap } from './analytics/heatmap.page';
import { toAcyclicSankey } from './analytics/journey.page';
import { scoreCellColor } from './checklists/compliance.page';
import { canMoveTask } from './tasks/tasks.page';
import { TICKET_FLOW } from './tickets/ticket-detail.page';
import { isSlaBreached } from './tickets/tickets.page';

describe('journey → sankey', () => {
  it('removes cycles and self links, keeping the heavier direction', () => {
    const r = toAcyclicSankey({
      nodes: [
        { id: 0, name: 'Entrance' },
        { id: 1, name: 'Ethnic' },
        { id: 2, name: 'Kids' },
      ],
      links: [
        { source: 0, target: 1, count: 50 },
        { source: 1, target: 2, count: 20 },
        { source: 2, target: 1, count: 5 },
        { source: 1, target: 1, count: 9 },
      ],
    });
    expect(r.links).toEqual([
      { source: 'Entrance', target: 'Ethnic', value: 50 },
      { source: 'Ethnic', target: 'Kids', value: 20 },
    ]);
    expect(r.nodes.map((n) => n.name)).toEqual(['Entrance', 'Ethnic', 'Kids']);
  });

  it('disambiguates duplicate node names', () => {
    const r = toAcyclicSankey({ nodes: [{ id: 0, name: 'Entrance' }, { id: 5, name: 'Sarees' }, { id: 6, name: 'Sarees' }], links: [{ source: 0, target: 5, count: 1 }, { source: 0, target: 6, count: 1 }] });
    expect(new Set(r.nodes.map((n) => n.name)).size).toBe(3);
  });
});

describe('benchmark CSV', () => {
  it('quotes values that need it', () => {
    const row = { rank: 1, storeName: 'T Nagar, Chennai', regionName: 'Chennai', footfall: 10, footfallChangePct: 5, conversionPct: 20, revenue: 1000, atv: 100, revenuePerSqft: 1, avgDwellSec: 300, avgQueueWaitSec: 30, complianceScore: 90, storeId: 1 } as BenchmarkRow;
    const csv = benchmarkCsv([row]).split('\n');
    expect(csv[0].startsWith('Rank,Store,Region')).toBe(true);
    expect(csv[1]).toContain('"T Nagar, Chennai"');
  });
});

describe('heatmap painter', () => {
  it('paints only non-zero cells', () => {
    const calls: unknown[] = [];
    const ctx = { clearRect: () => undefined, fillRect: (...a: unknown[]) => calls.push(a), fillStyle: '' } as unknown as CanvasRenderingContext2D;
    const grid = new Array(32 * 18).fill(0);
    grid[0] = 5;
    grid[33] = 10;
    expect(paintHeatmap(ctx, { cameraId: 1, width: 32, height: 18, grid, max: 10 }, 320, 180, 0.7)).toBe(2);
    expect(calls[0]).toEqual([0, 0, 10, 10]);
  });
});

describe('tickets & tasks', () => {
  it('detects SLA breach', () => {
    const now = Date.parse('2026-10-05T12:00:00Z');
    expect(isSlaBreached({ isSlaBreached: false, slaDueAt: '2026-10-05T10:00:00Z', status: 'OPEN', resolvedAt: null }, now)).toBe(true);
    expect(isSlaBreached({ isSlaBreached: false, slaDueAt: '2026-10-05T14:00:00Z', status: 'OPEN', resolvedAt: null }, now)).toBe(false);
    expect(isSlaBreached({ isSlaBreached: false, slaDueAt: '2026-10-05T10:00:00Z', status: 'RESOLVED', resolvedAt: '2026-10-05T09:00:00Z' }, now)).toBe(false);
    expect(isSlaBreached({ isSlaBreached: true, slaDueAt: null, status: 'OPEN', resolvedAt: null }, now)).toBe(true);
  });
  it('ticket workflow allows reopening closed tickets', () => {
    expect(TICKET_FLOW.CLOSED).toEqual(['REOPENED']);
  });
  it('task board move rules', () => {
    expect(canMoveTask('TODO', 'IN_PROGRESS', false)).toBe(true);
    expect(canMoveTask('DONE', 'VERIFIED', false)).toBe(false);
    expect(canMoveTask('DONE', 'VERIFIED', true)).toBe(true);
    expect(canMoveTask('TODO', 'VERIFIED', true)).toBe(false);
    expect(canMoveTask('VERIFIED', 'TODO', true)).toBe(false);
  });
});

describe('zone editor helpers', () => {
  it('builds payloads per type', () => {
    const line = { ...emptyDraft('ENTRY_LINE'), name: ' Door ', polygon: [[0.1, 0.5], [0.9, 0.5]] as [number, number][] };
    const p = zonePayload(line, 1, 2);
    expect(p).toMatchObject({ storeId: 1, cameraId: 2, name: 'Door', type: 'ENTRY_LINE', inDirection: 'DOWN', queueAlertLength: null });
    const q = zonePayload({ ...emptyDraft('QUEUE'), name: 'Billing', queueAlertLength: 5, queueAlertWaitSec: 120 }, 1, 2);
    expect(q).toMatchObject({ inDirection: null, queueAlertLength: 5, queueAlertWaitSec: 120 });
  });
  it('computes direction arrows', () => {
    expect(directionArrow([[0, 0.5], [1, 0.5]], 'DOWN')).toEqual({ x1: 500, y1: 500, x2: 500, y2: 580 });
    expect(directionArrow([[0, 0.5]], 'DOWN')).toBeNull();
  });
});

describe('misc admin helpers', () => {
  it('device health from lastSeenAt', () => {
    const now = Date.parse('2026-10-05T12:00:00Z');
    expect(deviceHealth({ lastSeenAt: null }, now)).toBe('UNKNOWN');
    expect(deviceHealth({ lastSeenAt: '2026-10-05T11:58:00Z' }, now)).toBe('ONLINE');
    expect(deviceHealth({ lastSeenAt: '2026-10-05T10:00:00Z' }, now)).toBe('OFFLINE');
  });
  it('audit details stringify', () => {
    expect(auditDetails({ a: 1 })).toBe('{"a":1}');
    expect(auditDetails('{"b":2}')).toBe('{"b":2}');
    expect(auditDetails('plain')).toBe('plain');
    expect(auditDetails(null)).toBe('');
  });
  it('compliance cell colours are sequential', () => {
    expect(scoreCellColor(null)).toBeNull();
    expect(scoreCellColor(0)!.fg).toBe('#0b0b0b');
    expect(scoreCellColor(100)!.fg).toBe('#ffffff');
  });
});
