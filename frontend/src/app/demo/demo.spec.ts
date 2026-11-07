import { DemoBackend, DemoError, DemoRequest } from './demo-backend';
import { DemoDb } from './demo-db';
import { daysBetween, inDateRange, localIsoDate, makeDemoToken, paginate, parseCsv, presetFor, readDemoToken, scopeKey, shiftDate, shiftDeep, toCsvText } from './demo-utils';

describe('demo utils', () => {
  it('shifts dates and ISO timestamps but not other strings', () => {
    const out = shiftDeep(
      { date: '2026-10-05', ts: '2026-10-05T10:00:00.000Z', url: 'uploads/snapshots/1/2026-10-05/a.jpg', time: '10:00', n: 3, list: ['2026-09-30'] },
      3,
    );
    expect(out).toEqual({ date: '2026-10-08', ts: '2026-10-08T10:00:00.000Z', url: 'uploads/snapshots/1/2026-10-05/a.jpg', time: '10:00', n: 3, list: ['2026-10-03'] });
    expect(shiftDate('2026-12-30', 5)).toBe('2027-01-04');
    // timestamps can use an exact offset independent of the day shift
    expect(shiftDeep({ ts: '2026-10-05T10:00:00.000Z', d: '2026-10-05' }, 1, 3_600_000)).toEqual({ ts: '2026-10-05T11:00:00.000Z', d: '2026-10-06' });
    expect(daysBetween('2026-10-05', '2026-11-05')).toBe(31);
  });

  it('maps ranges to presets', () => {
    const t = '2026-10-20';
    expect(presetFor('2026-10-20', '2026-10-20', t)).toBe('today');
    expect(presetFor('2026-10-19', '2026-10-19', t)).toBe('yesterday');
    expect(presetFor('2026-10-14', '2026-10-20', t)).toBe('last7');
    expect(presetFor('2026-09-21', '2026-10-20', t)).toBe('last30');
    expect(presetFor('2026-10-01', '2026-10-20', t)).toBe('thisMonth');
    expect(presetFor('2026-10-01', '2026-10-25', t, 5)).toBe('last30'); // custom 25 days → nearest length
    expect(presetFor('2026-10-08', '2026-10-12', t, 5)).toBe('thisMonth'); // custom 5 days → nearest (thisMonth captured with 5 days)
    expect(presetFor(null, null, t)).toBe('last7');
  });

  it('scope keys', () => {
    expect(scopeKey([2], null, [1, 2, 3])).toBe('2');
    expect(scopeKey([1, 2], null, [1, 2, 3])).toBe('all');
    expect(scopeKey([], [3], [1, 2, 3])).toBe('3');
    expect(scopeKey([], null, [1, 2, 3])).toBe('all');
  });

  it('paginates and filters by date', () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], total: 5, page: 2, pageSize: 2 });
    expect(inDateRange('2026-10-05', '2026-10-01', '2026-10-05')).toBe(true);
    expect(inDateRange('2026-10-06', '2026-10-01', '2026-10-05')).toBe(false);
  });

  it('round-trips the fake token', () => {
    expect(readDemoToken('Bearer ' + makeDemoToken(7))).toBe(7);
    expect(readDemoToken(null)).toBeNull();
  });

  it('writes and parses CSV', () => {
    const csv = toCsvText([{ a: 'x,y', b: 'say "hi"' }, { a: 1, b: null }]);
    expect(parseCsv(csv)).toEqual([
      ['a', 'b'],
      ['x,y', 'say "hi"'],
      ['1', ''],
    ]);
    expect(parseCsv('a\n1\n2\n3', 2)).toHaveLength(2);
  });
});

