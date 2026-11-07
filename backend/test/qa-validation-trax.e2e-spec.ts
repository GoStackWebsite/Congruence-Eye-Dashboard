import * as http from 'http';
import { DataSource } from 'typeorm';
import { Role } from '../src/common/roles';
import { addDays, zonedToUtc } from '../src/common/time.util';
import { ChecklistAssignment } from '../src/modules/checklists/entities/checklist-assignment.entity';
import { ChecklistSchedule } from '../src/modules/checklists/entities/checklist-schedule.entity';
import { SchedulesService } from '../src/modules/checklists/schedules.service';
import { Region } from '../src/modules/regions/entities/region.entity';
import { Store } from '../src/modules/stores/entities/store.entity';
import { TicketsService } from '../src/modules/tickets/tickets.service';
import { bearer, createTestApp, Ctx, istDate } from './helpers';
import { jpeg } from './mock-ai';

/** QA edge-case plan §5 (validation / security), §6 (Trax checklists) and §7 (tasks / tickets). */
describe('QA §5-7: validation & security, Trax, tasks & tickets', () => {
  let c: Ctx;
  type Who = 'admin' | 'regional' | 'manager' | 'auditor' | 'staff';
  const as = (who: Who) => ({
    get: (p: string) => c.http().get(p).set(bearer(c.tokens[who])),
    post: (p: string, b?: unknown) => c.http().post(p).set(bearer(c.tokens[who])).send(b as object),
    patch: (p: string, b?: unknown) => c.http().patch(p).set(bearer(c.tokens[who])).send(b as object),
    put: (p: string, b?: unknown) => c.http().put(p).set(bearer(c.tokens[who])).send(b as object),
    del: (p: string) => c.http().delete(p).set(bearer(c.tokens[who])),
  });
  const uid = (email: string) => c.seed.users.get(email)!;
  beforeAll(async () => (c = await createTestApp()));
  afterAll(async () => c.app.close());

  // ------------------------------------------------------------------ §5
  describe('§5 validation & security', () => {
    const SQLI = ["' OR '1'='1", "'; DROP TABLE stores; --", '1 UNION SELECT passwordHash FROM users--', 'Robert"); DELETE FROM tasks;--'];
    const XSS = ['<script>alert(1)</script>', '<img src=x onerror=alert(document.cookie)>', '"><svg onload=alert(1)>', 'javascript:alert(1)'];

    it('V1 injection / XSS strings are stored verbatim and returned as JSON data (no HTML rendering)', async () => {
      for (const s of [...SQLI, ...XSS]) {
        const region = await as('admin').post('/api/regions', { name: s }).expect(201);
        expect(region.body.name).toBe(s);
        expect(region.headers['content-type']).toMatch(/application\/json/);
        const task = await as('manager').post('/api/tasks', { storeId: c.seed.stores.tnagar, title: s, description: s }).expect(201);
        expect(task.body).toMatchObject({ title: s, description: s });
        const t = await as('staff').post('/api/tickets', { storeId: c.seed.stores.tnagar, title: s, description: s, category: 'OTHER', priority: 'LOW' }).expect(201);
        const cm = await as('staff').post(`/api/tickets/${t.body.id}/comments`, { body: s }).expect(201);
        expect(cm.body.body).toBe(s);
        const v = await as('manager').post('/api/vendors', { name: s, category: 'OTHER', contactName: s }).expect(201);
        expect(v.body.name).toBe(s);
      }
      // the tables are all still there and intact
      expect((await as('admin').get('/api/stores').expect(200)).body).toHaveLength(3);
      expect((await as('admin').get('/api/users').expect(200)).body.length).toBeGreaterThanOrEqual(5);
    });

    it('V1b filters with injection strings → 200 (empty), never 500', async () => {
      const q = encodeURIComponent("' OR 1=1 --");
      const urls = [
        `/api/tickets?category=${q}&priority=${q}&status=${q}`, `/api/tasks?status=${q}&type=${q}&assigneeId=${q}`, `/api/alerts?metric=${q}&status=${q}&severity=${q}&from=${q}`,
        `/api/ai-manager/detections?type=${q}&status=${q}&reviewStatus=${q}&ruleId=${q}`, `/api/audit-logs?entity=${q}&userId=${q}`, `/api/documents?category=${q}`,
        `/api/checklists/templates?category=${q}`, `/api/checklists/assignments?status=${q}&from=${q}`, `/api/checklists/submissions?status=${q}`,
        `/api/vendor-visits?status=${q}`, `/api/image-directory?kind=${q}&cameraId=${q}`, `/api/pos/transactions?storeIds=${q}`, `/api/analytics/overview?storeIds=${q}`,
        `/api/cameras?storeId=${q}`, `/api/zones?storeId=${q}&cameraId=${q}`, `/api/probes?storeId=${q}`, `/api/recaps?storeIds=${q}`,
        // repeated keys arrive as arrays
        '/api/tickets?category=OTHER&category=CAMERA', '/api/ai-manager/detections?status=BREACHED&status=COMPLIED', '/api/tasks?type=GENERAL&type=FOLLOW_UP',
      ];
      for (const u of urls) {
        const r = await as('admin').get(u);
        expect([u, r.status]).toEqual([u, 200]);
      }
      const t = (await as('admin').get(`/api/tickets?category=${q}`).expect(200)).body;
      expect(t).toEqual([]);
    });

    it('V2 path traversal: document names are reduced to a base name; /uploads cannot escape the upload folder', async () => {
      const r = await c.http().post('/api/documents').set(bearer(c.tokens.manager)).field('title', 'Traversal').field('category', 'SOP')
        .attach('file', Buffer.from('plain text body'), { filename: '../../../../etc/passwd', contentType: 'text/plain' }).expect(201);
      expect(r.body.fileName).toBe('passwd');
      const dl = await as('manager').get(`/api/documents/${r.body.id}/download`).expect(200);
      expect(dl.headers['content-type']).toMatch(/^text\/plain/);
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      expect(dl.headers['content-disposition']).toMatch(/attachment; filename="passwd"/);
      for (const p of ['/uploads/../../etc/passwd', '/uploads/%2e%2e/%2e%2e/etc/passwd', '/uploads/..%2f..%2fpackage.json', '/uploads/files/../../package.json']) {
        const x = await c.http().get(p);
        expect([p, x.status === 404 || x.status === 400 || x.status === 403]).toEqual([p, true]);
      }
      await as('manager').get('/api/documents/..%2F..%2Fetc%2Fpasswd/download').expect(400);
      const win = await c.http().post('/api/documents').set(bearer(c.tokens.manager)).field('title', 'Win').field('category', 'SOP')
        .attach('file', Buffer.from('x'), { filename: '..\\..\\windows\\win.ini', contentType: 'text/plain' }).expect(201);
      expect(win.body.fileName).toBe('win.ini');
    });

    it('V3 MIME spoofing: an .exe renamed .jpg (or HTML / script) is rejected by magic number on every upload path', async () => {
      const exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1'), Buffer.alloc(200, 0)]);
      const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]), Buffer.alloc(100, 0)]);
      const html = Buffer.from('<!DOCTYPE html><html><script>alert(1)</script></html>');
      for (const [buf, name, type] of [[exe, 'photo.jpg', 'image/jpeg'], [elf, 'clip.mp4', 'video/mp4'], [html, 'x.png', 'image/png'], [Buffer.from('#!/bin/sh\nrm -rf /'), 'a.jpg', 'image/jpeg']] as const) {
        await c.http().post('/api/uploads').set(bearer(c.tokens.staff)).attach('file', buf, { filename: name, contentType: type }).expect(400);
        await c.http().post('/api/documents').set(bearer(c.tokens.manager)).field('title', 'x').field('category', 'SOP').attach('file', buf, { filename: name, contentType: type }).expect(400);
      }
      await c.http().post('/api/ingest/snapshot').set('X-Api-Key', c.seed.keys.tnagar).field('cameraId', String(c.seed.cameras.floor)).attach('file', exe, { filename: 's.jpg', contentType: 'image/jpeg' }).expect(400);
      // a real JPEG declared as something else is stored by what it is
      const ok = await c.http().post('/api/uploads').set(bearer(c.tokens.staff)).attach('file', jpeg(), { filename: 'photo.bin', contentType: 'application/octet-stream' }).expect(201);
      expect(ok.body.url).toMatch(/\.jpg$/);
      const pdf = await c.http().post('/api/documents').set(bearer(c.tokens.manager)).field('title', 'Real PDF').field('category', 'SOP').attach('file', Buffer.from('%PDF-1.7\n%%EOF'), { filename: 'sop.pdf', contentType: 'image/png' }).expect(201);
      expect(pdf.body.mimeType).toBe('application/pdf');
    });

    it('V3b both upload paths accept up to 50 MB (same limit) and reject more with 413', async () => {
      const big = Buffer.alloc(50 * 1024 * 1024 + 10, 0x20);
      await c.http().post('/api/documents').set(bearer(c.tokens.manager)).field('title', 'big').field('category', 'SOP').attach('file', big, { filename: 'big.txt', contentType: 'text/plain' }).expect(413);
      await c.http().post('/api/uploads').set(bearer(c.tokens.staff)).attach('file', big, { filename: 'big.jpg', contentType: 'image/jpeg' }).expect(413);
      const fine = Buffer.alloc(30 * 1024 * 1024, 0x20); // > the old 25 MB documents limit
      await c.http().post('/api/documents').set(bearer(c.tokens.manager)).field('title', 'thirty').field('category', 'SOP').attach('file', fine, { filename: 'thirty.txt', contentType: 'text/plain' }).expect(201);
    }, 60000);

    it('V4 max lengths: over-long strings → 400 naming the field (DTO or the column guard), never a 500 / silent truncation', async () => {
      const long = (n: number) => 'x'.repeat(n);
      expect((await as('admin').post('/api/regions', { name: long(5000) }).expect(400)).body.message.join()).toMatch(/name/);
      await as('admin').post('/api/stores', { code: 'LONG', name: long(151), regionId: c.seed.regions.chennai }).expect(400);
      await as('admin').post('/api/stores', { code: long(31), name: 'ok', regionId: c.seed.regions.chennai }).expect(400);
      await as('manager').post('/api/tasks', { storeId: c.seed.stores.tnagar, title: long(201) }).expect(400);
      await as('staff').post('/api/tickets', { storeId: c.seed.stores.tnagar, title: 'ok', description: long(4001), category: 'OTHER', priority: 'LOW' }).expect(400);
      const t = (await as('staff').post('/api/tickets', { storeId: c.seed.stores.tnagar, title: 'ok', category: 'OTHER', priority: 'LOW' }).expect(201)).body;
      await as('staff').post(`/api/tickets/${t.id}/comments`, { body: long(4001) }).expect(400);
      await as('staff').post(`/api/tickets/${t.id}/comments`, { body: '' }).expect(400);
      // the column guard (no DTO in between): a direct repository write longer than nvarchar(n) is refused on SQLite too
      const ds = c.app.get(DataSource);
      await expect(ds.getRepository(Region).save({ name: long(500) })).rejects.toThrow(/name must be at most/);
      await expect(ds.getRepository(Store).update(c.seed.stores.tnagar, { city: long(1000) })).rejects.toThrow(/city must be at most/);
    });

    it('V5 pagination bounds are clamped (page ≥ 1, 1 ≤ pageSize ≤ 500); garbage → defaults', async () => {
      for (const base of ['/api/audit-logs', '/api/alerts', '/api/pos/transactions', '/api/image-directory', '/api/ai-manager/detections']) {
        const cases: [string, number, number][] = [['page=0&pageSize=100000', 1, 500], ['page=-3&pageSize=-5', 1, 25], ['page=abc&pageSize=xyz', 1, 25], ['page=1e309&pageSize=0', 1, 25], ['page=2&pageSize=1', 2, 1]];
        for (const [qs, page, pageSize] of cases) {
          const r = await as('admin').get(`${base}?${qs}`).expect(200);
          expect([base, qs, r.body.page, r.body.pageSize]).toEqual([base, qs, page, pageSize]);
        }
      }
    });

    it('V6 negative numbers / out-of-range ids and V7 enum garbage → 400, never 500', async () => {
      await as('admin').post('/api/zones', { storeId: c.seed.stores.tnagar, cameraId: c.seed.cameras.floor, name: 'neg', type: 'SECTION', polygon: [[0, 0], [1, 0], [1, 1]], engagedDwellSec: -5 }).expect(400);
      await as('admin').post('/api/zones', { storeId: c.seed.stores.tnagar, cameraId: c.seed.cameras.floor, name: 'nan', type: 'SECTION', polygon: [[0, 0], ['a', 'b'], [1, 1]] }).expect(400);
      await as('manager').post('/api/pos/transactions', { transactions: [{ storeId: c.seed.stores.tnagar, billNo: 'NEG', ts: new Date().toISOString(), amount: -10, itemsCount: 1 }] }).expect(400);
      await as('admin').post('/api/stores', { code: 'NEG', name: 'neg', regionId: c.seed.regions.chennai, areaSqft: -1 }).expect(400);
      await as('admin').get('/api/tasks/-1').expect(400);
      await as('admin').get('/api/tasks/0').expect(400);
      await as('admin').get('/api/tasks/1.5').expect(400);
      await as('admin').get('/api/tasks/abc').expect(400);
      await as('admin').get('/api/tasks/99999999999999999999').expect(400);
      await as('manager').post('/api/tasks', { storeId: c.seed.stores.tnagar, title: 'x', priority: 'SUPER' }).expect(400);
      await as('manager').patch('/api/tasks/1/status', { status: 'FINISHED' }).expect(400);
      await as('staff').post('/api/tickets', { storeId: c.seed.stores.tnagar, title: 'x', category: 'ALIENS', priority: 'LOW' }).expect(400);
      await as('admin').post('/api/users', { email: 'enum@x.in', name: 'x', role: 'GOD', password: 'Password@123' }).expect(400);
      await as('admin').get('/api/analytics/benchmark/groups?groupBy=planet').expect(400);
      await as('admin').get('/api/reports/export?type=everything&format=csv').expect(400);
      await as('admin').get('/api/reports/export?type=traffic&format=pdf').expect(400);
      await as('admin').patch('/api/ai-manager/detections/1/review', { reviewStatus: 'MAYBE' }).expect(400);
      await as('admin').put('/api/settings', { bounceSec: -1 }).expect(400);
    });
  });

  // ------------------------------------------------------------------ §6
  describe('§6 Trax checklists', () => {
    let tpl: { id: number; questions: { id: number; text: string; type: string }[] };
    const qid = (n: number) => tpl.questions[n].id;
    const staffId = () => uid('staff.tnagar@congruence.in');
    const answersAll = (over: Record<number, unknown> = {}) => [
      { questionId: qid(0), value: 'YES', photoUrl: '/uploads/files/evidence.jpg' },
      { questionId: qid(1), value: 'Clean' },
      { questionId: qid(2), value: '22' },
      { questionId: qid(3), value: 'All good' },
      { questionId: qid(4), value: '4' },
    ].map((a, i) => (i in over ? { ...a, value: over[i] } : a));

    beforeAll(async () => {
      tpl = (await as('auditor').post('/api/checklists/templates', {
        name: 'Edge audit', category: 'AUDIT', frequency: 'ADHOC',
        questions: [
          { text: 'Entrance clean (photo)?', type: 'YES_NO', requiresPhoto: true, weight: 2 },
          { text: 'Floor state', type: 'MCQ_SINGLE', options: ['Clean', 'Dirty'], correctOptions: ['Clean'] },
          { text: 'AC temperature', type: 'NUMBER', minValue: 18, maxValue: 26 },
          { text: 'Notes', type: 'TEXT', required: false },
          { text: 'Rating', type: 'RATING' },
        ],
      }).expect(201)).body;
    });
    const submit = (answers: unknown[], assignmentId?: number, who: Who = 'staff') =>
      as(who).post('/api/checklists/submissions', { templateId: tpl.id, storeId: c.seed.stores.tnagar, assignmentId, answers });

    it('X1 schedule validation: repeatEvery 0, WEEKLY without days, past endDate, inverted window, no stores → 400', async () => {
      const base = { templateId: tpl.id, storeIds: [c.seed.stores.tnagar], frequency: 'DAILY', windowStart: '09:00', windowEnd: '10:00', startDate: istDate(0) };
      await as('regional').post('/api/checklists/schedules', { ...base, repeatEvery: 0 }).expect(400);
      expect((await as('regional').post('/api/checklists/schedules', { ...base, frequency: 'WEEKLY', daysOfWeek: [] }).expect(400)).body.message).toMatch(/daysOfWeek/);
      await as('regional').post('/api/checklists/schedules', { ...base, frequency: 'WEEKLY' }).expect(400);
      expect((await as('regional').post('/api/checklists/schedules', { ...base, startDate: istDate(-30), endDate: istDate(-10) }).expect(400)).body.message).toMatch(/past/);
      await as('regional').post('/api/checklists/schedules', { ...base, windowStart: '22:00', windowEnd: '01:00' }).expect(400);
      await as('regional').post('/api/checklists/schedules', { ...base, storeIds: [] }).expect(400);
      await as('regional').post('/api/checklists/schedules', { ...base, startDate: '2026-02-30' }).expect(400);
      const ok = (await as('regional').post('/api/checklists/schedules', { ...base, frequency: 'WEEKLY', daysOfWeek: [1, 3] }).expect(201)).body;
      await as('regional').patch(`/api/checklists/schedules/${ok.id}`, { daysOfWeek: [] }).expect(400);
    });

    it('X2 deactivated fixed assignee → assignments fall back to the store manager', async () => {
      const temp = (await as('admin').post('/api/users', { email: 'x2.staff@congruence.in', name: 'Leaver', role: 'STAFF', password: 'Password@123', storeIds: [c.seed.stores.tnagar] }).expect(201)).body;
      const s = (await as('regional').post('/api/checklists/schedules', { templateId: tpl.id, storeIds: [c.seed.stores.tnagar], assigneeId: temp.id, frequency: 'DAILY', windowStart: '00:00', windowEnd: '23:59', startDate: istDate(0) }).expect(201)).body;
      await as('admin').del(`/api/users/${temp.id}`).expect(200);
      expect((await as('regional').post(`/api/checklists/schedules/${s.id}/generate`).expect(200)).body).toEqual({ created: 1 });
      const a = await c.app.get(DataSource).getRepository(ChecklistAssignment).findOneByOrFail({ scheduleId: s.id });
      expect(a.assigneeId).toBe(uid('manager.tnagar@congruence.in'));
      expect((await as('regional').post(`/api/checklists/schedules/${s.id}/generate`).expect(200)).body).toEqual({ created: 0 }); // idempotent
    });

    it('X3 generation uses each store\'s own local date (Dubai still on "yesterday" when Chennai passes midnight)', async () => {
      const ds = c.app.get(DataSource);
      const dxb = await ds.getRepository(Store).save({ code: 'QA-DXB2', name: 'QA Dubai', regionId: c.seed.regions.chennai, city: 'Dubai', address: '', timezone: 'Asia/Dubai', openTime: '10:00', closeTime: '22:00', areaSqft: 1000, isActive: true });
      await as('admin').patch(`/api/users/${uid('manager.tnagar@congruence.in')}`, { storeIds: [c.seed.stores.tnagar, dxb.id] }).expect(200);
      const D = istDate(5);
      // 19:00 UTC on D = 00:30 IST on D+1 = 23:00 Dubai on D
      const now = new Date(zonedToUtc(D, '23:00', 'Asia/Dubai').getTime());
      const svc = c.app.get(SchedulesService);
      const sched = await ds.getRepository(ChecklistSchedule).save({ templateId: tpl.id, storeIds: [c.seed.stores.tnagar, dxb.id], assigneeId: null, frequency: 'ONCE', repeatEvery: 1, daysOfWeek: [], dayOfMonth: null, windowStart: '00:00', windowEnd: '23:59', startDate: D, endDate: null, reminderMinutesBefore: 0, isActive: true, lastGeneratedDate: null, createdById: null });
      expect(await svc.generateFor(sched, undefined, now)).toBe(1);
      const made = await ds.getRepository(ChecklistAssignment).find({ where: { scheduleId: sched.id } });
      expect(made.map((a) => [a.storeId, a.dueDate])).toEqual([[dxb.id, D]]);
      expect(made[0].dueAt.toISOString()).toBe(zonedToUtc(D, '23:59', 'Asia/Dubai').toISOString());
      const next = await ds.getRepository(ChecklistSchedule).save({ ...sched, id: undefined, startDate: addDays(D, 1) });
      expect(await svc.generateFor(next, undefined, now)).toBe(1); // Chennai is already on D+1
      expect((await ds.getRepository(ChecklistAssignment).find({ where: { scheduleId: next.id } })).map((a) => a.storeId)).toEqual([c.seed.stores.tnagar]);
    });

    it('X7 required answers missing → 400 listing the question ids', async () => {
      const r = await submit([{ questionId: qid(3), value: 'only notes' }]).expect(400);
      expect(r.body.missingQuestionIds).toEqual([qid(0), qid(1), qid(2), qid(4)]);
      expect(r.body.message).toMatch(/Missing required answers/);
    });

    it('X8 invalid answers → 400 with the question ids (MCQ not in options, YES_NO garbage, rating out of range, NaN number)', async () => {
      const r = await submit(answersAll({ 1: 'Sparkling', 4: '7' })).expect(400);
      expect(r.body.invalidAnswers).toEqual([{ questionId: qid(1), reason: 'not one of the options' }, { questionId: qid(4), reason: 'must be a rating from 0 to 5' }]);
      await submit(answersAll({ 0: 'MAYBE' })).expect(400);
      await submit(answersAll({ 2: 'warm' })).expect(400);
      await submit([...answersAll(), { questionId: qid(3), value: 'twice' }]).expect(400);
      await submit([...answersAll(), { questionId: 999999, value: 'x' }]).expect(400);
    });

    it('X10 a photo-required question without its photo → 400', async () => {
      const a = answersAll();
      a[0] = { questionId: qid(0), value: 'YES' } as (typeof a)[number];
      const r = await submit(a).expect(400);
      expect(r.body.invalidAnswers).toEqual([{ questionId: qid(0), reason: 'photo required' }]);
    });

    it('X9 a NUMBER outside min/max is accepted, scored 0 and flagged', async () => {
      const r = await submit(answersAll({ 2: '31' })).expect(201);
      const ans = r.body.answers.find((x: { questionId: number }) => x.questionId === qid(2));
      expect(ans).toMatchObject({ score: 0, flagged: true });
      expect(r.body.flags).toBe(1);
      expect(r.body.scorePct).toBeCloseTo(((2 + 1 + 0 + 1 + 0.8) / 6) * 100, 1); // YES(w2) + MCQ ok + NUMBER out of range + TEXT + rating 4/5
    });

    it('X4/X5 submit after due → SUBMITTED + isLate; review REDO → resubmit is allowed and supersedes', async () => {
      const a = (await as('manager').post('/api/checklists/assignments', { templateId: tpl.id, storeId: c.seed.stores.tnagar, assigneeId: staffId(), dueDate: istDate(-1), dueAt: new Date(Date.now() - 3600_000).toISOString() }).expect(201)).body;
      expect(a.status).toBe('OVERDUE');
      const s1 = (await submit(answersAll(), a.id).expect(201)).body;
      expect(s1).toMatchObject({ status: 'SUBMITTED', isLate: true, templateVersion: 1 });
      expect((await as('staff').get(`/api/checklists/assignments/${a.id}`).expect(200)).body.status).toBe('SUBMITTED');
      await submit(answersAll(), a.id).expect(409); // double submit
      await as('manager').patch(`/api/checklists/submissions/${s1.id}/review`, { status: 'REDO', comment: 'Retake the photo', redoQuestionIds: [qid(0)] }).expect(200);
      expect((await as('staff').get(`/api/checklists/assignments/${a.id}`).expect(200)).body.status).toBe('REDO');
      const s2 = (await submit(answersAll(), a.id).expect(201)).body;
      expect(s2.id).not.toBe(s1.id);
      const after = (await as('staff').get(`/api/checklists/assignments/${a.id}`).expect(200)).body;
      expect(after).toMatchObject({ status: 'SUBMITTED', submissionId: s2.id });
      expect((await as('staff').get(`/api/checklists/submissions/${s1.id}`).expect(200)).body.status).toBe('REDO');
    });

    it('X6 concurrent draft saves (section-wise, two devices) never lose an answer', async () => {
      const a = (await as('manager').post('/api/checklists/assignments', { templateId: tpl.id, storeId: c.seed.stores.tnagar, assigneeId: staffId(), dueDate: istDate(1) }).expect(201)).body;
      const saves = answersAll().map((x) => as('staff').post(`/api/checklists/assignments/${a.id}/draft`, { answers: [x] }));
      const res = await Promise.all(saves);
      expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      const got = (await as('staff').get(`/api/checklists/assignments/${a.id}`).expect(200)).body;
      expect(got.status).toBe('IN_PROGRESS');
      expect(got.draftAnswers.map((d: { questionId: number }) => d.questionId).sort()).toEqual(tpl.questions.map((q) => q.id).sort());
    });

    it('X11 AI service timeout / down → aiResult ERROR and the answer is NOT penalised', async () => {
      const slow = http.createServer((_req, res) => setTimeout(() => res.end('{}'), 3000));
      await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r));
      const port = (slow.address() as { port: number }).port;
      const old = process.env.AI_CHECK_TIMEOUT_MS;
      process.env.AI_CHECK_TIMEOUT_MS = '300';
      try {
        await as('admin').put('/api/settings', { aiServiceUrl: `http://127.0.0.1:${port}` }).expect(200);
        const photo = (await c.http().post('/api/uploads').set(bearer(c.tokens.staff)).attach('file', jpeg(), { filename: 'p.jpg', contentType: 'image/jpeg' }).expect(201)).body.url;
        const t = (await as('auditor').post('/api/checklists/templates', { name: 'Grooming', category: 'AUDIT', frequency: 'ADHOC', questions: [{ text: 'Grooming photo', type: 'PHOTO', aiCheck: 'UNIFORM', weight: 3 }] }).expect(201)).body;
        const r = (await as('staff').post('/api/checklists/submissions', { templateId: t.id, storeId: c.seed.stores.tnagar, answers: [{ questionId: t.questions[0].id, value: photo, photoUrl: photo }] }).expect(201)).body;
        expect(r.answers[0].aiResult.status).toBe('ERROR');
        expect(r.answers[0]).toMatchObject({ score: 3, flagged: false });
        expect(r.scorePct).toBe(100);
      } finally {
        if (old === undefined) delete process.env.AI_CHECK_TIMEOUT_MS;
        else process.env.AI_CHECK_TIMEOUT_MS = old;
        slow.closeAllConnections();
        await new Promise((r) => slow.close(r));
        await as('admin').put('/api/settings', { aiServiceUrl: 'http://127.0.0.1:9' }).expect(200);
      }
    });

    it('X12 template edited after submissions: history keeps the template version it was answered against', async () => {
      const t = (await as('auditor').post('/api/checklists/templates', { name: 'Versioned', category: 'OTHER', frequency: 'ADHOC', questions: [{ text: 'Old wording?', type: 'YES_NO', weight: 1 }, { text: 'Removed later', type: 'TEXT' }] }).expect(201)).body;
      expect(t.version).toBe(1);
      const sub = (await as('staff').post('/api/checklists/submissions', { templateId: t.id, storeId: c.seed.stores.tnagar, answers: [{ questionId: t.questions[0].id, value: 'YES' }, { questionId: t.questions[1].id, value: 'gone' }] }).expect(201)).body;
      const v2 = (await as('auditor').put(`/api/checklists/templates/${t.id}`, { name: 'Versioned v2', category: 'OTHER', frequency: 'ADHOC', questions: [{ id: t.questions[0].id, text: 'New wording?', type: 'YES_NO', weight: 5 }, { text: 'Brand new', type: 'TEXT' }] }).expect(200)).body;
      expect(v2.version).toBe(2);
      const old = (await as('staff').get(`/api/checklists/submissions/${sub.id}`).expect(200)).body;
      expect(old.templateVersion).toBe(1);
      expect(old.template).toMatchObject({ name: 'Versioned', version: 1 });
      expect(old.template.questions.map((q: { text: string; weight: number }) => [q.text, q.weight])).toEqual([['Old wording?', 1], ['Removed later', 1]]);
      expect(old.answers.map((a: { questionId: number }) => a.questionId)).toEqual(old.template.questions.map((q: { id: number }) => q.id));
      expect(old.maxScore).toBe(2); // scores are not recomputed with the new weights
    });
  });

  // ------------------------------------------------------------------ §7
  describe('§7 tasks & tickets', () => {
    it('K1 SLA across midnight: URGENT ticket at 22:30 IST is due 02:30 IST next day; breach flag follows the clock', async () => {
      const svc = c.app.get(TicketsService);
      const me = { id: uid('admin@congruence.in'), email: 'admin@congruence.in', name: 'Admin', role: Role.SUPER_ADMIN, storeIds: [] as number[] };
      const created = zonedToUtc(istDate(-1), '22:30', 'Asia/Kolkata');
      const t = (await svc.create(me, { storeId: c.seed.stores.tnagar, title: 'Shutter jammed', category: 'MAINTENANCE', priority: 'URGENT' }, null, created)) as { slaDueAt: string; isSlaBreached: boolean };
      expect(t.slaDueAt).toBe(zonedToUtc(istDate(0), '02:30', 'Asia/Kolkata').toISOString());
      expect(t.isSlaBreached).toBe(Date.now() > Date.parse(t.slaDueAt));
      const low = (await svc.create(me, { storeId: c.seed.stores.tnagar, title: 'Paint', category: 'MAINTENANCE', priority: 'LOW' }, null, created)) as { slaDueAt: string };
      expect(Date.parse(low.slaDueAt) - created.getTime()).toBe(168 * 3600_000);
    });

    it('K2 reopen a resolved ticket (resolvedAt cleared, re-resolve stamps again); K3 comments: RESOLVED ok, CLOSED → 409', async () => {
      const t = (await as('staff').post('/api/tickets', { storeId: c.seed.stores.tnagar, title: 'Light flicker', category: 'INFRASTRUCTURE', priority: 'MEDIUM' }).expect(201)).body;
      const r1 = (await as('manager').patch(`/api/tickets/${t.id}/status`, { status: 'RESOLVED' }).expect(200)).body;
      expect(r1.resolvedAt).toBeTruthy();
      await as('staff').post(`/api/tickets/${t.id}/comments`, { body: 'still flickering' }).expect(201);
      const re = (await as('manager').patch(`/api/tickets/${t.id}/status`, { status: 'REOPENED' }).expect(200)).body;
      expect(re).toMatchObject({ status: 'REOPENED', resolvedAt: null });
      await as('staff').patch(`/api/tickets/${t.id}/status`, { status: 'CLOSED' }).expect(403); // reporter is not the assignee
      await as('manager').patch(`/api/tickets/${t.id}/status`, { status: 'CLOSED' }).expect(200);
      await as('staff').post(`/api/tickets/${t.id}/comments`, { body: 'one more' }).expect(409);
      await as('manager').patch(`/api/tickets/${t.id}/status`, { status: 'REOPENED' }).expect(200);
      await as('staff').post(`/api/tickets/${t.id}/comments`, { body: 'one more' }).expect(201);
    });

    it('K4 deleting a store with open tasks/tickets is a soft delete: history stays readable, store leaves analytics scope', async () => {
      const ds = c.app.get(DataSource);
      const st = (await as('admin').post('/api/stores', { code: 'QA-DEL', name: 'QA Closing', regionId: c.seed.regions.chennai }).expect(201)).body;
      const task = (await as('admin').post('/api/tasks', { storeId: st.id, title: 'Open task' }).expect(201)).body;
      const tk = (await as('admin').post('/api/tickets', { storeId: st.id, title: 'Open ticket', category: 'OTHER', priority: 'LOW' }).expect(201)).body;
      await as('admin').del(`/api/stores/${st.id}`).expect(200);
      expect((await ds.getRepository(Store).findOneByOrFail({ id: st.id })).isActive).toBe(false);
      expect((await as('admin').get(`/api/tasks/${task.id}`).expect(200)).body.status).toBe('TODO');
      expect((await as('admin').get(`/api/tickets/${tk.id}`).expect(200)).body.status).toBe('OPEN');
      const b = (await as('admin').get('/api/analytics/benchmark').expect(200)).body;
      expect(b.some((x: { storeId: number }) => x.storeId === st.id)).toBe(false);
    });

    it('K5 assignee outside the store (or inactive) → 400; admins can be assigned anywhere', async () => {
      const staffTn = uid('staff.tnagar@congruence.in');
      await as('admin').post('/api/tasks', { storeId: c.seed.stores.coimbatore, title: 'x', assigneeId: staffTn }).expect(400);
      await as('admin').post('/api/tickets', { storeId: c.seed.stores.coimbatore, title: 'x', category: 'OTHER', priority: 'LOW', assigneeId: staffTn }).expect(400);
      await as('admin').post('/api/tasks/bulk', { storeIds: [c.seed.stores.tnagar, c.seed.stores.coimbatore], title: 'x', assigneeId: staffTn }).expect(400);
      await as('admin').post('/api/checklists/assignments', { templateId: 1, storeId: c.seed.stores.coimbatore, assigneeId: staffTn, dueDate: istDate(1) }).expect(400);
      await as('admin').post('/api/tasks', { storeId: c.seed.stores.coimbatore, title: 'x', assigneeId: uid('admin@congruence.in') }).expect(201);
      const t = (await as('admin').post('/api/tasks', { storeId: c.seed.stores.tnagar, title: 'move me', assigneeId: staffTn }).expect(201)).body;
      await as('admin').patch(`/api/tasks/${t.id}`, { storeId: c.seed.stores.coimbatore }).expect(400); // assignee does not follow
      const gone = (await as('admin').post('/api/users', { email: 'k5.gone@congruence.in', name: 'Gone', role: 'STAFF', password: 'Password@123', storeIds: [c.seed.stores.tnagar] }).expect(201)).body;
      await as('admin').del(`/api/users/${gone.id}`).expect(200);
      await as('manager').post('/api/tasks', { storeId: c.seed.stores.tnagar, title: 'x', assigneeId: gone.id }).expect(400);
    });
  });
});
