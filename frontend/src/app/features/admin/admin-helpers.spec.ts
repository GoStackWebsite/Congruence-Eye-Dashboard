import { AuditLog, Probe } from '../../core/models/api.models';
import { clock12, deltaText, minutesDelta, ocLabel } from '../ai-manager/open-close.page';
import { complianceTone } from '../ai-manager/summary.page';
import { evidenceKind, localDay } from '../alerts/alerts.page';
import { cameraSegments } from '../infra/infra-health.page';
import { isoDay } from '../../shared/ds/ops.styles';
import { auditDiff, parseAudit, serverDiff, stateBefore } from './audit-log.page';
import { channelCells } from './recorders/channels-grid.component';
import { shiftMinutes } from './staff.page';
import { maskRtsp } from './store/cameras-panel.component';
import { snapPoint } from './zone-editor.component';
import { userStoreNames } from './users.page';

const log = (id: number, action: string, body: Record<string, unknown> | null, entityId = 7): AuditLog => ({
  id,
  userId: 1,
  userName: 'Arun',
  action,
  entity: 'stores',
  entityId,
  details: JSON.stringify({ method: 'PATCH', path: '/api/stores/7', body: body ?? undefined }),
  createdAt: '2026-10-05T10:00:00Z',
});

describe('audit diff', () => {
  it('parses the interceptor details (string or object)', () => {
    expect(parseAudit('{"method":"PATCH","path":"/api/x","body":{"a":1}}')).toEqual({ method: 'PATCH', path: '/api/x', body: { a: 1 } });
    expect(parseAudit({ method: 'DELETE', path: '/api/x/1' }).body).toBeNull();
    expect(parseAudit('not json')).toEqual({ method: null, path: null, body: null });
    expect(parseAudit(null).method).toBeNull();
  });
  it('rebuilds the state before an entry from older CREATE / UPDATE entries of the same record', () => {
    const entries = [log(1, 'CREATE', { name: 'A', closeTime: '21:00' }), log(5, 'UPDATE', { closeTime: '21:30' }), log(9, 'UPDATE', { name: 'B' })];
    expect(stateBefore(entries, 9)).toEqual({ name: 'A', closeTime: '21:30' });
    expect(stateBefore(entries, 1)).toBeNull();
  });
  it('marks changed, added, unchanged and removed fields', () => {
    const d = auditDiff({ name: 'A', closeTime: '21:30' }, { name: 'B', closeTime: '21:30', areaSqft: 4200 }, 'UPDATE');
    expect(d.map((r) => [r.key, r.kind])).toEqual([
      ['name', 'changed'],
      ['areaSqft', 'added'],
      ['closeTime', 'same'],
    ]);
    expect(d[0]).toMatchObject({ before: 'A', after: 'B' });
    expect(auditDiff({ name: 'A' }, null, 'DELETE')).toEqual([{ key: 'name', before: 'A', after: null, kind: 'removed' }]);
    expect(auditDiff(null, { isActive: false }, 'CREATE')).toEqual([{ key: 'isActive', before: null, after: 'false', kind: 'added' }]);
  });
  it('prefers the server before / after snapshot (contract v4)', () => {
    const p = parseAudit({ method: 'PATCH', path: '/api/stores/7', body: { name: 'B', city: 'Chennai' }, before: { name: 'A' }, after: { name: 'B' } });
    expect(serverDiff(p, 'UPDATE')).toEqual([
      { key: 'name', before: 'A', after: 'B', kind: 'changed' },
      { key: 'city', before: 'Chennai', after: 'Chennai', kind: 'same' },
    ]);
    expect(serverDiff(parseAudit({ method: 'DELETE', before: { name: 'A', id: 7 } }), 'DELETE')!.map((r) => [r.key, r.kind])).toEqual([
      ['id', 'removed'],
      ['name', 'removed'],
    ]);
    expect(serverDiff(parseAudit({ method: 'PATCH', body: { a: 1 } }), 'UPDATE')).toBeNull();
  });
});

