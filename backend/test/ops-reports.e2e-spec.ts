import { bearer, createTestApp, Ctx, istDate, istToday } from './helpers';

const binaryParser = (res: NodeJS.ReadableStream & { setEncoding: (e: string) => void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (d: Buffer) => chunks.push(Buffer.from(d)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Documents, vendors, POS import, reports, uploads, paging', () => {
  let c: Ctx;
  beforeAll(async () => (c = await createTestApp()));
  afterAll(async () => c.app.close());
  const as = (role: string) => ({
    get: (p: string) => c.http().get(p).set(bearer(c.tokens[role])),
    post: (p: string, b?: unknown) => c.http().post(p).set(bearer(c.tokens[role])).send(b as object),
    patch: (p: string, b?: unknown) => c.http().patch(p).set(bearer(c.tokens[role])).send(b as object),
    del: (p: string) => c.http().delete(p).set(bearer(c.tokens[role])),
  });

  describe('documents', () => {
    let id: number;
    it('upload (STORE_MANAGER+), list, download, delete', async () => {
      await c.http().post('/api/documents').set(bearer(c.tokens.staff)).field('title', 'x').field('category', 'SOP').attach('file', Buffer.from('x'), 'x.txt').expect(403);
      const r = await c.http().post('/api/documents').set(bearer(c.tokens.manager)).field('title', 'Opening SOP').field('category', 'SOP').field('storeId', String(c.seed.stores.tnagar)).attach('file', Buffer.from('1. Unlock\n2. Lights on\n'), { filename: 'opening-sop.txt', contentType: 'text/plain' }).expect(201);
      id = r.body.id;
      expect(r.body).toEqual({ id, title: 'Opening SOP', category: 'SOP', storeId: c.seed.stores.tnagar, storeName: 'Congruence T Nagar', fileName: 'opening-sop.txt', mimeType: 'text/plain', size: 23, uploadedByName: 'Karthik Subramanian', createdAt: expect.any(String) });
      await c.http().post('/api/documents').set(bearer(c.tokens.admin)).field('title', 'Diwali circular').field('category', 'CIRCULAR').attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'diwali.pdf', contentType: 'application/pdf' }).expect(201);
      await c.http().post('/api/documents').set(bearer(c.tokens.admin)).field('title', 'Anna Nagar planogram').field('category', 'PLANOGRAM').field('storeId', String(c.seed.stores.annanagar)).attach('file', Buffer.from('p'), 'p.txt').expect(201);
      await c.http().post('/api/documents').set(bearer(c.tokens.manager)).field('title', 'x').field('category', 'BAD').attach('file', Buffer.from('x'), 'x.txt').expect(400);
      const list = await as('staff').get('/api/documents').expect(200);
      expect(list.body.map((d: { title: string }) => d.title).sort()).toEqual(['Diwali circular', 'Opening SOP']);
      expect((await as('staff').get('/api/documents?category=CIRCULAR').expect(200)).body).toHaveLength(1);
      const dl = await as('staff').get(`/api/documents/${id}/download`).expect(200);
      expect(dl.headers['content-disposition']).toContain('opening-sop.txt');
      expect(dl.text).toContain('Lights on');
      const other = list.body.length;
      expect(other).toBe(2);
      await as('manager').del(`/api/documents/${id}`).expect(200);
      await as('manager').get(`/api/documents/${id}/download`).expect(404);
    });
  });

  describe('vendors & visits', () => {
    let vendorId: number;
    let visitId: number;
    it('vendor CRUD', async () => {
      await as('staff').post('/api/vendors', { name: 'x', category: 'IT' }).expect(403);
      const r = await as('manager').post('/api/vendors', { name: 'Chennai Facility Services', category: 'HOUSEKEEPING', contactName: 'Mani', phone: '+91 98400 11111', email: 'ops@cfs.in' }).expect(201);
      vendorId = r.body.id;
      expect(r.body).toEqual({ id: vendorId, name: 'Chennai Facility Services', category: 'HOUSEKEEPING', contactName: 'Mani', phone: '+91 98400 11111', email: 'ops@cfs.in', isActive: true });
      expect((await as('manager').patch(`/api/vendors/${vendorId}`, { phone: '044 2434 0000' }).expect(200)).body.phone).toBe('044 2434 0000');
      expect((await as('staff').get('/api/vendors').expect(200)).body).toHaveLength(1);
    });
    it('visit schedule → check-in → check-out with rating', async () => {
      const r = await as('manager').post('/api/vendor-visits', { vendorId, storeId: c.seed.stores.tnagar, purpose: 'Deep cleaning', scheduledAt: istToday('08:00') }).expect(201);
      visitId = r.body.id;
      expect(r.body).toMatchObject({ vendorName: 'Chennai Facility Services', storeName: 'Congruence T Nagar', status: 'SCHEDULED', checkInAt: null, rating: null });
      await as('manager').patch(`/api/vendor-visits/${visitId}/check-out`, {}).expect(409);
      expect((await as('manager').patch(`/api/vendor-visits/${visitId}/check-in`).expect(200)).body.status).toBe('CHECKED_IN');
      await as('manager').patch(`/api/vendor-visits/${visitId}/check-out`, { rating: 6 }).expect(400);
      const out = await as('manager').patch(`/api/vendor-visits/${visitId}/check-out`, { rating: 4, notes: 'Good job' }).expect(200);
      expect(out.body).toMatchObject({ status: 'COMPLETED', rating: 4, notes: 'Good job' });
      expect(out.body.checkInAt && out.body.checkOutAt).toBeTruthy();
      const list = await as('admin').get(`/api/vendor-visits?vendorId=${vendorId}&status=COMPLETED&from=${istDate(0)}&to=${istDate(0)}`).expect(200);
      expect(list.body).toHaveLength(1);
      const upd = await as('manager').patch(`/api/vendor-visits/${visitId}`, { purpose: 'Deep cleaning + pest control' }).expect(200);
      expect(upd.body.purpose).toBe('Deep cleaning + pest control');
      await as('manager').post('/api/vendor-visits', { vendorId, storeId: c.seed.stores.annanagar, scheduledAt: istToday('08:00') }).expect(403);
      await as('manager').del(`/api/vendors/${vendorId}`).expect(200);
      expect((await as('manager').get('/api/vendors')).body[0].isActive).toBe(false);
    });
  });

  describe('POS CSV import + paged list', () => {
    it('imports with duplicates and errors', async () => {
      const D = istDate(-1);
      const csv = [
        'storeCode,billNo,ts,amount,itemsCount,staffCode',
        `CNG-TNR,TN-1001,${D}T11:15:00,1999.00,2,S01`,
        `CNG-TNR,TN-1002,${D}T12:05:00+05:30,850.50,1,`,
        `CNG-TNR,TN-1001,${D}T11:15:00,1999.00,2,S01`,
        `CNG-ANN,AN-2001,${D}T18:40:00Z,3200,4,S07`,
        `CNG-XXX,ZZ-1,${D}T10:00:00,10,1,`,
        `CNG-TNR,TN-1003,not-a-date,10,1,`,
      ].join('\n');
      await c.http().post('/api/pos/import').set(bearer(c.tokens.staff)).attach('file', Buffer.from(csv), 'pos.csv').expect(403);
      const r = await c.http().post('/api/pos/import').set(bearer(c.tokens.admin)).attach('file', Buffer.from(csv), { filename: 'pos.csv', contentType: 'text/csv' }).expect(200);
      expect(r.body.accepted).toBe(3);
      expect(r.body.duplicates).toBe(1);
      expect(r.body.errors).toHaveLength(2);
      expect(r.body.errors[0]).toContain('line 6');
      // manager import: other store rows are rejected as out of scope
      const m = await c.http().post('/api/pos/import').set(bearer(c.tokens.manager)).attach('file', Buffer.from(`storeCode,billNo,ts,amount,itemsCount,staffCode\nCNG-ANN,AN-2002,${D}T18:40:00Z,3200,4,\nCNG-TNR,TN-1001,${D}T11:15:00,1999,2,`), 'p.csv').expect(200);
      expect(m.body).toEqual({ accepted: 0, duplicates: 1, errors: [expect.stringContaining('outside your scope')] });
      // rollups updated: store-local 11:15 → hour 11
      const tr = await as('admin').get(`/api/analytics/conversion?storeIds=${c.seed.stores.tnagar}&from=${D}&to=${D}`).expect(200);
      expect(tr.body.totals).toMatchObject({ transactions: 2, revenue: 2849.5 });
      expect(tr.body.hourly.map((h: { hour: number }) => h.hour)).toEqual([11, 12]);
    });

    it('JWT POS ingest requires STORE_MANAGER+', async () => {
      const tx = { transactions: [{ storeId: c.seed.stores.tnagar, billNo: 'J-1', ts: new Date().toISOString(), amount: 100, itemsCount: 1 }] };
      await c.http().post('/api/pos/transactions').send(tx).expect(401);
      await c.http().post('/api/pos/transactions').set(bearer(c.tokens.staff)).send(tx).expect(403);
      expect((await c.http().post('/api/pos/transactions').set(bearer(c.tokens.manager)).send(tx).expect(200)).body).toEqual({ accepted: 1, duplicates: 0 });
    });

    it('paged transactions', async () => {
      const D = istDate(-1);
      const r = await as('admin').get(`/api/pos/transactions?from=${D}&to=${istDate(0)}&page=1&pageSize=2`).expect(200);
      expect(r.body).toMatchObject({ total: 4, page: 1, pageSize: 2 });
      expect(r.body.items).toHaveLength(2);
      expect(Object.keys(r.body.items[0]).sort()).toEqual(['amount', 'billNo', 'id', 'itemsCount', 'staffCode', 'storeId', 'storeName', 'ts']);
      const p2 = await as('admin').get(`/api/pos/transactions?from=${D}&to=${istDate(0)}&page=2&pageSize=2`).expect(200);
      expect(p2.body.items).toHaveLength(2);
      const mgr = await as('manager').get(`/api/pos/transactions?from=${D}&to=${istDate(0)}`).expect(200);
      expect(mgr.body.total).toBe(3);
      expect(mgr.body.pageSize).toBe(25);
    });
  });

  describe('reports', () => {
    const types = ['traffic', 'zones', 'conversion', 'queue', 'storeops', 'benchmark', 'checklists', 'alerts', 'tasks', 'tickets'];
    beforeAll(async () => {
      // a bit of data for every report
      const k = c.seed.keys.tnagar;
      const t = (h: string) => istToday(h, -1);
      await c.http().post('/api/ingest/events').set('X-Api-Key', k).send({ events: [
        { cameraId: c.seed.cameras.entrance, type: 'ENTRY', ts: t('12:00'), trackId: '1', visitorId: 'R1' },
        { cameraId: c.seed.cameras.floor, zoneId: c.seed.zones.mens, type: 'ZONE_ENTER', ts: t('12:01'), trackId: '2', visitorId: 'R1' },
      ] }).expect(200);
      await c.http().post('/api/ingest/queue').set('X-Api-Key', k).send({ snapshots: [{ zoneId: c.seed.zones.queue1, ts: t('12:00'), queueLength: 3, avgWaitSec: 90, counterStaffed: true }] }).expect(200);
      await c.http().post('/api/ingest/storeops').set('X-Api-Key', k).send({ events: [{ type: 'STORE_OPENED', ts: t('10:05') }] }).expect(200);
      await as('manager').post('/api/tasks', { title: 'Restock', storeId: c.seed.stores.tnagar });
      await as('manager').post('/api/tickets', { title: 'AC leak', storeId: c.seed.stores.tnagar, category: 'MAINTENANCE', priority: 'MEDIUM' });
    });

    it.each(types)('exports %s as csv and xlsx', async (type) => {
      const q = `type=${type}&from=${istDate(-2)}&to=${istDate(0)}`;
      const csv = await as('admin').get(`/api/reports/export?${q}&format=csv`).expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.headers['content-disposition']).toMatch(new RegExp(`attachment; filename="${type}_.*\\.csv"`));
      expect(csv.text.length).toBeGreaterThan(10);
      expect(csv.text.split('\r\n')[0].length).toBeGreaterThan(5);
      const xlsx = await as('admin').get(`/api/reports/export?${q}&format=xlsx`).buffer(true).parse(binaryParser as never).expect(200);
      expect(xlsx.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(xlsx.headers['content-disposition']).toContain('.xlsx');
      const body = xlsx.body as Buffer;
      expect(body.length).toBeGreaterThan(1000);
      expect(body.subarray(0, 2).toString()).toBe('PK');
    });

    it('report rows contain data', async () => {
      const r = await as('admin').get(`/api/reports/export?type=traffic&format=csv&from=${istDate(-1)}&to=${istDate(-1)}`).expect(200);
      const lines = r.text.trim().split('\r\n');
      expect(lines[0]).toContain('Footfall In');
      expect(lines[1]).toContain('Congruence T Nagar');
      await as('admin').get('/api/reports/export?type=nope&format=csv').expect(400);
      await as('admin').get('/api/reports/export?type=traffic&format=pdf').expect(400);
    });

    it('schedules CRUD + run', async () => {
      await as('staff').post('/api/reports/schedules', { name: 'x', type: 'traffic', format: 'csv', frequency: 'DAILY' }).expect(403);
      const r = await as('manager').post('/api/reports/schedules', { name: 'Daily traffic', type: 'traffic', format: 'xlsx', storeIds: [c.seed.stores.tnagar], frequency: 'DAILY', recipients: 'ops@congruence.in' }).expect(201);
      expect(r.body).toEqual({ id: r.body.id, name: 'Daily traffic', type: 'traffic', format: 'xlsx', storeIds: [c.seed.stores.tnagar], frequency: 'DAILY', recipients: 'ops@congruence.in', isActive: true, lastRunAt: null });
      await as('manager').post('/api/reports/schedules', { name: 'x', type: 'traffic', format: 'xlsx', storeIds: [c.seed.stores.annanagar], frequency: 'DAILY' }).expect(403);
      const run = await as('manager').post(`/api/reports/schedules/${r.body.id}/run`).expect(200);
      expect(run.body.ok).toBe(true);
      expect(run.body.file).toMatch(/^\/uploads\/reports\/.+\.xlsx$/);
      const file = await c.http().get(run.body.file).expect(200);
      expect(Number(file.headers['content-length'])).toBeGreaterThan(1000);
      const list = await as('manager').get('/api/reports/schedules').expect(200);
      expect(list.body[0].lastRunAt).toBeTruthy();
      expect((await as('manager').patch(`/api/reports/schedules/${r.body.id}`, { isActive: false }).expect(200)).body.isActive).toBe(false);
      await as('manager').del(`/api/reports/schedules/${r.body.id}`).expect(200);
    });
  });

  describe('uploads', () => {
    it('stores images and serves them from /uploads', async () => {
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c20000000049454e44ae426082', 'hex');
      const r = await c.http().post('/api/uploads').set(bearer(c.tokens.staff)).attach('file', png, { filename: 'p.png', contentType: 'image/png' }).expect(201);
      expect(r.body.url).toMatch(/^\/uploads\/files\/.+\.png$/);
      await c.http().get(r.body.url).expect(200);
      await c.http().post('/api/uploads').set(bearer(c.tokens.staff)).attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' }).expect(400);
    });
  });
});
