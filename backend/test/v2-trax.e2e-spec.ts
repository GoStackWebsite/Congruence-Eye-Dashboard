import { bearer, createTestApp, Ctx, istDate } from './helpers';
import { jpeg, MockAi, startMockAi } from './mock-ai';

describe('Trax v2: AI-in-Checklist, flags, auto tasks, drafts, schedules, nudges, dashboard, bulk tasks', () => {
  let c: Ctx;
  let ai: MockAi;
  let annManagerId: number;
  const as = (role: string) => ({
    get: (p: string) => c.http().get(p).set(bearer(c.tokens[role])),
    post: (p: string, b?: unknown) => c.http().post(p).set(bearer(c.tokens[role])).send(b as object),
    patch: (p: string, b?: unknown) => c.http().patch(p).set(bearer(c.tokens[role])).send(b as object),
    put: (p: string, b?: unknown) => c.http().put(p).set(bearer(c.tokens[role])).send(b as object),
    del: (p: string) => c.http().delete(p).set(bearer(c.tokens[role])),
  });
  const upload = async (buf: Buffer, name: string, type: string) =>
    (await c.http().post('/api/uploads').set(bearer(c.tokens.staff)).attach('file', buf, { filename: name, contentType: type }).expect(201)).body.url as string;
  const uid = (email: string) => c.seed.users.get(email);

  beforeAll(async () => {
    c = await createTestApp();
    ai = await startMockAi();
    await as('admin').put('/api/settings', { aiServiceUrl: ai.url }).expect(200);
    annManagerId = (await as('admin').post('/api/users', { email: 'manager.annanagar@congruence.in', name: 'Meena Rajendran', role: 'STORE_MANAGER', password: 'Password@123', storeIds: [c.seed.stores.annanagar] }).expect(201)).body.id;
  });
  afterAll(async () => {
    await ai.close();
    await c.app.close();
  });

  describe('AI-in-Checklist', () => {
    let tpl: { id: number; questions: { id: number; text: string }[] };
    let refUrl: string;
    let good: string;
    let bad: string;
    let video: string;
    const q = (n: number) => tpl.questions[n - 1].id;

    it('uploads accept images and videos (50 MB) only', async () => {
      refUrl = await upload(jpeg('REFERENCE'), 'ref.jpg', 'image/jpeg');
      good = await upload(jpeg('GOOD'), 'good.jpg', 'image/jpeg');
      bad = await upload(jpeg('BADIMAGE'), 'bad.jpg', 'image/jpeg');
      video = await upload(Buffer.from('00000018667479706d703432', 'hex'), 'clip.mp4', 'video/mp4');
      expect(video).toMatch(/\.mp4$/);
      await c.http().post('/api/uploads').set(bearer(c.tokens.staff)).attach('file', Buffer.from('x'), { filename: 'x.gif', contentType: 'image/gif' }).expect(400);
    });

    it('template with VIDEO / aiCheck / referenceImageUrl / createTaskOnFail', async () => {
      await as('auditor').post('/api/checklists/templates', { name: 'Bad', category: 'AUDIT', frequency: 'ADHOC', questions: [{ text: 'x', type: 'PHOTO', aiCheck: 'REFERENCE_MATCH' }] }).expect(400);
      await as('auditor').post('/api/checklists/templates', { name: 'Bad', category: 'AUDIT', frequency: 'ADHOC', questions: [{ text: 'x', type: 'TEXT', aiCheck: 'UNIFORM' }] }).expect(400);
      const r = await as('auditor').post('/api/checklists/templates', {
        name: 'Signage & Marketing Rollout', category: 'VISUAL_MERCHANDISING', frequency: 'ADHOC',
        questions: [
          { text: 'Photo of the Diwali signage', type: 'PHOTO', weight: 4, aiCheck: 'REFERENCE_MATCH', referenceImageUrl: refUrl, createTaskOnFail: true },
          { text: 'Standee placed at the entrance?', type: 'YES_NO', weight: 2 },
          { text: 'Staff grooming photo', type: 'PHOTO', weight: 2, aiCheck: 'UNIFORM' },
          { text: 'Walk-through video', type: 'VIDEO', weight: 1 },
        ],
      }).expect(201);
      tpl = r.body;
      expect(r.body.questions[0]).toMatchObject({ aiCheck: 'REFERENCE_MATCH', referenceImageUrl: refUrl, createTaskOnFail: true, requiresPhoto: true });
      expect(r.body.questions[3]).toMatchObject({ type: 'VIDEO', aiCheck: 'NONE', createTaskOnFail: false, requiresPhoto: true });
    });

    it('CHECKLIST_NON_COMPLIANCE rule + AI FAIL → score 0, flagged, auto task, alert', async () => {
      await as('admin').post('/api/alert-rules', { name: 'Checklist non-compliance', metric: 'CHECKLIST_NON_COMPLIANCE', threshold: 2, severity: 'HIGH', channels: ['IN_APP'] }).expect(201);
      ai.calls.length = 0;
      const r = await as('staff').post('/api/checklists/submissions', {
        templateId: tpl.id, storeId: c.seed.stores.tnagar,
        answers: [
          { questionId: q(1), value: '', photoUrl: bad },
          { questionId: q(2), value: 'NO', remark: 'Standee not delivered' },
          { questionId: q(3), value: '', photoUrl: good },
          { questionId: q(4), value: video },
        ],
      }).expect(201);
      expect(r.body).toMatchObject({ score: 3, maxScore: 9, scorePct: 33.33, flags: 2 });
      const a = Object.fromEntries(r.body.answers.map((x: { questionId: number }) => [x.questionId, x]));
      expect(a[q(1)]).toMatchObject({ score: 0, flagged: true, aiResult: { status: 'FAIL', score: 0.31, message: 'Signage does not match the approved reference', issues: ['banner missing'], annotatedUrl: expect.stringMatching(/^\/uploads\/ai\/.+\.jpg$/) } });
      expect(a[q(2)]).toMatchObject({ score: 0, flagged: true, aiResult: null });
      expect(a[q(3)]).toMatchObject({ score: 2, flagged: false, aiResult: { status: 'PASS', score: 0.92, message: 'Groomed', issues: [] } });
      expect(a[q(4)]).toMatchObject({ score: 1, flagged: false, value: video });
      await c.http().get(a[q(1)].aiResult.annotatedUrl).expect(200);
      expect(ai.calls.map((x) => x.path).sort()).toEqual(['/ai/checklist/reference-match', '/ai/checklist/uniform']);
      expect(ai.calls.find((x) => x.path.includes('reference')).fields).toEqual(['image', 'reference']);
      // auto task only for the createTaskOnFail question
      const tasks = (await as('admin').get('/api/tasks').expect(200)).body;
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ type: 'FOLLOW_UP', checklistAnswerId: a[q(1)].id, title: 'Fix: Photo of the Diwali signage', assigneeName: 'Karthik Subramanian', priority: 'HIGH', storeId: c.seed.stores.tnagar });
      const alerts = (await as('admin').get('/api/alerts').expect(200)).body.items;
      expect(alerts[0]).toMatchObject({ metric: 'CHECKLIST_NON_COMPLIANCE', value: 2, storeId: c.seed.stores.tnagar });
      // deviation → manual follow-up task
      const t = await as('manager').post(`/api/checklists/answers/${a[q(2)].id}/task`, { assigneeId: uid('staff.tnagar@congruence.in'), dueAt: new Date(Date.now() + 86400000).toISOString(), priority: 'URGENT' }).expect(201);
      expect(t.body).toMatchObject({ type: 'FOLLOW_UP', checklistAnswerId: a[q(2)].id, title: 'Follow-up: Standee placed at the entrance?', priority: 'URGENT', assigneeName: 'Divya Murugan' });
      await as('staff').post(`/api/checklists/answers/${a[q(2)].id}/task`, { assigneeId: 1, dueAt: new Date().toISOString() }).expect(403);
    });

    it('ai-service down → aiResult ERROR, answer not penalised', async () => {
      await as('admin').put('/api/settings', { aiServiceUrl: 'http://127.0.0.1:9' }).expect(200);
      const r = await as('staff').post('/api/checklists/submissions', {
        templateId: tpl.id, storeId: c.seed.stores.tnagar,
        answers: [{ questionId: q(1), value: '', photoUrl: bad }, { questionId: q(2), value: 'YES' }, { questionId: q(3), value: '', photoUrl: good }, { questionId: q(4), value: video }],
      }).expect(201);
      expect(r.body).toMatchObject({ score: 9, maxScore: 9, scorePct: 100, flags: 0 });
      const a1 = r.body.answers.find((x: { questionId: number }) => x.questionId === q(1));
      expect(a1).toMatchObject({ score: 4, flagged: false, aiResult: { status: 'ERROR', score: 0, issues: [] } });
      expect(a1.aiResult.message).toMatch(/AI service unavailable/);
      await as('admin').put('/api/settings', { aiServiceUrl: ai.url }).expect(200);
    });

    it('POST /checklists/ai-check preview', async () => {
      const fail = await c.http().post('/api/checklists/ai-check').set(bearer(c.tokens.staff)).field('type', 'REFERENCE_MATCH').field('referenceUrl', refUrl).attach('image', jpeg('BADIMAGE'), 'a.jpg').expect(200);
      expect(fail.body).toMatchObject({ status: 'FAIL', score: 0.31, issues: ['banner missing'], annotatedUrl: expect.any(String) });
      const pass = await c.http().post('/api/checklists/ai-check').set(bearer(c.tokens.staff)).field('type', 'UNIFORM').attach('image', jpeg('GOOD'), 'a.jpg').expect(200);
      expect(pass.body).toEqual({ status: 'PASS', score: 0.92, message: 'Groomed', issues: [] });
      const skip = await c.http().post('/api/checklists/ai-check').set(bearer(c.tokens.staff)).field('type', 'REFERENCE_MATCH').attach('image', jpeg('GOOD'), 'a.jpg').expect(200);
      expect(skip.body.status).toBe('SKIPPED');
      await c.http().post('/api/checklists/ai-check').set(bearer(c.tokens.staff)).field('type', 'NOPE').attach('image', jpeg('GOOD'), 'a.jpg').expect(400);
      await as('admin').put('/api/settings', { aiServiceUrl: 'http://127.0.0.1:9' }).expect(200);
      const err = await c.http().post('/api/checklists/ai-check').set(bearer(c.tokens.staff)).field('type', 'UNIFORM').attach('image', jpeg('GOOD'), 'a.jpg').expect(200);
      expect(err.body.status).toBe('ERROR');
      await as('admin').put('/api/settings', { aiServiceUrl: ai.url }).expect(200);
    });
  });

  describe('drafts, schedules, nudges', () => {
    let mini: { id: number; questions: { id: number }[] };
    let scheduleId: number;
    beforeAll(async () => {
      mini = (await as('auditor').post('/api/checklists/templates', { name: 'Mini', category: 'OPENING', frequency: 'DAILY', questions: [{ text: 'Lights on?', type: 'YES_NO' }, { text: 'Staff count', type: 'NUMBER', minValue: 1, maxValue: 5 }] }).expect(201)).body;
    });

    it('draft → IN_PROGRESS, merged, cleared on submit', async () => {
      const a = (await as('manager').post('/api/checklists/assignments', { templateId: mini.id, storeId: c.seed.stores.tnagar, assigneeId: uid('staff.tnagar@congruence.in'), dueDate: istDate(1) }).expect(201)).body;
      let d = await as('staff').post(`/api/checklists/assignments/${a.id}/draft`, { answers: [{ questionId: mini.questions[0].id, value: 'YES' }] }).expect(200);
      expect(d.body).toMatchObject({ status: 'IN_PROGRESS', draftAnswers: [{ questionId: mini.questions[0].id, value: 'YES', photoUrl: null, remark: null }] });
      d = await as('staff').post(`/api/checklists/assignments/${a.id}/draft`, { answers: [{ questionId: mini.questions[1].id, value: 3 }] }).expect(200);
      expect(d.body.draftAnswers).toHaveLength(2);
      await as('staff').post('/api/checklists/assignments/99999/draft', { answers: [] }).expect(404);
      expect((await as('staff').get('/api/checklists/assignments?status=IN_PROGRESS').expect(200)).body.map((x: { id: number }) => x.id)).toEqual([a.id]);
      await as('staff').post('/api/checklists/submissions', { assignmentId: a.id, templateId: mini.id, storeId: c.seed.stores.tnagar, answers: d.body.draftAnswers }).expect(201);
      const after = (await as('staff').get(`/api/checklists/assignments/${a.id}`).expect(200)).body;
      expect(after).toMatchObject({ status: 'SUBMITTED', draftAnswers: null });
    });

    it('schedule CRUD + idempotent generation', async () => {
      await as('staff').post('/api/checklists/schedules', {}).expect(403);
      const today = istDate(0);
      const r = await as('regional').post('/api/checklists/schedules', {
        templateId: mini.id, storeIds: [c.seed.stores.tnagar, c.seed.stores.annanagar], frequency: 'DAILY', windowStart: '00:00', windowEnd: '23:59', startDate: today, reminderMinutesBefore: 30,
      }).expect(201);
      scheduleId = r.body.id;
      expect(r.body).toEqual({
        id: scheduleId, templateId: mini.id, templateName: 'Mini', storeIds: [c.seed.stores.tnagar, c.seed.stores.annanagar], assigneeId: null, frequency: 'DAILY', repeatEvery: 1, daysOfWeek: [], dayOfMonth: null,
        windowStart: '00:00', windowEnd: '23:59', startDate: today, endDate: null, reminderMinutesBefore: 30, isActive: true, lastGeneratedDate: null,
      });
      await as('regional').post('/api/checklists/schedules', { ...r.body, id: undefined, templateName: undefined, lastGeneratedDate: undefined, windowStart: '10:00', windowEnd: '09:00' }).expect(400);
      expect((await as('regional').post(`/api/checklists/schedules/${scheduleId}/generate`).expect(200)).body).toEqual({ created: 2 });
      expect((await as('regional').post(`/api/checklists/schedules/${scheduleId}/generate`).expect(200)).body).toEqual({ created: 0 });
      const gen = (await as('admin').get('/api/checklists/assignments').expect(200)).body.filter((x: { scheduleId: number }) => x.scheduleId === scheduleId);
      expect(gen).toHaveLength(2);
      expect(gen.map((x: { assigneeId: number }) => x.assigneeId).sort()).toEqual([uid('manager.tnagar@congruence.in'), annManagerId].sort());
      expect(gen[0]).toMatchObject({ dueDate: today, windowStart: expect.any(String), dueAt: expect.any(String) });
      expect(Date.parse(gen[0].dueAt) - Date.parse(gen[0].windowStart)).toBe(23 * 3600_000 + 59 * 60_000);
      const list = (await as('manager').get('/api/checklists/schedules').expect(200)).body;
      expect(list[0].lastGeneratedDate).toBe(today);
      // a weekly schedule on another weekday creates nothing today
      const otherDow = (new Date(today + 'T00:00:00Z').getUTCDay() + 3) % 7;
      const w = await as('regional').post('/api/checklists/schedules', { templateId: mini.id, storeIds: [c.seed.stores.tnagar], frequency: 'WEEKLY', daysOfWeek: [otherDow], windowStart: '09:00', windowEnd: '10:00', startDate: istDate(-7) }).expect(201);
      expect((await as('regional').post(`/api/checklists/schedules/${w.body.id}/generate`).expect(200)).body).toEqual({ created: 0 });
      expect((await as('regional').patch(`/api/checklists/schedules/${w.body.id}`, { isActive: false }).expect(200)).body.isActive).toBe(false);
      await as('regional').del(`/api/checklists/schedules/${w.body.id}`).expect(200);
    });

    it('nudges: one reminder before due, overdue → notifications + CHECKLIST_OVERDUE alert', async () => {
      await as('admin').post('/api/alert-rules', { name: 'Checklist overdue', metric: 'CHECKLIST_OVERDUE', threshold: 1, severity: 'MEDIUM', channels: ['IN_APP'] }).expect(201);
      await as('manager').post('/api/checklists/nudges/run').expect(403);
      const staffId = uid('staff.tnagar@congruence.in');
      const soon = (await as('manager').post('/api/checklists/assignments', { templateId: mini.id, storeId: c.seed.stores.tnagar, assigneeId: staffId, dueDate: istDate(0), dueAt: new Date(Date.now() + 30 * 60000).toISOString() }).expect(201)).body;
      const late = (await as('manager').post('/api/checklists/assignments', { templateId: mini.id, storeId: c.seed.stores.tnagar, assigneeId: staffId, dueDate: istDate(0), dueAt: new Date(Date.now() + 3 * 3600_000).toISOString() }).expect(201)).body;
      await c.ds.query('UPDATE checklist_assignments SET dueAt = ? WHERE id = ?', [new Date(Date.now() - 5 * 60000).toISOString().replace('T', ' ').replace('Z', ''), late.id]);
      const before = (await as('staff').get('/api/notifications').expect(200)).body.length;
      const r1 = await as('admin').post('/api/checklists/nudges/run').expect(200);
      expect(r1.body.overdue).toBe(1);
      expect(r1.body.reminders).toBeGreaterThanOrEqual(1);
      const notes = (await as('staff').get('/api/notifications').expect(200)).body;
      expect(notes.length - before).toBe(r1.body.reminders + 1);
      expect(notes.some((n: { title: string; link: string }) => n.title === 'Reminder: Mini' && n.link === `/checklists/assignments/${soon.id}`)).toBe(true);
      expect(notes.some((n: { title: string; link: string }) => n.title === 'Overdue: Mini' && n.link === `/checklists/assignments/${late.id}`)).toBe(true);
      expect((await as('manager').get('/api/notifications').expect(200)).body.some((n: { title: string }) => n.title === 'Overdue: Mini')).toBe(true);
      expect((await as('staff').get(`/api/checklists/assignments/${late.id}`).expect(200)).body.status).toBe('OVERDUE');
      const alerts = (await as('admin').get('/api/alerts?metric=CHECKLIST_OVERDUE').expect(200)).body.items;
      expect(alerts[0]).toMatchObject({ metric: 'CHECKLIST_OVERDUE', value: 1, storeId: c.seed.stores.tnagar });
      const r2 = await as('admin').post('/api/checklists/nudges/run').expect(200);
      expect(r2.body).toEqual({ reminders: 0, overdue: 0 });
    });
  });

  describe('Trax dashboard (store 3 only)', () => {
    it('exact counts by checklist / store / user', async () => {
      const s3 = c.seed.stores.coimbatore;
      const auditor = uid('auditor@congruence.in');
      const tpl = (await as('auditor').post('/api/checklists/templates', { name: 'CBE Daily', category: 'OPENING', frequency: 'DAILY', questions: [{ text: 'Lights on?', type: 'YES_NO' }, { text: 'Staff count', type: 'NUMBER', minValue: 1, maxValue: 5 }] }).expect(201)).body;
      const mk = async (dueDate: string) => (await as('auditor').post('/api/checklists/assignments', { templateId: tpl.id, storeId: s3, assigneeId: auditor, dueDate }).expect(201)).body;
      const a1 = await mk(istDate(0));
      const a2 = await mk(istDate(0));
      await mk(istDate(0));
      await mk(istDate(-1));
      const sub = await as('auditor').post('/api/checklists/submissions', { assignmentId: a1.id, templateId: tpl.id, storeId: s3, answers: [{ questionId: tpl.questions[0].id, value: 'NO' }, { questionId: tpl.questions[1].id, value: 3 }] }).expect(201);
      expect(sub.body).toMatchObject({ scorePct: 50, flags: 1 });
      await as('auditor').post(`/api/checklists/assignments/${a2.id}/draft`, { answers: [{ questionId: tpl.questions[0].id, value: 'YES' }] }).expect(200);
      const r = await as('admin').get(`/api/checklists/dashboard?storeIds=${s3}&from=${istDate(-1)}&to=${istDate(0)}`).expect(200);
      expect(r.body).toEqual({
        activeChecklists: 1, checklistInstances: 4, notSubmitted: 1, open: 1, inProgress: 1, submitted: 1,
        completionScorePct: 25, complianceScorePct: 50, totalFlags: 1,
        byChecklist: [{ templateId: tpl.id, name: 'CBE Daily', frequency: 'DAILY', stores: 1, assigned: 4, submitted: 1, flags: 1, completionPct: 25, compliancePct: 50 }],
        byStore: [{ storeId: s3, storeName: 'Congruence RS Puram', assigned: 4, submitted: 1, flags: 1, completionPct: 25, compliancePct: 50 }],
        byUser: [{ userId: auditor, name: 'Lakshmi Narayanan (Auditor)', assigned: 4, submitted: 1, flags: 1, completionPct: 25, compliancePct: 50 }],
      });
      const mgr = await as('manager').get(`/api/checklists/dashboard?storeIds=${s3}`).expect(200);
      expect(mgr.body.checklistInstances).toBe(0);
    });
  });

  describe('tasks v2', () => {
    it('bulk across stores, startAt visibility, status with proof', async () => {
      await as('staff').post('/api/tasks/bulk', { storeIds: [c.seed.stores.tnagar], title: 'x' }).expect(403);
      await as('manager').post('/api/tasks/bulk', { storeIds: [c.seed.stores.tnagar, c.seed.stores.annanagar], title: 'x' }).expect(403);
      const r = await as('admin').post('/api/tasks/bulk', { storeIds: [c.seed.stores.tnagar, c.seed.stores.annanagar], title: 'Install Diwali standee', type: 'VISUAL_MERCHANDISING', priority: 'HIGH', dueAt: new Date(Date.now() + 2 * 86400000).toISOString() }).expect(201);
      expect(r.body).toHaveLength(2);
      expect(r.body.map((t: { storeId: number; assigneeId: number; type: string }) => [t.storeId, t.assigneeId, t.type])).toEqual([
        [c.seed.stores.tnagar, uid('manager.tnagar@congruence.in'), 'VISUAL_MERCHANDISING'],
        [c.seed.stores.annanagar, annManagerId, 'VISUAL_MERCHANDISING'],
      ]);
      const future = await as('manager').post('/api/tasks', { title: 'Night shift audit', storeId: c.seed.stores.tnagar, assigneeId: uid('staff.tnagar@congruence.in'), startAt: new Date(Date.now() + 86400000).toISOString() }).expect(201);
      expect(future.body.startAt).toBeTruthy();
      const now = await as('manager').post('/api/tasks', { title: 'Restock bags', storeId: c.seed.stores.tnagar, assigneeId: uid('staff.tnagar@congruence.in') }).expect(201);
      const mine = (await as('staff').get('/api/tasks?mine=true').expect(200)).body.map((t: { id: number }) => t.id);
      expect(mine).toContain(now.body.id);
      expect(mine).not.toContain(future.body.id);
      const done = await as('staff').patch(`/api/tasks/${now.body.id}/status`, { status: 'DONE', proofUrl: '/uploads/files/proof.jpg', remark: 'Restocked 200 bags' }).expect(200);
      expect(done.body).toMatchObject({ status: 'DONE', proofUrl: '/uploads/files/proof.jpg', remark: 'Restocked 200 bags', checklistAnswerId: null });
    });
  });
});
