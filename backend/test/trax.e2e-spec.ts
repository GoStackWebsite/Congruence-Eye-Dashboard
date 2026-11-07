import { bearer, createTestApp, Ctx, istDate } from './helpers';

describe('Trax: checklists, tasks, tickets', () => {
  let c: Ctx;
  beforeAll(async () => (c = await createTestApp()));
  afterAll(async () => c.app.close());
  const as = (role: string) => ({
    get: (p: string) => c.http().get(p).set(bearer(c.tokens[role])),
    post: (p: string, b?: unknown) => c.http().post(p).set(bearer(c.tokens[role])).send(b as object),
    patch: (p: string, b?: unknown) => c.http().patch(p).set(bearer(c.tokens[role])).send(b as object),
    put: (p: string, b?: unknown) => c.http().put(p).set(bearer(c.tokens[role])).send(b as object),
    del: (p: string) => c.http().delete(p).set(bearer(c.tokens[role])),
  });

  describe('checklists', () => {
    let tpl: { id: number; questions: { id: number; text: string }[] };
    let assignmentId: number;
    let submissionId: number;
    const qid = (n: number) => tpl.questions[n - 1].id;
    const template = {
      name: 'Mixed Audit',
      description: 'All question types',
      category: 'AUDIT',
      frequency: 'WEEKLY',
      questions: [
        { section: 'Entrance', text: 'Q1 Entrance clean?', type: 'YES_NO', weight: 2 },
        { section: 'Entrance', text: 'Q2 Greeter position', type: 'MCQ_SINGLE', options: ['A', 'B', 'C'], correctOptions: ['B'], weight: 3 },
        { section: 'Display', text: 'Q3 Displays present', type: 'MCQ_MULTI', options: ['A', 'B', 'C'], correctOptions: ['A', 'C'], weight: 4 },
        { section: 'Display', text: 'Q4 Rate VM', type: 'RATING', weight: 5 },
        { section: 'Safety', text: 'Q5 AC temperature', type: 'NUMBER', minValue: 18, maxValue: 24, weight: 2 },
        { section: 'Safety', text: 'Q6 Notes', type: 'TEXT', weight: 1 },
        { section: 'Safety', text: 'Q7 Photo of entrance', type: 'PHOTO', weight: 3 },
        { section: 'Safety', text: 'Q8 Any option', type: 'MCQ_SINGLE', options: ['X', 'Y'], weight: 1 },
        { section: 'Safety', text: 'Q9 Optional', type: 'YES_NO', weight: 1, required: false },
      ],
    };

    it('template create (role-gated)', async () => {
      await as('staff').post('/api/checklists/templates', template).expect(403);
      await as('manager').post('/api/checklists/templates', template).expect(403);
      await as('auditor').post('/api/checklists/templates', { ...template, questions: [{ text: 'x', type: 'MCQ_SINGLE', options: ['a'], correctOptions: ['z'] }] }).expect(400);
      const r = await as('auditor').post('/api/checklists/templates', template).expect(201);
      tpl = r.body;
      expect(r.body).toMatchObject({ name: 'Mixed Audit', category: 'AUDIT', frequency: 'WEEKLY', isActive: true });
      expect(r.body.questions).toHaveLength(9);
      expect(r.body.questions[1]).toMatchObject({ type: 'MCQ_SINGLE', options: ['A', 'B', 'C'], correctOptions: ['B'], weight: 3, required: true, sortOrder: 2 });
      expect(r.body.questions[6]).toMatchObject({ type: 'PHOTO', requiresPhoto: true });
    });

    it('assignment create + list', async () => {
      await as('staff').post('/api/checklists/assignments', { templateId: tpl.id, storeId: c.seed.stores.tnagar, assigneeId: c.seed.users.get('staff.tnagar@congruence.in'), dueDate: istDate(1) }).expect(403);
      await as('manager').post('/api/checklists/assignments', { templateId: tpl.id, storeId: c.seed.stores.annanagar, assigneeId: c.seed.users.get('staff.tnagar@congruence.in'), dueDate: istDate(1) }).expect(403);
      const r = await as('manager').post('/api/checklists/assignments', { templateId: tpl.id, storeId: c.seed.stores.tnagar, assigneeId: c.seed.users.get('staff.tnagar@congruence.in'), dueDate: istDate(1) }).expect(201);
      assignmentId = r.body.id;
      expect(r.body).toEqual({ id: assignmentId, templateId: tpl.id, templateName: 'Mixed Audit', storeId: c.seed.stores.tnagar, storeName: 'Congruence T Nagar', assigneeId: c.seed.users.get('staff.tnagar@congruence.in'), assigneeName: 'Divya Murugan', dueDate: istDate(1), status: 'PENDING', submissionId: null, dueAt: expect.any(String), windowStart: null, scheduleId: null });
      // an overdue one
      await as('manager').post('/api/checklists/assignments', { templateId: tpl.id, storeId: c.seed.stores.tnagar, assigneeId: c.seed.users.get('staff.tnagar@congruence.in'), dueDate: istDate(-1) }).expect(201);
      const mine = await as('staff').get('/api/checklists/assignments?mine=true').expect(200);
      expect(mine.body).toHaveLength(2);
      expect(mine.body.map((a: { status: string }) => a.status).sort()).toEqual(['OVERDUE', 'PENDING']);
      const one = await as('staff').get(`/api/checklists/assignments/${assignmentId}`).expect(200);
      expect(one.body.template.questions).toHaveLength(9);
    });

    it('submission scoring (mixed types) = 17 / 22', async () => {
      const answers = (q2: string) => [
        { questionId: qid(1), value: 'YES' },
        { questionId: qid(2), value: q2 },
        { questionId: qid(3), value: ['C', 'A'] },
        { questionId: qid(4), value: '4' },
        { questionId: qid(5), value: 22 },
        { questionId: qid(6), value: 'All good', remark: 'fine' },
        { questionId: qid(7), value: '', photoUrl: '/uploads/files/x.jpg' },
        { questionId: qid(8), value: 'Y' },
      ];
      await as('staff').post('/api/checklists/submissions', { assignmentId, templateId: tpl.id, storeId: c.seed.stores.tnagar, answers: answers('A').slice(1) }).expect(400);
      const r = await as('staff').post('/api/checklists/submissions', { assignmentId, templateId: tpl.id, storeId: c.seed.stores.tnagar, answers: answers('A') }).expect(201);
      submissionId = r.body.id;
      expect(r.body).toMatchObject({ assignmentId, templateName: 'Mixed Audit', storeName: 'Congruence T Nagar', submittedByName: 'Divya Murugan', score: 17, maxScore: 22, scorePct: 77.27, status: 'SUBMITTED', reviewerComment: null });
      const byQ = Object.fromEntries(r.body.answers.map((a: { questionId: number; score: number }) => [a.questionId, a.score]));
      expect(byQ).toEqual({ [qid(1)]: 2, [qid(2)]: 0, [qid(3)]: 4, [qid(4)]: 4, [qid(5)]: 2, [qid(6)]: 1, [qid(7)]: 3, [qid(8)]: 1 });
      expect(r.body.answers.find((a: { questionId: number }) => a.questionId === qid(3)).value).toBe('["C","A"]');
      const a = await as('staff').get(`/api/checklists/assignments/${assignmentId}`).expect(200);
      expect(a.body).toMatchObject({ status: 'SUBMITTED', submissionId });
      await as('staff').post('/api/checklists/submissions', { assignmentId, templateId: tpl.id, storeId: c.seed.stores.tnagar, answers: answers('B') }).expect(409);
    });

    it('review REDO then resubmit and APPROVE', async () => {
      await as('staff').patch(`/api/checklists/submissions/${submissionId}/review`, { status: 'APPROVED' }).expect(403);
      const redo = await as('auditor').patch(`/api/checklists/submissions/${submissionId}/review`, { status: 'REDO', comment: 'Fix greeter', redoQuestionIds: [qid(2)] }).expect(200);
      expect(redo.body).toMatchObject({ status: 'REDO', reviewerComment: 'Fix greeter' });
      expect(redo.body.answers.filter((x: { redo: boolean }) => x.redo).map((x: { questionId: number }) => x.questionId)).toEqual([qid(2)]);
      expect((await as('staff').get(`/api/checklists/assignments/${assignmentId}`)).body.status).toBe('REDO');
      const again = await as('staff').post('/api/checklists/submissions', {
        assignmentId, templateId: tpl.id, storeId: c.seed.stores.tnagar,
        answers: [
          { questionId: qid(1), value: true }, { questionId: qid(2), value: 'B' }, { questionId: qid(3), value: '["A","C"]' }, { questionId: qid(4), value: 4 },
          { questionId: qid(5), value: '22' }, { questionId: qid(6), value: 'ok' }, { questionId: qid(7), photoUrl: '/uploads/files/y.jpg', value: null }, { questionId: qid(8), value: 'X' },
        ],
      }).expect(201);
      expect(again.body).toMatchObject({ score: 20, maxScore: 22, scorePct: 90.91 });
      const ok = await as('manager').patch(`/api/checklists/submissions/${again.body.id}/review`, { status: 'APPROVED', comment: 'Good' }).expect(200);
      expect(ok.body.status).toBe('APPROVED');
      expect((await as('staff').get(`/api/checklists/assignments/${assignmentId}`)).body).toMatchObject({ status: 'APPROVED', submissionId: again.body.id });
      const full = await as('auditor').get(`/api/checklists/submissions/${again.body.id}`).expect(200);
      expect(full.body.template.name).toBe('Mixed Audit');
      expect(full.body.answers).toHaveLength(8);
    });

    it('compliance', async () => {
      const r = await as('admin').get(`/api/checklists/compliance?storeIds=${c.seed.stores.tnagar}`).expect(200);
      expect(r.body).toEqual([
        { storeId: c.seed.stores.tnagar, storeName: 'Congruence T Nagar', submissions: 2, avgScorePct: 84.09, overdue: 1, byCategory: [{ category: 'AUDIT', avgScorePct: 84.09 }] },
      ]);
      const list = await as('admin').get(`/api/checklists/submissions?templateId=${tpl.id}&from=${istDate(0)}&to=${istDate(0)}`).expect(200);
      expect(list.body).toHaveLength(2);
      const ov = await as('admin').get(`/api/analytics/overview?storeIds=${c.seed.stores.tnagar}`).expect(200);
      expect(ov.body.kpis.complianceScore.value).toBe(84.09);
    });

    it('template PUT replaces questions; DELETE deactivates', async () => {
      const r = await as('auditor').put(`/api/checklists/templates/${tpl.id}`, {
        name: 'Mixed Audit v2', category: 'AUDIT', frequency: 'MONTHLY',
        questions: [{ id: qid(1), text: 'Entrance spotless?', type: 'YES_NO', weight: 2 }, { text: 'New question', type: 'TEXT' }],
      }).expect(200);
      expect(r.body.name).toBe('Mixed Audit v2');
      expect(r.body.questions.map((q: { id: number; text: string }) => q.text)).toEqual(['Entrance spotless?', 'New question']);
      expect(r.body.questions[0].id).toBe(qid(1));
      // historic submission still readable
      await as('auditor').get(`/api/checklists/submissions/${submissionId}`).expect(200);
      await as('auditor').del(`/api/checklists/templates/${tpl.id}`).expect(200);
      expect((await as('auditor').get(`/api/checklists/templates/${tpl.id}`)).body.isActive).toBe(false);
    });
  });

  describe('tasks', () => {
    let taskId: number;
    const staffId = () => c.seed.users.get('staff.tnagar@congruence.in');
    it('create (STORE_MANAGER+) incl. ZONE_ALLOCATION', async () => {
      await as('staff').post('/api/tasks', { title: 'x', storeId: c.seed.stores.tnagar }).expect(403);
      await as('manager').post('/api/tasks', { title: 'Zone duty', storeId: c.seed.stores.tnagar, type: 'ZONE_ALLOCATION' }).expect(400);
      await as('manager').post('/api/tasks', { title: 'Zone duty', storeId: c.seed.stores.tnagar, type: 'ZONE_ALLOCATION', zoneId: 99999 }).expect(400);
      const r = await as('manager').post('/api/tasks', { title: "Cover Men's Wear 6-8pm", description: 'Peak hours', storeId: c.seed.stores.tnagar, zoneId: c.seed.zones.mens, type: 'ZONE_ALLOCATION', priority: 'HIGH', assigneeId: staffId(), dueAt: new Date(Date.now() + 86400000).toISOString() }).expect(201);
      taskId = r.body.id;
      expect(r.body).toMatchObject({ status: 'TODO', type: 'ZONE_ALLOCATION', zoneId: c.seed.zones.mens, assigneeName: 'Divya Murugan', createdByName: 'Karthik Subramanian', storeName: 'Congruence T Nagar', completedAt: null, verifiedAt: null });
    });
    it('assignee moves status; only managers verify', async () => {
      await as('staff').patch(`/api/tasks/${taskId}`, { title: 'hack' }).expect(403);
      await as('staff').patch(`/api/tasks/${taskId}/verify`).expect(403);
      expect((await as('staff').patch(`/api/tasks/${taskId}/status`, { status: 'IN_PROGRESS' }).expect(200)).body.status).toBe('IN_PROGRESS');
      await as('manager').patch(`/api/tasks/${taskId}/verify`).expect(400);
      const done = await as('staff').patch(`/api/tasks/${taskId}/status`, { status: 'DONE' }).expect(200);
      expect(done.body.completedAt).toBeTruthy();
      await as('staff').patch(`/api/tasks/${taskId}/status`, { status: 'VERIFIED' }).expect(403);
      const v = await as('manager').patch(`/api/tasks/${taskId}/verify`).expect(200);
      expect(v.body.status).toBe('VERIFIED');
      expect(v.body.verifiedAt).toBeTruthy();
      expect((await as('staff').get('/api/tasks?mine=true').expect(200)).body).toHaveLength(1);
      expect((await as('admin').get(`/api/tasks?status=VERIFIED&assigneeId=${staffId()}`).expect(200)).body).toHaveLength(1);
      const p = await as('manager').patch(`/api/tasks/${taskId}`, { priority: 'LOW', status: 'CANCELLED' }).expect(200);
      expect(p.body).toMatchObject({ priority: 'LOW', status: 'CANCELLED' });
      await as('manager').del(`/api/tasks/${taskId}`).expect(200);
      await as('manager').get(`/api/tasks/${taskId}`).expect(404);
    });
  });

  describe('tickets', () => {
    let id: number;
    it('any role creates; SLA by priority', async () => {
      const r = await as('staff').post('/api/tickets', { title: 'Planogram mismatch in Footwear', description: 'Shelf 3', storeId: c.seed.stores.tnagar, category: 'PLANOGRAM', priority: 'URGENT' }).expect(201);
      id = r.body.id;
      expect(r.body).toMatchObject({ number: `TKT-${String(id).padStart(5, '0')}`, status: 'OPEN', reporterName: 'Divya Murugan', assigneeId: null, assigneeName: null, alertId: null, isSlaBreached: false, comments: [] });
      expect(Date.parse(r.body.slaDueAt) - Date.parse(r.body.createdAt)).toBe(4 * 3600_000);
      await as('staff').post('/api/tickets', { title: 'x', storeId: c.seed.stores.annanagar, category: 'CAMERA', priority: 'LOW' }).expect(403);
      await as('staff').post('/api/tickets', { title: 'x', storeId: c.seed.stores.tnagar, category: 'NOPE', priority: 'LOW' }).expect(400);
    });
    it('comments, assignment and status flow', async () => {
      const cm = await as('staff').post(`/api/tickets/${id}/comments`, { body: 'Photo attached' }).expect(201);
      expect(cm.body).toMatchObject({ userName: 'Divya Murugan', body: 'Photo attached' });
      await as('staff').patch(`/api/tickets/${id}/status`, { status: 'IN_PROGRESS' }).expect(403);
      const a = await as('manager').patch(`/api/tickets/${id}`, { assigneeId: c.seed.users.get('staff.tnagar@congruence.in'), priority: 'HIGH' }).expect(200);
      expect(a.body).toMatchObject({ assigneeName: 'Divya Murugan', priority: 'HIGH' });
      expect(Date.parse(a.body.slaDueAt) - Date.parse(a.body.createdAt)).toBe(24 * 3600_000);
      await as('staff').patch(`/api/tickets/${id}/status`, { status: 'IN_PROGRESS' }).expect(200);
      const res = await as('staff').patch(`/api/tickets/${id}/status`, { status: 'RESOLVED' }).expect(200);
      expect(res.body.resolvedAt).toBeTruthy();
      expect(res.body.comments).toHaveLength(1);
      const re = await as('manager').patch(`/api/tickets/${id}/status`, { status: 'REOPENED' }).expect(200);
      expect(re.body.resolvedAt).toBeNull();
      expect((await as('admin').get('/api/tickets?category=PLANOGRAM&status=REOPENED').expect(200)).body).toHaveLength(1);
      expect((await as('admin').get('/api/tickets?priority=LOW').expect(200)).body).toHaveLength(0);
    });
    it('SLA breach flag', async () => {
      const r = await as('manager').post('/api/tickets', { title: 'Camera 2 blurry', storeId: c.seed.stores.tnagar, category: 'CAMERA', priority: 'URGENT' }).expect(201);
      await c.ds.query('UPDATE tickets SET slaDueAt = ? WHERE id = ?', ['2020-01-01 00:00:00.000', r.body.id]);
      const g = await as('manager').get(`/api/tickets/${r.body.id}`).expect(200);
      expect(g.body.isSlaBreached).toBe(true);
    });
  });
});
