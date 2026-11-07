import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { hhmm, localParts } from '../common/time.util';
import { StoreScopeService } from '../common/store-scope.service';
import { uploadDir } from '../config/database.config';
import { Camera } from '../modules/cameras/entities/camera.entity';
import { DiscoveredDevice } from '../modules/recorders/entities/discovered-device.entity';
import { Probe } from '../modules/recorders/entities/probe.entity';
import { Recorder } from '../modules/recorders/entities/recorder.entity';
import { encryptSecret } from '../modules/recorders/recorder-crypto';
import { maskedChannelUrl } from '../modules/recorders/recorder-links';
import { EDGE_OFFLINE_MESSAGE, ProbesService } from '../modules/recorders/probes.service';
import { SeedStore } from './model';
import { renderScene } from './scene';

const MIN = 60_000;

/** One recorder per store (contract v3). Index = store order in catalog.ts. */
const RECORDERS: { short: string; name: string; kind: string; brand: string; channels: number; password: string; urlTemplate?: string }[] = [
  { short: 'TNR', name: 'T Nagar DVR (Hikvision 8ch)', kind: 'DVR', brand: 'HIKVISION', channels: 8, password: 'Cong@TNR#2026' },
  { short: 'ANN', name: 'Anna Nagar DVR (CP Plus 8ch)', kind: 'DVR', brand: 'CP_PLUS', channels: 8, password: 'Cong@ANN#2026' },
  { short: 'VEL', name: 'Velachery NVR (Dahua 16ch)', kind: 'NVR', brand: 'DAHUA', channels: 16, password: 'Cong@VEL#2026' },
  { short: 'ADY', name: 'Adyar DVR (Hikvision 8ch)', kind: 'DVR', brand: 'HIKVISION', channels: 8, password: 'Cong@ADY#2026' },
  { short: 'OMR', name: 'OMR DVR (CP Plus 8ch)', kind: 'DVR', brand: 'CP_PLUS', channels: 8, password: 'Cong@OMR#2026' },
  { short: 'CBE', name: 'RS Puram hybrid recorder', kind: 'HYBRID', brand: 'CUSTOM', channels: 8, password: 'Cong@CBE#2026', urlTemplate: 'rtsp://{user}:{pass}@{host}:{port}/live/ch{channel}' },
];

/**
 * Recorders linked to the seeded cameras by channel (Entrance = ch1, floors ch2–4, Billing ch5), a few
 * historical connection tests (one OK with a snapshot, one AUTH failure, a NOT_FOUND channel, an EDGE_OFFLINE)
 * and LAN discovery results.
 */
