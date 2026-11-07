import request from 'supertest';
import { EdgeDevice } from '../src/modules/edge-devices/entities/edge-device.entity';
import { Probe } from '../src/modules/recorders/entities/probe.entity';
import { Recorder } from '../src/modules/recorders/entities/recorder.entity';
import { ProbesService } from '../src/modules/recorders/probes.service';
import { renderScene } from '../src/seed/scene';
import { bearer, createTestApp, Ctx } from './helpers';

/** Contract v3: DVR / NVR recorders, analog cameras by channel, connection tests (probes), LAN discovery. */
describe('v3 recorders, probes and discovery', () => {
  let c: Ctx;
  const PW = 'p@ss:w/rd#1';
  const PW_ENC = 'p%40ss%3Aw%2Frd%231';
  const PW2 = 'N3w#Secret/2026';
  const PW3 = 'Ann@Nagar:99';
  const SECRETS = [PW, PW_ENC, PW2, encodeURIComponent(PW2), PW3, encodeURIComponent(PW3)];
  /** every browser (JWT) response body, scanned for leaked passwords at the end */
  const seen: { url: string; text: string }[] = [];
  type Who = 'admin' | 'regional' | 'manager' | 'auditor' | 'staff';
  const as = (who: Who) => {
    const wrap = (t: request.Test, url: string) => {
      const orig = t.then.bind(t);
      t.then = ((ok: (r: request.Response) => unknown, ko: (e: unknown) => unknown) =>
        orig((r: request.Response) => {
          seen.push({ url, text: r.text ?? '' });
          return ok ? ok(r) : r;
        }, ko)) as never;
      return t;
    };
    const h = bearer(c.tokens[who]);
    return {
      get: (u: string) => wrap(c.http().get(u).set(h), u),
      post: (u: string, b?: object) => wrap(c.http().post(u).set(h).send(b ?? {}), u),
      patch: (u: string, b: object) => wrap(c.http().patch(u).set(h).send(b), u),
      del: (u: string) => wrap(c.http().delete(u).set(h), u),
    };
  };
  const edge = (key: string) => ({
    get: (u: string) => c.http().get(u).set('X-Api-Key', key),
    post: (u: string, b?: object | unknown[]) => c.http().post(u).set('X-Api-Key', key).send(b as object),
    result: (id: number, result: object | string, jpeg?: Buffer) => {
      const r = c.http().post(`/api/ingest/probes/${id}`).set('X-Api-Key', key).field('result', typeof result === 'string' ? result : JSON.stringify(result));
      return jpeg ? r.attach('file', jpeg, { filename: 'snap.jpg', contentType: 'image/jpeg' }) : r;
    },
  });
  const setEdgeSeen = async (storeId: number, at: Date | null) => c.ds.getRepository(EdgeDevice).update({ storeId }, { lastSeenAt: at });

  let tn: number; // T Nagar store
  let an: number; // Anna Nagar store
  let hik: { id: number }; // T Nagar Hikvision DVR
  let cams: { id: number; channel: number; rtspUrl: string }[] = [];
  let jpeg: Buffer;

  beforeAll(async () => {
    c = await createTestApp();
    tn = c.seed.stores.tnagar;
    an = c.seed.stores.annanagar;
    jpeg = await renderScene({ title: 'DVR ch1', ts: '2026-10-06 11:00:00', view: 'ENTRANCE', people: 2, seed: 3, width: 320, height: 180 });
  });
  afterAll(async () => c.app.close());

  const valid = (extra: object = {}) => ({
    storeId: tn, name: 'Main DVR', kind: 'DVR', brand: 'HIKVISION', host: '10.0.0.20', rtspPort: 554, httpPort: 80,
    username: 'admin', password: PW, channels: 8, stream: 'MAIN', ...extra,
  });

  describe('brands', () => {
    it('any authenticated user gets the brand catalogue', async () => {
      await c.http().get('/api/recorders/brands').expect(401);
      const r = await as('staff').get('/api/recorders/brands').expect(200);
      expect(r.body.map((b: { brand: string }) => b.brand)).toEqual(['HIKVISION', 'CP_PLUS', 'DAHUA', 'UNIVIEW', 'GODREJ', 'HONEYWELL', 'TIANDY', 'GENERIC_ONVIF', 'CUSTOM']);
      for (const b of r.body) expect(Object.keys(b).sort()).toEqual(['brand', 'defaultRtspPort', 'label', 'mainTemplate', 'notes', 'subTemplate']);
      expect(r.body[0]).toMatchObject({ brand: 'HIKVISION', label: 'Hikvision / Prama / HiLook', defaultRtspPort: 554, mainTemplate: 'rtsp://{user}:{pass}@{host}:{port}/Streaming/Channels/{channel}01', subTemplate: 'rtsp://{user}:{pass}@{host}:{port}/Streaming/Channels/{channel}02' });
      expect(r.body[1].mainTemplate).toBe('rtsp://{user}:{pass}@{host}:{port}/cam/realmonitor?channel={channel}&subtype=0');
      expect(r.body[2].subTemplate).toBe('rtsp://{user}:{pass}@{host}:{port}/cam/realmonitor?channel={channel}&subtype=1');
      expect(r.body[7].mainTemplate).toBe('rtsp://{user}:{pass}@{host}:{port}/ch{channel}/main');
    });
  });

  describe('recorder CRUD and validation', () => {
    it('creates a recorder; the password is write-only', async () => {
      const r = await as('admin').post('/api/recorders', valid()).expect(201);
      hik = r.body;
      expect(r.body).toEqual({
        id: expect.any(Number), storeId: tn, storeName: 'Congruence T Nagar', name: 'Main DVR', kind: 'DVR', brand: 'HIKVISION', host: '10.0.0.20',
        rtspPort: 554, httpPort: 80, username: 'admin', hasPassword: true, channels: 8, stream: 'MAIN', urlTemplate: null, status: 'UNKNOWN',
        lastCheckedAt: null, camerasLinked: 0, createdAt: expect.any(String),
      });
      // stored encrypted, never plain
      const row = await c.ds.getRepository(Recorder).findOneByOrFail({ id: hik.id });
      expect(row.passwordEnc).toMatch(/^v1:/);
      expect(row.passwordEnc).not.toContain(PW);
      // defaults: rtspPort from brand, httpPort 80, stream MAIN, no password
      const d = await as('admin').post('/api/recorders', { storeId: tn, name: 'Back office NVR', kind: 'NVR', brand: 'DAHUA', host: 'NVR-Backoffice.local', username: 'viewer', channels: 4 }).expect(201);
      expect(d.body).toMatchObject({ host: 'nvr-backoffice.local', rtspPort: 554, httpPort: 80, stream: 'MAIN', hasPassword: false, urlTemplate: null });
      await as('admin').del(`/api/recorders/${d.body.id}`).expect(200);
    });

    it.each([
      ['bad host', { host: '10.0.0.300' }],
      ['host with scheme', { host: 'rtsp://10.0.0.20' }],
      ['host with spaces', { host: 'dvr one' }],
      ['rtspPort 0', { rtspPort: 0 }],
      ['rtspPort 65536', { rtspPort: 65536 }],
      ['httpPort 70000', { httpPort: 70000 }],
      ['channels 0', { channels: 0 }],
      ['channels 65', { channels: 65 }],
      ['channels 2.5', { channels: 2.5 }],
      ['unknown brand', { brand: 'SONY' }],
      ['unknown kind', { kind: 'VCR' }],
      ['unknown stream', { stream: 'THIRD' }],
      ['missing name', { name: '' }],
      ['missing username', { username: undefined }],
      ['CUSTOM without template', { brand: 'CUSTOM', host: '10.0.0.99' }],
      ['CUSTOM template not rtsp', { brand: 'CUSTOM', host: '10.0.0.99', urlTemplate: 'http://{host}/ch{channel}' }],
      ['CUSTOM template without {channel}', { brand: 'CUSTOM', host: '10.0.0.99', urlTemplate: 'rtsp://{host}:{port}/live' }],
    ])('400: %s', async (_name, extra) => {
      const r = await as('admin').post('/api/recorders', valid({ host: '10.0.0.98', ...extra })).expect(400);
      expect(r.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    });

    it('accepts IPv6 and hostnames; CUSTOM keeps its template, others drop it', async () => {
      const v6 = await as('admin').post('/api/recorders', valid({ name: 'v6', host: 'fe80::20', urlTemplate: 'rtsp://ignored/{channel}' })).expect(201);
      expect(v6.body).toMatchObject({ host: 'fe80::20', urlTemplate: null });
      const cu = await as('admin').post('/api/recorders', valid({ name: 'Custom', brand: 'CUSTOM', kind: 'HYBRID', host: 'dvr.tnagar.congruence.in', urlTemplate: 'rtsp://{user}:{pass}@{host}:{port}/live/ch{channel}' })).expect(201);
      expect(cu.body).toMatchObject({ brand: 'CUSTOM', kind: 'HYBRID', urlTemplate: 'rtsp://{user}:{pass}@{host}:{port}/live/ch{channel}' });
      // switching away from CUSTOM clears the template; back to CUSTOM without one is refused
      const p = await as('admin').patch(`/api/recorders/${cu.body.id}`, { brand: 'TIANDY' }).expect(200);
      expect(p.body.urlTemplate).toBeNull();
      await as('admin').patch(`/api/recorders/${cu.body.id}`, { brand: 'CUSTOM' }).expect(400);
      await as('admin').del(`/api/recorders/${cu.body.id}`).expect(200);
      await as('admin').del(`/api/recorders/${v6.body.id}`).expect(200);
    });

    it('409 for a second recorder with the same host and port in a store', async () => {
      const r = await as('admin').post('/api/recorders', valid({ name: 'dup', host: '10.0.0.20' })).expect(409);
      expect(r.body).toMatchObject({ statusCode: 409, error: 'Conflict' });
      await as('admin').post('/api/recorders', valid({ name: 'dup upper', host: '10.0.0.20 ' })).expect(409);
      // another port, or another store, is fine
      const other = await as('admin').post('/api/recorders', valid({ name: 'Other port', rtspPort: 10554 })).expect(201);
      // a PATCH onto an existing host:port is a conflict too
      await as('admin').patch(`/api/recorders/${other.body.id}`, { rtspPort: 554 }).expect(409);
      await as('admin').del(`/api/recorders/${other.body.id}`).expect(200);
    });

    it('RBAC: ADMIN+ or STORE_MANAGER for their own store; others read-only', async () => {
      await as('staff').post('/api/recorders', valid({ host: '10.0.0.50' })).expect(403);
      await as('auditor').post('/api/recorders', valid({ host: '10.0.0.50' })).expect(403);
      await as('regional').post('/api/recorders', valid({ host: '10.0.0.50' })).expect(403);
      await as('manager').post('/api/recorders', valid({ storeId: an, host: '10.0.0.50' })).expect(403);
      const own = await as('manager').post('/api/recorders', valid({ name: 'Manager DVR', host: '10.0.0.50', brand: 'CP_PLUS', password: PW3 })).expect(201);
      expect(own.body.storeId).toBe(tn);
      await as('manager').patch(`/api/recorders/${own.body.id}`, { name: 'Manager DVR 2' }).expect(200);
      await as('staff').patch(`/api/recorders/${own.body.id}`, { name: 'x' }).expect(403);
      await as('auditor').del(`/api/recorders/${own.body.id}`).expect(403);
      await as('staff').post(`/api/recorders/${own.body.id}/test`).expect(403);
      await as('staff').post(`/api/recorders/${own.body.id}/generate-cameras`, { channels: [1] }).expect(403);
      // reads
      expect((await as('staff').get(`/api/recorders/${own.body.id}`).expect(200)).body.name).toBe('Manager DVR 2');
      expect((await as('auditor').get('/api/recorders').expect(200)).body.length).toBe(2);
      await as('manager').del(`/api/recorders/${own.body.id}`).expect(200);
    });

    it('lists are store-scoped; single reads outside scope are 403', async () => {
      const ann = await as('admin').post('/api/recorders', valid({ storeId: an, name: 'Anna Nagar DVR', brand: 'CP_PLUS', password: PW3 })).expect(201);
      expect(ann.body).toMatchObject({ storeId: an, storeName: 'Congruence Anna Nagar', host: '10.0.0.20' });
      expect((await as('admin').get('/api/recorders').expect(200)).body.map((r: { storeId: number }) => r.storeId)).toEqual([tn, an]);
      expect((await as('admin').get(`/api/recorders?storeId=${an}`).expect(200)).body).toHaveLength(1);
      expect((await as('manager').get('/api/recorders').expect(200)).body.map((r: { id: number }) => r.id)).toEqual([hik.id]);
      expect((await as('manager').get(`/api/recorders?storeId=${an}`).expect(200)).body).toEqual([]);
      await as('manager').get(`/api/recorders/${ann.body.id}`).expect(403);
      await as('manager').patch(`/api/recorders/${ann.body.id}`, { name: 'x' }).expect(403);
      await as('admin').get('/api/recorders/99999').expect(404);
    });
  });

  describe('cameras on recorder channels', () => {
    it('generate-cameras: masked URLs, idempotent per channel', async () => {
      const r = await as('manager').post(`/api/recorders/${hik.id}/generate-cameras`, { channels: [1, 2, 3], type: 'ZONE', namePrefix: 'DVR ch' }).expect(201);
      expect(r.body).toHaveLength(3);
      expect(r.body[0]).toEqual({
        id: expect.any(Number), storeId: tn, name: 'DVR ch 1', rtspUrl: 'rtsp://admin:****@10.0.0.20:554/Streaming/Channels/101', type: 'ZONE',
        status: 'UNKNOWN', lastHeartbeatAt: null, isActive: true, fps: null, recorderId: hik.id, channel: 1, streamProfile: 'MAIN',
      });
      expect(r.body[2].rtspUrl).toBe('rtsp://admin:****@10.0.0.20:554/Streaming/Channels/301');
      const again = await as('admin').post(`/api/recorders/${hik.id}/generate-cameras`, { channels: [3, 2, 4] }).expect(201);
      expect(again.body.map((x: { id: number }) => x.id).slice(0, 2)).toEqual([r.body[2].id, r.body[1].id]);
      expect(again.body[2]).toMatchObject({ name: 'Channel 4', type: 'GENERAL', channel: 4, rtspUrl: 'rtsp://admin:****@10.0.0.20:554/Streaming/Channels/401' });
      cams = [...r.body, again.body[2]];
      await as('admin').post(`/api/recorders/${hik.id}/generate-cameras`, { channels: [9] }).expect(400);
      await as('admin').post(`/api/recorders/${hik.id}/generate-cameras`, { channels: [] }).expect(400);
      await as('admin').post(`/api/recorders/${hik.id}/generate-cameras`, { channels: [0] }).expect(400);
      expect((await as('admin').get(`/api/recorders/${hik.id}`).expect(200)).body.camerasLinked).toBe(4);
      const list = (await as('staff').get(`/api/cameras?storeId=${tn}`).expect(200)).body.filter((x: { recorderId: number }) => x.recorderId === hik.id);
      expect(list).toHaveLength(4);
      for (const cam of list) expect(cam.rtspUrl).toMatch(/^rtsp:\/\/admin:\*\*\*\*@10\.0\.0\.20:554\/Streaming\/Channels\/[1-4]01$/);
      // the store detail embeds the masked camera too
      const store = await as('manager').get(`/api/stores/${tn}`).expect(200);
      expect(store.body.cameras.find((x: { id: number }) => x.id === cams[0].id).rtspUrl).toBe('rtsp://admin:****@10.0.0.20:554/Streaming/Channels/101');
    });

    it('edge config carries the real URL (password URL-encoded) and recorder details', async () => {
      const r = await edge(c.seed.keys.tnagar).get('/api/ingest/config').expect(200);
      const cam1 = r.body.cameras.find((x: { id: number }) => x.id === cams[0].id);
      expect(cam1).toMatchObject({ recorderId: hik.id, channel: 1, streamProfile: 'MAIN', rtspUrl: `rtsp://admin:${PW_ENC}@10.0.0.20:554/Streaming/Channels/101` });
      expect(cam1.recorder).toEqual({ id: hik.id, brand: 'HIKVISION', kind: 'DVR', host: '10.0.0.20', rtspPort: 554, httpPort: 80, stream: 'MAIN' });
      expect(r.body.cameras.find((x: { id: number }) => x.id === cams[3].id).rtspUrl).toBe(`rtsp://admin:${PW_ENC}@10.0.0.20:554/Streaming/Channels/401`);
      // a camera without a recorder keeps its own URL
      expect(r.body.cameras.find((x: { id: number }) => x.id === c.seed.cameras.entrance).rtspUrl).toBe(`rtsp://10.0.${tn}.10/Entrance`);
    });

    it('PATCH camera links / unlinks a channel with validation', async () => {
      const id = c.seed.cameras.billing;
      const r = await as('admin').patch(`/api/cameras/${id}`, { recorderId: hik.id, channel: 5, streamProfile: 'SUB' }).expect(200);
      expect(r.body).toMatchObject({ recorderId: hik.id, channel: 5, streamProfile: 'SUB', rtspUrl: 'rtsp://admin:****@10.0.0.20:554/Streaming/Channels/502' });
      await as('admin').patch(`/api/cameras/${id}`, { channel: 1 }).expect(409); // channel 1 is taken
      await as('admin').patch(`/api/cameras/${id}`, { channel: 9 }).expect(400); // > channels
      await as('admin').patch(`/api/cameras/${c.seed.cameras.entrance2}`, { recorderId: hik.id, channel: 6 }).expect(400); // other store
      await as('admin').patch(`/api/cameras/${c.seed.cameras.floor}`, { recorderId: hik.id }).expect(400); // channel required
      // rtspUrl of a linked camera cannot be overwritten with a plain URL
      expect((await as('admin').patch(`/api/cameras/${id}`, { rtspUrl: 'rtsp://u:p@1.2.3.4/x' }).expect(200)).body.rtspUrl).toBe('rtsp://admin:****@10.0.0.20:554/Streaming/Channels/502');
      const un = await as('admin').patch(`/api/cameras/${id}`, { recorderId: null }).expect(200);
      expect(un.body).toMatchObject({ recorderId: null, channel: null, streamProfile: null, rtspUrl: '' });
      // POST /api/cameras can link at creation
      const created = await as('admin').post('/api/cameras', { storeId: tn, name: 'Stock room', type: 'GENERAL', recorderId: hik.id, channel: 6 }).expect(201);
      expect(created.body).toMatchObject({ recorderId: hik.id, channel: 6, streamProfile: 'MAIN', rtspUrl: 'rtsp://admin:****@10.0.0.20:554/Streaming/Channels/601' });
      // soft-deleting a camera frees its channel; generate-cameras then makes a new one
      await as('admin').del(`/api/cameras/${created.body.id}`).expect(200);
      const regen = await as('admin').post(`/api/recorders/${hik.id}/generate-cameras`, { channels: [6] }).expect(201);
      expect(regen.body[0].id).not.toBe(created.body.id);
      await as('admin').del(`/api/cameras/${regen.body[0].id}`).expect(200);
    });

    it('PATCH recorder: password kept when omitted, replaced, cleared; host change re-masks cameras', async () => {
      const cfgUrl = async () => (await edge(c.seed.keys.tnagar).get('/api/ingest/config').expect(200)).body.cameras.find((x: { id: number }) => x.id === cams[0].id).rtspUrl;
      let p = await as('admin').patch(`/api/recorders/${hik.id}`, { name: 'T Nagar DVR' }).expect(200);
      expect(p.body).toMatchObject({ name: 'T Nagar DVR', hasPassword: true });
      expect(await cfgUrl()).toBe(`rtsp://admin:${PW_ENC}@10.0.0.20:554/Streaming/Channels/101`);
      p = await as('admin').patch(`/api/recorders/${hik.id}`, { password: '' }).expect(200); // "" keeps it
      expect(p.body.hasPassword).toBe(true);
      p = await as('admin').patch(`/api/recorders/${hik.id}`, { password: PW2, host: '10.0.0.21' }).expect(200);
      expect(p.body).toMatchObject({ hasPassword: true, host: '10.0.0.21' });
      expect(await cfgUrl()).toBe(`rtsp://admin:${encodeURIComponent(PW2)}@10.0.0.21:554/Streaming/Channels/101`);
      expect((await as('admin').get(`/api/cameras/${cams[0].id}`).expect(200)).body.rtspUrl).toBe('rtsp://admin:****@10.0.0.21:554/Streaming/Channels/101');
      p = await as('admin').patch(`/api/recorders/${hik.id}`, { password: null }).expect(200);
      expect(p.body.hasPassword).toBe(false);
      expect(await cfgUrl()).toBe('rtsp://admin@10.0.0.21:554/Streaming/Channels/101');
      expect((await as('admin').get(`/api/cameras/${cams[0].id}`).expect(200)).body.rtspUrl).toBe('rtsp://admin@10.0.0.21:554/Streaming/Channels/101');
      p = await as('admin').patch(`/api/recorders/${hik.id}`, { password: PW, host: '10.0.0.20' }).expect(200);
      expect(await cfgUrl()).toBe(`rtsp://admin:${PW_ENC}@10.0.0.20:554/Streaming/Channels/101`);
      // channels cannot drop below a linked channel
      const r = await as('admin').patch(`/api/recorders/${hik.id}`, { channels: 3 }).expect(400);
      expect(JSON.stringify(r.body.message)).toContain('channel 4');
      await as('admin').patch(`/api/recorders/${hik.id}`, { channels: 70 }).expect(400);
      await as('admin').patch(`/api/recorders/${hik.id}`, { host: 'bad host' }).expect(400);
    });
  });

  describe('connection tests (probes)', () => {
    it('EDGE_OFFLINE: immediate failure when the store edge has never been seen or is stale', async () => {
      const ann = (await as('admin').get(`/api/recorders?storeId=${an}`).expect(200)).body[0];
      const r = await as('admin').post(`/api/recorders/${ann.id}/test`, { channels: [1, 2] }).expect(201);
      expect(r.body).toHaveLength(2);
      for (const p of r.body) {
        expect(p).toEqual({
          id: expect.any(Number), storeId: an, cameraId: null, recorderId: ann.id, channel: expect.any(Number), status: 'FAILED',
          requestedAt: expect.any(String), completedAt: expect.any(String), width: null, height: null, fps: null, codec: null, latencyMs: null,
          error: "The store's AI box is offline", errorCode: 'EDGE_OFFLINE', snapshotUrl: null,
        });
      }
      // EDGE_OFFLINE results never change the recorder status
      expect((await as('admin').get(`/api/recorders/${ann.id}`).expect(200)).body.status).toBe('UNKNOWN');
      // T Nagar edge seen 10 min ago (CAMERA_STALE_SEC = 180)
      await setEdgeSeen(tn, new Date(Date.now() - 600_000));
      const cam = await as('manager').post(`/api/cameras/${cams[0].id}/test`).expect(201);
      expect(cam.body).toMatchObject({ status: 'FAILED', errorCode: 'EDGE_OFFLINE', cameraId: cams[0].id, recorderId: hik.id, channel: 1 });
      await setEdgeSeen(tn, new Date());
    });

    let probes: { id: number; channel: number; cameraId: number | null }[] = [];
    it('recorder test → PENDING per channel; the edge claims them (RUNNING) with real URLs', async () => {
      const r = await as('manager').post(`/api/recorders/${hik.id}/test`, { channels: [1, 2, 3, 7] }).expect(201);
      probes = r.body;
      expect(r.body.map((p: { channel: number }) => p.channel)).toEqual([1, 2, 3, 7]);
      expect(r.body[0]).toMatchObject({ status: 'PENDING', storeId: tn, recorderId: hik.id, cameraId: cams[0].id, completedAt: null, errorCode: null });
      expect(r.body[3].cameraId).toBeNull(); // channel 7 has no camera
      await as('manager').post(`/api/recorders/${hik.id}/test`, { channels: [9] }).expect(400);
      // another store's edge sees nothing
      expect((await edge(c.seed.keys.annanagar).get('/api/ingest/probes').expect(200)).body).toEqual([]);
      const claim = await edge(c.seed.keys.tnagar).get('/api/ingest/probes').expect(200);
      expect(claim.body).toHaveLength(4);
      expect(claim.body[0]).toEqual({
        id: probes[0].id, rtspUrl: `rtsp://admin:${PW_ENC}@10.0.0.20:554/Streaming/Channels/101`, cameraId: cams[0].id, recorderId: hik.id, channel: 1,
        brand: 'HIKVISION', streamProfile: 'MAIN', onvif: null,
      });
      expect(claim.body[3].rtspUrl).toBe(`rtsp://admin:${PW_ENC}@10.0.0.20:554/Streaming/Channels/701`);
      expect((await edge(c.seed.keys.tnagar).get('/api/ingest/probes').expect(200)).body).toEqual([]); // already claimed
      expect((await as('manager').get(`/api/probes/${probes[0].id}`).expect(200)).body.status).toBe('RUNNING');
    });

    it('results: OK with snapshot, FAILED with codes; recorder status aggregates per channel', async () => {
      const key = c.seed.keys.tnagar;
      await edge(c.seed.keys.annanagar).result(probes[0].id, { status: 'OK' }).expect(404); // not its store
      await c.http().post(`/api/ingest/probes/${probes[0].id}`).field('result', '{}').expect(401);
      await edge(key).result(probes[0].id, { status: 'MAYBE' }).expect(400);
      await edge(key).result(probes[0].id, { status: 'FAILED', errorCode: 'BOGUS' }).expect(400);
      await edge(key).result(probes[0].id, 'not json').expect(400);
      const ok = await edge(key).result(probes[0].id, { status: 'OK', width: 1920, height: 1080, fps: 25, codec: 'h264', latencyMs: 840 }, jpeg).expect(200);
      expect(ok.body).toMatchObject({ id: probes[0].id, status: 'OK', width: 1920, height: 1080, fps: 25, codec: 'h264', latencyMs: 840, error: null, errorCode: null });
      expect(ok.body.snapshotUrl).toMatch(new RegExp(`^/uploads/probes/${tn}/probe-${probes[0].id}-[0-9a-f]+\\.jpg$`));
      const img = await c.http().get(ok.body.snapshotUrl).expect(200);
      expect(img.headers['content-type']).toContain('image/jpeg');
      await edge(key).result(probes[0].id, { status: 'OK' }).expect(409); // already completed
      // ffmpeg errors can echo the URL; credentials are redacted
      const auth = await edge(key).result(probes[1].id, { status: 'FAILED', errorCode: 'AUTH', error: `rtsp://admin:${PW_ENC}@10.0.0.20:554/Streaming/Channels/201: 401 Unauthorized`, latencyMs: 120 }).expect(200);
      expect(auth.body).toMatchObject({ status: 'FAILED', errorCode: 'AUTH', error: 'rtsp://admin:****@10.0.0.20:554/Streaming/Channels/201: 401 Unauthorized', snapshotUrl: null });
      // JSON body (no multipart) is accepted too; FAILED without a code is OTHER
      const other = await c.http().post(`/api/ingest/probes/${probes[2].id}`).set('X-Api-Key', key).send({ status: 'FAILED', error: 'weird' }).expect(200);
      expect(other.body).toMatchObject({ errorCode: 'OTHER', error: 'weird' });
      let rec = (await as('admin').get(`/api/recorders/${hik.id}`).expect(200)).body;
      expect(rec.status).toBe('PARTIAL'); // ch1 OK, ch2/3 FAILED, ch7 still running
      expect(rec.lastCheckedAt).toEqual(expect.any(String));
      await edge(key).result(probes[3].id, { status: 'FAILED', errorCode: 'NOT_FOUND', error: '404 Not Found' }).expect(200);

      // all channels OK → ONLINE
      const round2 = (await as('admin').post(`/api/recorders/${hik.id}/test`, { channels: [1, 2, 3, 7] }).expect(201)).body;
      await edge(key).get('/api/ingest/probes').expect(200);
      for (const p of round2) await edge(key).result(p.id, { status: 'OK', width: 704, height: 576, fps: 12.5, codec: 'h264' }).expect(200);
      rec = (await as('admin').get(`/api/recorders/${hik.id}`).expect(200)).body;
      expect(rec.status).toBe('ONLINE');
      // all failing → OFFLINE (no claim needed: a PENDING probe can be answered directly)
      const round3 = (await as('admin').post(`/api/recorders/${hik.id}/test`).expect(201)).body;
      expect(round3).toHaveLength(8); // every channel by default
      for (const p of round3) await edge(key).result(p.id, { status: 'FAILED', errorCode: 'UNREACHABLE', error: 'Connection refused' }).expect(200);
      expect((await as('admin').get(`/api/recorders/${hik.id}`).expect(200)).body.status).toBe('OFFLINE');
      // one channel back → PARTIAL
      const one = (await as('admin').post(`/api/cameras/${cams[1].id}/test`).expect(201)).body;
      expect(one).toMatchObject({ cameraId: cams[1].id, recorderId: hik.id, channel: 2, status: 'PENDING' });
      await edge(key).result(one.id, { status: 'OK', width: 1280, height: 720, fps: 15, codec: 'hevc' }).expect(200);
      expect((await as('admin').get(`/api/recorders/${hik.id}`).expect(200)).body.status).toBe('PARTIAL');
    });

    it.each(['AUTH', 'TIMEOUT', 'UNREACHABLE', 'NOT_FOUND', 'UNSUPPORTED_CODEC', 'OTHER'])('FAILED with errorCode %s', async (code) => {
      const p = (await as('admin').post(`/api/cameras/${c.seed.cameras.floor}/test`).expect(201)).body;
      expect(p).toMatchObject({ cameraId: c.seed.cameras.floor, recorderId: null, channel: null, status: 'PENDING' });
      const claim = (await edge(c.seed.keys.tnagar).get('/api/ingest/probes').expect(200)).body;
      expect(claim).toEqual([{ id: p.id, rtspUrl: `rtsp://10.0.${tn}.10/Floor1`, cameraId: c.seed.cameras.floor, recorderId: null, channel: null, brand: null, streamProfile: null, onvif: null }]);
      const r = await edge(c.seed.keys.tnagar).result(p.id, { status: 'FAILED', errorCode: code, error: `failed: ${code}`, latencyMs: 10000 }).expect(200);
      expect(r.body).toMatchObject({ status: 'FAILED', errorCode: code, error: `failed: ${code}`, latencyMs: 10000, completedAt: expect.any(String) });
      expect((await as('staff').get(`/api/probes/${p.id}`).expect(200)).body.errorCode).toBe(code);
    });

    it('EXPIRED after 60 s (computed on read and by the cron); late results are refused', async () => {
      const pending = (await as('admin').post(`/api/cameras/${cams[2].id}/test`).expect(201)).body;
      const running = (await as('admin').post(`/api/cameras/${cams[3].id}/test`).expect(201)).body;
      await edge(c.seed.keys.tnagar).get('/api/ingest/probes').expect(200);
      expect((await as('admin').get(`/api/probes/${pending.id}`).expect(200)).body.status).toBe('RUNNING');
      const old = new Date(Date.now() - 61_000);
      await c.ds.getRepository(Probe).update(pending.id, { requestedAt: old });
      const e = (await as('admin').get(`/api/probes/${pending.id}`).expect(200)).body;
      expect(e).toMatchObject({ status: 'EXPIRED', errorCode: null, error: "No result from the store's AI box within 60 s", completedAt: expect.any(String) });
      await edge(c.seed.keys.tnagar).result(pending.id, { status: 'OK' }).expect(409);
      // the cron path
      await c.ds.getRepository(Probe).update(running.id, { requestedAt: old });
      expect(await c.app.get(ProbesService).expireStale()).toBe(1);
      expect((await c.ds.getRepository(Probe).findOneByOrFail({ id: running.id })).status).toBe('EXPIRED');
      // a fresh PENDING probe is not expired
      const fresh = (await as('admin').post(`/api/cameras/${cams[2].id}/test`).expect(201)).body;
      expect((await as('admin').get(`/api/probes/${fresh.id}`).expect(200)).body.status).toBe('PENDING');
      // EXPIRED does not change the recorder status
      expect((await as('admin').get(`/api/recorders/${hik.id}`).expect(200)).body.status).toBe('PARTIAL');
      await edge(c.seed.keys.tnagar).result(fresh.id, { status: 'OK' }).expect(200);
    });

    it('GENERIC_ONVIF probes carry the ONVIF login for GetStreamUri on the edge', async () => {
      const r = (await as('admin').post('/api/recorders', valid({ name: 'ONVIF NVR', kind: 'NVR', brand: 'GENERIC_ONVIF', host: '10.0.0.40', httpPort: 8080, channels: 2, stream: 'SUB' })).expect(201)).body;
      const [p] = (await as('admin').post(`/api/recorders/${r.id}/test`, { channels: [2] }).expect(201)).body;
      const claim = (await edge(c.seed.keys.tnagar).get('/api/ingest/probes').expect(200)).body;
      expect(claim).toEqual([{
        id: p.id, rtspUrl: `rtsp://admin:${PW_ENC}@10.0.0.40:554/ch2/sub`, cameraId: null, recorderId: r.id, channel: 2, brand: 'GENERIC_ONVIF', streamProfile: 'SUB',
        onvif: { host: '10.0.0.40', httpPort: 8080, username: 'admin', password: PW },
      }]);
      await edge(c.seed.keys.tnagar).result(p.id, { status: 'OK', width: 640, height: 360, fps: 10, codec: 'h264' }).expect(200);
      expect((await as('admin').get(`/api/recorders/${r.id}`).expect(200)).body).toMatchObject({ status: 'ONLINE', stream: 'SUB' });
      await as('admin').del(`/api/recorders/${r.id}`).expect(200);
    });

    it('camera test edge cases and probe lists', async () => {
      const bare = await as('admin').post('/api/cameras', { storeId: tn, name: 'No URL', type: 'GENERAL' }).expect(201);
      await as('admin').post(`/api/cameras/${bare.body.id}/test`).expect(400);
      await as('admin').post('/api/cameras/99999/test').expect(404);
      await as('manager').post(`/api/cameras/${c.seed.cameras.entrance2}/test`).expect(403);
      await as('staff').post(`/api/cameras/${cams[0].id}/test`).expect(403);
      await as('auditor').post(`/api/cameras/${cams[0].id}/test`).expect(403);
      await as('regional').post(`/api/cameras/${cams[0].id}/test`).expect(403);
      const all = (await as('admin').get(`/api/probes?storeId=${tn}`).expect(200)).body;
      expect(all.length).toBeLessThanOrEqual(50);
      const ts = all.map((p: { requestedAt: string; id: number }) => `${p.requestedAt}|${String(p.id).padStart(6, '0')}`);
      expect([...ts].sort().reverse()).toEqual(ts);
      const byRec = (await as('admin').get(`/api/probes?recorderId=${hik.id}`).expect(200)).body;
      expect(byRec.length).toBeGreaterThan(0);
      expect(byRec.every((p: { recorderId: number }) => p.recorderId === hik.id)).toBe(true);
      const byCam = (await as('staff').get(`/api/probes?cameraId=${cams[1].id}`).expect(200)).body;
      expect(byCam.length).toBeGreaterThan(0);
      expect(byCam.every((p: { cameraId: number }) => p.cameraId === cams[1].id)).toBe(true);
      expect((await as('manager').get(`/api/probes?storeId=${an}`).expect(200)).body).toEqual([]);
      const annProbe = (await as('admin').get(`/api/probes?storeId=${an}`).expect(200)).body[0];
      await as('manager').get(`/api/probes/${annProbe.id}`).expect(403);
      await as('admin').get('/api/probes/999999').expect(404);
    });
  });

  describe('LAN discovery', () => {
    it('edge reports devices (upsert); browsers list them by store', async () => {
      const key = c.seed.keys.tnagar;
      expect((await edge(key).post('/api/ingest/discovered', { devices: [
        { host: '10.0.0.20', port: 554, httpPort: 80, brandGuess: 'HIKVISION', onvif: true },
        { host: '10.0.0.31', port: 554, brandGuess: null, onvif: false },
      ] }).expect(200)).body).toEqual({ accepted: 2 });
      // a bare array works too; the same host+port is updated, not duplicated
      expect((await edge(key).post('/api/ingest/discovered', [{ host: '10.0.0.31', rtspPort: 554, brandGuess: 'DAHUA', onvif: true }]).expect(200)).body).toEqual({ accepted: 1 });
      await edge(key).post('/api/ingest/discovered', { devices: [{ host: 'not a host' }] }).expect(400);
      await edge(key).post('/api/ingest/discovered', { devices: 'x' }).expect(400);
      await c.http().post('/api/ingest/discovered').send({ devices: [] }).expect(401);
      const list = (await as('manager').get(`/api/recorders/discovered?storeId=${tn}`).expect(200)).body;
      expect(list).toHaveLength(2);
      expect(list[0]).toEqual({ host: '10.0.0.31', rtspPort: 554, httpPort: null, brandGuess: 'DAHUA', onvif: true, seenAt: expect.any(String) });
      expect(list.find((d: { host: string }) => d.host === '10.0.0.20')).toEqual({ host: '10.0.0.20', rtspPort: 554, httpPort: 80, brandGuess: 'HIKVISION', onvif: true, seenAt: expect.any(String) });
      expect((await as('manager').get(`/api/recorders/discovered?storeId=${an}`).expect(200)).body).toEqual([]);
      expect((await as('staff').get('/api/recorders/discovered').expect(200)).body).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('409 while cameras are linked, unless ?unlinkCameras=true', async () => {
      const r = await as('admin').del(`/api/recorders/${hik.id}`).expect(409);
      expect(r.body).toMatchObject({ statusCode: 409, error: 'Conflict' });
      await as('staff').del(`/api/recorders/${hik.id}?unlinkCameras=true`).expect(403);
      await as('manager').del(`/api/recorders/${hik.id}?unlinkCameras=true`).expect(200);
      await as('admin').get(`/api/recorders/${hik.id}`).expect(404);
      for (const cam of cams) {
        expect((await as('admin').get(`/api/cameras/${cam.id}`).expect(200)).body).toMatchObject({ recorderId: null, channel: null, streamProfile: null, rtspUrl: '', isActive: true });
      }
      expect((await as('admin').get(`/api/probes?recorderId=${hik.id}`).expect(200)).body).toEqual([]);
      // a recorder without cameras is deleted straight away
      const ann = (await as('admin').get(`/api/recorders?storeId=${an}`).expect(200)).body[0];
      await as('admin').del(`/api/recorders/${ann.id}`).expect(200);
    });
  });

  describe('secrets', () => {
    it('no browser response ever contains a recorder password (plain, URL-encoded or encrypted)', async () => {
      // the audit log masks the write-only field too
      const audit = await as('admin').get('/api/audit-logs?entity=recorders&pageSize=200').expect(200);
      expect(audit.body.total).toBeGreaterThan(5);
      expect(audit.body.items.some((i: { details: string }) => i.details?.includes('"password":"***"'))).toBe(true);
      expect(seen.length).toBeGreaterThan(100);
      for (const { url, text } of seen) {
        for (const s of SECRETS) expect([url, text.includes(s)]).toEqual([url, false]);
        expect([url, /passwordEnc|"v1:/.test(text)]).toEqual([url, false]);
        expect([url, /"password"\s*:\s*"(?!\*\*\*")/.test(text)]).toEqual([url, false]);
      }
    });
  });
});