describe('DemoBackend', () => {
  const today = localIsoDate();
  const captureDate = '2026-01-10';
  const shift = daysBetween(captureDate, today);
  const users = [
    { id: 1, email: 'admin@congruence.in', name: 'Admin', role: 'SUPER_ADMIN', isActive: true, storeIds: [], createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 5, email: 'staff.tnagar@congruence.in', name: 'Divya', role: 'STAFF', isActive: true, storeIds: [1], createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 3, email: 'manager.tnagar@congruence.in', name: 'Karthik', role: 'STORE_MANAGER', isActive: true, storeIds: [1], createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  const files: Record<string, unknown> = {
    'demo-data/meta.json': { captureDate, presets: { thisMonth: { from: '2026-01-01', to: '2026-01-10' } }, storeIds: [1, 2], videos: [] },
    'demo-data/master.json': {
      users,
      stores: [
        { id: 1, name: 'T Nagar' },
        { id: 2, name: 'Adyar' },
      ],
      cameras: [],
      zones: [],
      settings: {},
      regions: [],
      alertRules: [],
      reportSchedules: [],
      edgeDevices: [],
      staff: [],
      recorders: [{ id: 1, storeId: 1, name: 'NVR', kind: 'NVR', brand: 'HIKVISION', host: '10.0.0.5', rtspPort: 554, httpPort: 80, username: 'admin', hasPassword: true, channels: 4, stream: 'SUB', urlTemplate: null, status: 'UNKNOWN', lastCheckedAt: null, createdAt: '2026-01-01T00:00:00.000Z' }],
      probes: [],
      discovered: { 1: [{ host: '10.0.0.9', rtspPort: 554, httpPort: 80, brandGuess: 'DAHUA', onvif: true, seenAt: '2026-01-10T08:00:00.000Z' }] },
    },
    'demo-data/roles.json': { admin: { userId: 1, notifications: [{ id: 1, title: 'Hi', body: '', link: '/alerts/1', isRead: false, createdAt: '2026-01-10T09:00:00.000Z' }] } },
    'demo-data/ops.json': {
      alerts: [
        { id: 1, storeId: 1, status: 'OPEN', severity: 'HIGH', createdAt: '2026-01-10T08:00:00.000Z', ruleName: 'Queue', message: 'm', metric: 'QUEUE_LENGTH' },
        { id: 2, storeId: 2, status: 'OPEN', severity: 'LOW', createdAt: '2026-01-09T08:00:00.000Z', ruleName: 'Cam', message: 'm', metric: 'CAMERA_OFFLINE' },
      ],
      tasks: [{ id: 10, title: 'Old', storeId: 1, assigneeId: 5, status: 'TODO' }],
      tickets: [],
      ticketDetails: {},
      documents: [],
      vendors: [],
      visits: [],
    },
    'demo-data/trax.json': {
      templates: [
        {
          id: 1,
          name: 'Opening',
          questions: [
            { id: 1, type: 'YES_NO', weight: 2, text: 'Shutter', section: 'A', required: true, requiresPhoto: false, sortOrder: 0 },
            { id: 2, type: 'RATING', weight: 5, text: 'Look', section: 'A', required: true, requiresPhoto: false, sortOrder: 1, createTaskOnFail: false },
          ],
        },
      ],
      schedules: [],
      assignments: [{ id: 20, templateId: 1, storeId: 1, assigneeId: 5, status: 'PENDING', dueDate: '2026-01-10' }],
      draftAssignments: {},
      submissions: [],
      submissionAnswers: {},
    },
    'demo-data/misc.json': { posTransactions: [], auditLogs: [] },
    'demo-data/analytics-today.json': { all: { overview: { kpis: { footfall: { value: 10 } }, daily: [{ date: '2026-01-10' }] } }, '1': { overview: { kpis: { footfall: { value: 4 } }, daily: [] } } },
    'demo-data/analytics-last7.json': { all: { overview: { kpis: { footfall: { value: 70 } }, daily: [] } } },
  };
  const backend = () => new DemoBackend(new DemoDb((url) => (url in files ? Promise.resolve(structuredClone(files[url])) : Promise.reject(new Error('missing ' + url)))));
  const req = (method: string, path: string, opts: Partial<DemoRequest> = {}): DemoRequest => ({ method, path, params: new URLSearchParams(), body: null, auth: null, ...opts });
  const as = (id: number) => 'Bearer ' + makeDemoToken(id);

  it('logs in seed users with the demo password and rejects others', async () => {
    const b = backend();
    const res = await b.handle(req('POST', '/auth/login', { body: { email: 'admin@congruence.in', password: 'Password@123' } }));
    expect(res.status).toBe(201);
    expect(readDemoToken('Bearer ' + (res.body as { accessToken: string }).accessToken)).toBe(1);
    await expect(b.handle(req('POST', '/auth/login', { body: { email: 'admin@congruence.in', password: 'nope' } }))).rejects.toBeInstanceOf(DemoError);
    await expect(b.handle(req('GET', '/auth/me'))).rejects.toMatchObject({ status: 401 });
  });

  it('serves analytics by preset and scope with dates shifted to today', async () => {
    const b = backend();
    const q = (from: string, to: string, storeIds?: string) => new URLSearchParams({ from, to, ...(storeIds ? { storeIds } : {}) });
    const all = await b.handle(req('GET', '/analytics/overview', { auth: as(1), params: q(today, today) }));
    expect((all.body as { kpis: { footfall: { value: number } }; daily: { date: string }[] }).kpis.footfall.value).toBe(10);
    expect((all.body as { daily: { date: string }[] }).daily[0].date).toBe(today);
    const one = await b.handle(req('GET', '/analytics/overview', { auth: as(1), params: q(today, today, '1') }));
    expect((one.body as { kpis: { footfall: { value: number } } }).kpis.footfall.value).toBe(4);
    // a store manager without storeIds gets their own store
    const mgr = await b.handle(req('GET', '/analytics/overview', { auth: as(3), params: q(today, today) }));
    expect((mgr.body as { kpis: { footfall: { value: number } } }).kpis.footfall.value).toBe(4);
    expect(shift).toBe(daysBetween(captureDate, today));
  });

  it('scopes, pages and mutates alerts', async () => {
    const b = backend();
    const staffView = await b.handle(req('GET', '/alerts', { auth: as(3) }));
    expect((staffView.body as { total: number }).total).toBe(1);
    const acked = await b.handle(req('PATCH', '/alerts/1/ack', { auth: as(1) }));
    expect(acked.body).toMatchObject({ status: 'ACKNOWLEDGED', acknowledgedByName: 'Admin' });
    const open = await b.handle(req('GET', '/alerts', { auth: as(1), params: new URLSearchParams({ status: 'OPEN' }) }));
    expect((open.body as { items: { id: number }[] }).items.map((a) => a.id)).toEqual([2]);
    const ticket = await b.handle(req('POST', '/alerts/2/ticket', { auth: as(1) }));
    expect(ticket.body).toMatchObject({ category: 'CAMERA', number: 'TKT-00001', alertId: 2 });
  });

  it('creates tasks (manager) and limits staff to their own', async () => {
    const b = backend();
    await expect(b.handle(req('POST', '/tasks', { auth: as(5), body: { title: 'x', storeId: 1 } }))).rejects.toMatchObject({ status: 403 });
    const t = await b.handle(req('POST', '/tasks', { auth: as(3), body: { title: 'Restock', storeId: 1, assigneeId: 5 } }));
    expect(t.body).toMatchObject({ id: 11, status: 'TODO', storeName: 'T Nagar', assigneeName: 'Divya' });
    const mine = await b.handle(req('GET', '/tasks', { auth: as(5) }));
    expect((mine.body as unknown[]).length).toBe(2);
    const bulk = await b.handle(req('POST', '/tasks/bulk', { auth: as(1), body: { storeIds: [1, 2], title: 'Audit' } }));
    expect((bulk.body as unknown[]).length).toBe(2);
  });

  it('submits a checklist with the real scoring rules and updates the assignment', async () => {
    const b = backend();
    const res = await b.handle(
      req('POST', '/checklists/submissions', {
        auth: as(5),
        body: { assignmentId: 20, templateId: 1, storeId: 1, answers: [{ questionId: 1, value: 'NO' }, { questionId: 2, value: '4' }] },
      }),
    );
    expect(res.body).toMatchObject({ score: 4, maxScore: 7, scorePct: 57.14, flags: 1, status: 'SUBMITTED' });
    const a = await b.handle(req('GET', '/checklists/assignments/20', { auth: as(5) }));
    expect(a.body).toMatchObject({ status: 'SUBMITTED' });
    const detail = await b.handle(req('GET', `/checklists/submissions/${(res.body as { id: number }).id}`, { auth: as(1) }));
    expect((detail.body as { answers: { flagged: boolean }[] }).answers.map((x) => x.flagged)).toEqual([true, false]);
  });

  it('saves drafts and returns them on the assignment', async () => {
    const b = backend();
    await b.handle(req('POST', '/checklists/assignments/20/draft', { auth: as(5), body: { answers: [{ questionId: 1, value: 'YES' }] } }));
    const a = await b.handle(req('GET', '/checklists/assignments/20', { auth: as(5) }));
    expect(a.body).toMatchObject({ status: 'IN_PROGRESS', draftAnswers: [{ questionId: 1, value: 'YES' }] });
  });

  it('simulates recorder connection tests: pending → running → OK for most channels, AUTH for one, after ~1.5 s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const b = backend();
      const started = await b.handle(req('POST', '/recorders/1/test', { auth: as(1), body: {} }));
      const probes = started.body as { id: number; status: string; channel: number }[];
      expect(probes.map((p) => [p.channel, p.status])).toEqual([1, 2, 3, 4].map((ch) => [ch, 'PENDING']));
      vi.setSystemTime(Date.now() + 600);
      expect((await b.handle(req('GET', `/probes/${probes[0].id}`, { auth: as(1) }))).body).toMatchObject({ status: 'RUNNING' });
      vi.setSystemTime(Date.now() + 1000);
      const done = (await b.handle(req('GET', '/probes', { auth: as(1), params: new URLSearchParams({ recorderId: '1' }) }))).body as { channel: number; status: string; errorCode: string | null; width: number | null }[];
      expect(done.filter((p) => p.status === 'OK').map((p) => p.channel).sort()).toEqual([1, 2, 3]);
      expect(done.find((p) => p.channel === 4)).toMatchObject({ status: 'FAILED', errorCode: 'AUTH' });
      expect(done.find((p) => p.channel === 1)).toMatchObject({ width: 1920, codec: 'H.264' });
      const rec = (await b.handle(req('GET', '/recorders/1', { auth: as(1) }))).body as { status: string; lastCheckedAt: string | null; password?: string };
      expect(rec.status).toBe('PARTIAL');
      expect(rec.lastCheckedAt).not.toBeNull();
      expect((await b.handle(req('GET', '/recorders/discovered', { auth: as(1), params: new URLSearchParams({ storeId: '1' }) }))).body).toHaveLength(1);
      // generate cameras, then deleting the recorder needs ?unlinkCameras=true
      const cams = (await b.handle(req('POST', '/recorders/1/generate-cameras', { auth: as(1), body: { channels: [1, 2] } }))).body as { channel: number }[];
      expect(cams.map((c) => c.channel)).toEqual([1, 2]);
      await expect(b.handle(req('POST', '/recorders/1/generate-cameras', { auth: as(1), body: { channels: [9] } }))).rejects.toMatchObject({ status: 400 });
      await expect(b.handle(req('DELETE', '/recorders/1', { auth: as(1) }))).rejects.toMatchObject({ status: 409 });
      await b.handle(req('DELETE', '/recorders/1', { auth: as(1), params: new URLSearchParams({ unlinkCameras: 'true' }) }));
      await expect(b.handle(req('POST', '/recorders/1/test', { auth: as(5), body: {} }))).rejects.toMatchObject({ status: 403 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the contract v4 rules: answer validation, assignee scope, closed tickets, template versions, audit diffs', async () => {
    const b = backend();
    await expect(b.handle(req('POST', '/checklists/submissions', { auth: as(5), body: { assignmentId: 20, templateId: 1, storeId: 1, answers: [{ questionId: 1, value: 'YES' }] } }))).rejects.toMatchObject({
      status: 400,
      extra: { missingQuestionIds: [2] },
    });
    await expect(
      b.handle(req('POST', '/checklists/submissions', { auth: as(5), body: { assignmentId: 20, templateId: 1, storeId: 1, answers: [{ questionId: 1, value: 'MAYBE' }, { questionId: 2, value: '9' }] } })),
    ).rejects.toMatchObject({ status: 400, extra: { invalidAnswers: [{ questionId: 1, reason: 'must be YES or NO' }, { questionId: 2, reason: 'must be a rating from 0 to 5' }] } });
    // Divya works at store 1 only
    await expect(b.handle(req('POST', '/tasks', { auth: as(1), body: { title: 'x', storeId: 2, assigneeId: 5 } }))).rejects.toMatchObject({ status: 400 });
    const t = (await b.handle(req('POST', '/tickets', { auth: as(1), body: { title: 'Leak', storeId: 1, priority: 'HIGH' } }))).body as { id: number };
    await b.handle(req('PATCH', `/tickets/${t.id}/status`, { auth: as(1), body: { status: 'CLOSED' } }));
    await expect(b.handle(req('POST', `/tickets/${t.id}/comments`, { auth: as(1), body: { body: 'hi' } }))).rejects.toMatchObject({ status: 409 });
    const tpl = (await b.handle(req('GET', '/checklists/templates/1', { auth: as(1) }))).body as { questions: unknown[] };
    const v2 = (await b.handle(req('PUT', '/checklists/templates/1', { auth: as(1), body: { name: 'Opening v2', questions: tpl.questions } }))).body as { version: number };
    expect(v2.version).toBe(2);
    const sub = (await b.handle(req('POST', '/checklists/submissions', { auth: as(5), body: { assignmentId: 20, templateId: 1, storeId: 1, answers: [{ questionId: 1, value: 'YES' }, { questionId: 2, value: '5' }] } }))).body;
    expect(sub).toMatchObject({ templateVersion: 2, isLate: false });
    await b.handle(req('PATCH', '/stores/1', { auth: as(1), body: { name: 'T Nagar Main' } }));
    const logs = (await b.handle(req('GET', '/audit-logs', { auth: as(1), params: new URLSearchParams({ entity: 'stores' }) }))).body as { items: { details: { before: unknown; after: unknown } }[] };
    expect(logs.items[0].details).toMatchObject({ before: { name: 'T Nagar' }, after: { name: 'T Nagar Main' } });
    await expect(b.handle(req('GET', '/cameras/99/snapshot', { auth: as(1) }))).rejects.toMatchObject({ status: 404 });
  });

  it('answers unknown endpoints with 404', async () => {
    await expect(backend().handle(req('GET', '/nope', { auth: as(1) }))).rejects.toMatchObject({ status: 404 });
  });
});