export async function seedRecorders(ds: DataSource, stores: SeedStore[], now: Date, log: (m: string) => void) {
  const recRepo = ds.getRepository(Recorder);
  const camRepo = ds.getRepository(Camera);
  const probes = ds.getRepository(Probe);
  const byShort = new Map<string, { store: SeedStore; rec: Recorder }>();
  for (const [i, s] of stores.entries()) {
    const def = RECORDERS.find((r) => r.short === s.def.short) ?? RECORDERS[i % RECORDERS.length];
    const rec = await recRepo.save(
      recRepo.create({
        storeId: s.id, name: def.name, kind: def.kind, brand: def.brand, host: `10.${20 + i}.1.20`, rtspPort: 554, httpPort: 80,
        username: 'admin', passwordEnc: encryptSecret(def.password), channels: def.channels, stream: 'MAIN', urlTemplate: def.urlTemplate ?? null,
        status: 'UNKNOWN', lastCheckedAt: null,
      }),
    );
    const cams: [Camera, number, string][] = [[s.entrance, 1, 'MAIN'], ...s.floors.map((c, k) => [c, k + 2, 'SUB'] as [Camera, number, string]), [s.billing, 5, 'SUB']];
    for (const [cam, channel, profile] of cams) {
      const rtspUrl = maskedChannelUrl(rec, channel, profile);
      await camRepo.update(cam.id, { recorderId: rec.id, channel, streamProfile: profile, rtspUrl });
      Object.assign(cam, { recorderId: rec.id, channel, streamProfile: profile, rtspUrl });
    }
    byShort.set(s.def.short, { store: s, rec });
  }

  let n = 0;
  const probe = async (short: string, channel: number, minutesAgo: number, result: Partial<Probe>, snapshot?: Buffer) => {
    const x = byShort.get(short);
    if (!x) return;
    const cam = [x.store.entrance, ...x.store.floors, x.store.billing].find((c) => c.channel === channel) ?? null;
    const requestedAt = new Date(now.getTime() - minutesAgo * MIN);
    const p = await probes.save(
      probes.create({
        storeId: x.store.id, cameraId: cam?.id ?? null, recorderId: x.rec.id, channel, streamProfile: cam?.streamProfile ?? 'MAIN', status: 'OK',
        requestedAt, claimedAt: new Date(requestedAt.getTime() + 2000), completedAt: new Date(requestedAt.getTime() + 6000),
        width: null, height: null, fps: null, codec: null, latencyMs: null, error: null, errorCode: null, snapshotPath: null, ...result,
      }),
    );
    if (snapshot) {
      const rel = `probes/${x.store.id}/probe-${p.id}-seed.jpg`;
      fs.mkdirSync(path.join(uploadDir(), 'probes', String(x.store.id)), { recursive: true });
      fs.writeFileSync(path.join(uploadDir(), rel), snapshot);
      await probes.update(p.id, { snapshotPath: rel });
    }
    n++;
  };
  const ok = (main: boolean): Partial<Probe> => (main ? { width: 1920, height: 1080, fps: 25, codec: 'h264', latencyMs: 820 } : { width: 704, height: 576, fps: 12.5, codec: 'h264', latencyMs: 640 });

  // T Nagar: every camera channel OK (entrance with a snapshot), channel 6 has no camera → PARTIAL
  const tnr = byShort.get('TNR');
  if (tnr) {
    const ts = `${localParts(new Date(now.getTime() - 95 * MIN), tnr.store.tz).date} ${hhmm(new Date(now.getTime() - 95 * MIN), tnr.store.tz)}`;
    const snap = await renderScene({ title: `${tnr.store.def.name} · DVR ch 1`, ts, view: 'ENTRANCE', people: 3, seed: 61, width: 640, height: 360 });
    await probe('TNR', 1, 95, ok(true), snap);
    for (const ch of [2, 3, 4, 5]) await probe('TNR', ch, 95, ok(false));
    await probe('TNR', 6, 95, { status: 'FAILED', error: 'RTSP 404 Not Found (DESCRIBE)', errorCode: 'NOT_FOUND', latencyMs: 210 });
  }
  // Anna Nagar: the DVR password was changed on site → AUTH → OFFLINE
  await probe('ANN', 1, 26 * 60, { status: 'FAILED', error: 'RTSP 401 Unauthorized', errorCode: 'AUTH', latencyMs: 180 });
  // Velachery NVR: all five camera channels OK → ONLINE
  for (const ch of [1, 2, 3, 4, 5]) await probe('VEL', ch, 3 * 60, ok(ch === 1));
  // Adyar: the edge box is offline (see seedInfra) → EDGE_OFFLINE, status stays UNKNOWN
  await probe('ADY', 1, 40, { status: 'FAILED', claimedAt: null, completedAt: new Date(now.getTime() - 40 * MIN), error: EDGE_OFFLINE_MESSAGE, errorCode: 'EDGE_OFFLINE' });

  const svc = new ProbesService(ds, new StoreScopeService(ds));
  for (const { rec } of byShort.values()) await svc.recomputeRecorderStatus(rec.id);

  const seen = new Date(now.getTime() - 20 * MIN);
  const found: Partial<DiscoveredDevice>[] = [];
  for (const short of ['TNR', 'ANN', 'VEL']) {
    const x = byShort.get(short);
    if (!x) continue;
    found.push({ storeId: x.store.id, host: x.rec.host, rtspPort: 554, httpPort: 80, brandGuess: x.rec.brand, onvif: short !== 'ANN', seenAt: seen });
  }
  if (tnr) {
    found.push({ storeId: tnr.store.id, host: '10.20.1.31', rtspPort: 554, httpPort: 80, brandGuess: 'HIKVISION', onvif: true, seenAt: seen });
    found.push({ storeId: tnr.store.id, host: '10.20.1.45', rtspPort: 554, httpPort: null, brandGuess: null, onvif: false, seenAt: seen });
  }
  if (found.length) await ds.getRepository(DiscoveredDevice).insert(found);
  const statuses = [...byShort.values()].map(({ store }) => store.def.short);
  const after = await recRepo.find({ order: { id: 'ASC' } });
  log(`Recorders: ${after.length} (${after.map((r, i) => `${statuses[i]} ${r.brand} ${r.status}`).join(', ')}), ${n} probes, ${found.length} discovered devices`);
}