describe('open / close helpers', () => {
  it('computes minutes early / late and labels', () => {
    expect(minutesDelta('10:00', '09:52')).toBe(-8);
    expect(minutesDelta('21:30', '21:34')).toBe(4);
    expect(minutesDelta('21:30', null)).toBeNull();
    expect(deltaText(-8)).toBe('8 mins early');
    expect(deltaText(1)).toBe('1 min late');
    expect(deltaText(0)).toBe('On schedule');
    expect(ocLabel('EARLY', 'close')).toBe('Early close');
    expect(ocLabel('LATE', 'open')).toBe('Late open');
    expect(ocLabel('ON_TIME', 'open')).toBe('On time');
    expect(clock12('18:40')).toBe('6:40 PM');
    expect(clock12('00:05')).toBe('12:05 AM');
    expect(clock12(null)).toBeNull();
  });
  it('compliance tone bands', () => {
    expect([95, 80, 60, NaN].map(complianceTone)).toEqual(['good', 'warn', 'bad', 'bad']);
  });
});

describe('ops helpers', () => {
  it('masks inline RTSP passwords', () => {
    expect(maskRtsp('rtsp://admin:secret@10.0.0.10:554/x')).toBe('rtsp://admin:****@10.0.0.10:554/x');
    expect(maskRtsp('rtsp://10.0.0.10:554/x')).toBe('rtsp://10.0.0.10:554/x');
    expect(maskRtsp(null)).toBe('');
  });
  it('camera mini bar segments', () => {
    expect(cameraSegments(3, 5)).toEqual(['on', 'on', 'on', 'off', 'off']);
    expect(cameraSegments(0, 0)).toEqual([]);
    expect(cameraSegments(30, 60).length).toBe(24);
    expect(cameraSegments(7, 5)).toEqual(['on', 'on', 'on', 'on', 'on']);
  });
  it('alert evidence kind and store-local day', () => {
    expect(evidenceKind('AI_MANAGER_BREACH')).toBe('detections');
    expect(evidenceKind('CAMERA_OFFLINE')).toBe('snapshots');
    expect(evidenceKind('CHECKLIST_OVERDUE')).toBe('none');
    expect(localDay('2026-10-05T19:30:00Z')).toBe('2026-10-06');
  });
  it('shift length wraps past midnight', () => {
    expect(shiftMinutes('10:00', '19:00')).toBe(540);
    expect(shiftMinutes('22:00', '06:00')).toBe(480);
    expect(shiftMinutes('10:00', '10:00')).toBeNull();
  });
  it('user store names: admins see all stores', () => {
    const name = (id: number) => `S${id}`;
    expect(userStoreNames({ role: 'ADMIN', storeIds: [1] }, name)).toEqual([]);
    expect(userStoreNames({ role: 'STORE_MANAGER', storeIds: [1, 4] }, name)).toEqual(['S1', 'S4']);
  });
  it('formats ISO days and snaps zone points', () => {
    expect(isoDay('2026-10-05')).toBe('05 Oct 2026');
    expect(isoDay(null)).toBeNull();
    expect(snapPoint([0.2049, 0.3012], [])).toEqual([0.2, 0.3]);
    expect(snapPoint([0.21, 0.31], [[0.2, 0.3]])).toEqual([0.2, 0.3]);
    expect(snapPoint([1.004, -0.002], [])).toEqual([1, 0]);
  });
  it('channel cells: linked camera and newest probe per channel', () => {
    const p = (id: number, ch: number, at: string, status: Probe['status']): Probe =>
      ({ id, storeId: 1, cameraId: null, recorderId: 9, channel: ch, status, requestedAt: at }) as Probe;
    const cells = channelCells(4, 9, [{ id: 3, name: 'Cash', recorderId: 9, channel: 2 } as never], [p(1, 2, '2026-10-05T10:00Z', 'FAILED'), p(2, 2, '2026-10-05T11:00Z', 'OK'), p(3, 9, '2026-10-05T11:00Z', 'OK')]);
    expect(cells.map((c) => c.channel)).toEqual([1, 2, 3, 4]);
    expect(cells[1].camera?.name).toBe('Cash');
    expect(cells[1].probe?.status).toBe('OK');
    expect(cells[0].probe).toBeNull();
    expect(channelCells(80, 9, [], []).length).toBe(64);
  });
});
