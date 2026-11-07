import '../env';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { localParts, todayLocal } from '../common/time.util';
import { databaseOptions } from '../config/database.config';
import { Camera } from '../modules/cameras/entities/camera.entity';
import { EdgeDevice } from '../modules/edge-devices/entities/edge-device.entity';
import { devKeyFor, hashKey, keyPrefix } from '../modules/edge-devices/edge-devices.service';
import { Region } from '../modules/regions/entities/region.entity';
import { Setting } from '../modules/settings/entities/setting.entity';
import { DEFAULT_SETTINGS } from '../modules/settings/settings.service';
import { Staff } from '../modules/staff/entities/staff.entity';
import { Store } from '../modules/stores/entities/store.entity';
import { Zone } from '../modules/zones/entities/zone.entity';
import { Role } from '../common/roles';
import { DESIGNATIONS, FLOOR_CAMS, SECTIONS, STAFF_NAMES, STORES } from './catalog';
import { seedCameraStatus, seedHeatmaps, seedHistory, seedLoyalVisits, seedStoreOps } from './history';
import { SeedStore } from './model';
import { Rng } from './rng';
import { seedToday } from './today';
import { PeopleIds, seedAlerts, seedChecklists, seedDocuments, seedSchedules, seedTasksTickets, seedVendors } from './trax';
import { contractUsers, insertUsers, SeedUserSpec } from './users.seed';
import { seedAiManager, seedInfra, seedMedia, seedRecap, seedTraxV2 } from './v2';
import { seedRecorders } from './v3';
import * as fs from 'fs';
import * as path from 'path';
import { uploadDir } from '../config/database.config';

export interface SeedOptions {
  reset?: boolean;
  days?: number;
  log?: (m: string) => void;
}

const rect = (cx: number, cy: number, w: number, h: number): [number, number][] => [
  [+(cx - w / 2).toFixed(3), +(cy - h / 2).toFixed(3)], [+(cx + w / 2).toFixed(3), +(cy - h / 2).toFixed(3)],
  [+(cx + w / 2).toFixed(3), +(cy + h / 2).toFixed(3)], [+(cx - w / 2).toFixed(3), +(cy + h / 2).toFixed(3)],
];

async function seedMasterData(ds: DataSource, rng: Rng): Promise<SeedStore[]> {
  const regions = new Map<string, number>();
  for (const name of ['Chennai', 'Coimbatore']) regions.set(name, (await ds.getRepository(Region).save({ name })).id);
  const out: SeedStore[] = [];
  let staffIdx = 0;
  for (const def of STORES) {
    const store = await ds.getRepository(Store).save({
      code: def.code, name: def.name, regionId: regions.get(def.region), city: def.city, address: def.address, timezone: 'Asia/Kolkata',
      openTime: def.openTime, closeTime: def.closeTime, areaSqft: def.areaSqft, format: def.format, isActive: true, latitude: def.lat, longitude: def.lng,
    });
    const net = `rtsp://admin:****@10.${20 + out.length}.1`;
    const cam = (name: string, type: string, n: number) => ds.getRepository(Camera).save({ storeId: store.id, name, type, rtspUrl: `${net}.${10 + n}:554/Streaming/Channels/101`, status: 'UNKNOWN', isActive: true });
    const entrance = await cam('Entrance', 'ENTRANCE', 0);
    const floors = [await cam(FLOOR_CAMS[0], 'ZONE', 1), await cam(FLOOR_CAMS[1], 'ZONE', 2), await cam(FLOOR_CAMS[2], 'ZONE', 3)];
    const billing = await cam('Billing', 'BILLING', 4);
    const zr = ds.getRepository(Zone);
    const entryLine = await zr.save({ storeId: store.id, cameraId: entrance.id, name: 'Main Entrance', type: 'ENTRY_LINE', polygon: [[0.15, 0.72], [0.85, 0.72]], inDirection: 'UP', engagedDwellSec: 30, isActive: true });
    const sections = [];
    for (const s of SECTIONS) {
      const z = await zr.save({ storeId: store.id, cameraId: floors[s.cam].id, name: s.name, type: 'SECTION', polygon: rect(s.center[0], s.center[1], 0.34, 0.4), engagedDwellSec: s.name === 'Trial Rooms' ? 60 : 30, isActive: true });
      sections.push({ zone: z, def: s });
    }
    const queues = [
      await zr.save({ storeId: store.id, cameraId: billing.id, name: 'Billing Counter 1', type: 'QUEUE', polygon: rect(0.3, 0.5, 0.3, 0.6), engagedDwellSec: 30, queueAlertLength: 6, queueAlertWaitSec: 300, isActive: true }),
      await zr.save({ storeId: store.id, cameraId: billing.id, name: 'Billing Counter 2', type: 'QUEUE', polygon: rect(0.7, 0.5, 0.3, 0.6), engagedDwellSec: 30, queueAlertLength: 6, queueAlertWaitSec: 300, isActive: true }),
    ];
    const staffArea = await zr.save({ storeId: store.id, cameraId: billing.id, name: 'Cash Desk Staff Area', type: 'STAFF_ONLY', polygon: rect(0.5, 0.12, 0.8, 0.2), engagedDwellSec: 30, isActive: true });
    const key = devKeyFor(store.id);
    await ds.getRepository(EdgeDevice).save({ storeId: store.id, name: `Edge box ${def.short}`, apiKeyHash: hashKey(key), apiKeyPrefix: keyPrefix(key), version: '1.4.2', lastSeenAt: null });
    const staff: Staff[] = [];
    for (let i = 0; i < 8; i++) {
      const designation = DESIGNATIONS[i];
      const early = i % 2 === 0;
      staff.push(await ds.getRepository(Staff).save({
        storeId: store.id, code: `${def.short}-S${String(i + 1).padStart(2, '0')}`, name: STAFF_NAMES[staffIdx++ % STAFF_NAMES.length], designation,
        shiftStart: early ? '09:30' : '12:30', shiftEnd: early ? '18:30' : '21:45', isActive: true,
      }));
    }
    out.push({ id: store.id, def, tz: 'Asia/Kolkata', entrance, floors, billing, entryLine, sections, queues, staffArea, staff });
  }
  void rng;
  return out;
}

export async function runSeed(ds: DataSource, opts: SeedOptions = {}) {
  const log = opts.log ?? ((m: string) => console.log(m));
  const days = opts.days ?? 90;
  const t0 = Date.now();
  let empty = true;
  try {
    empty = (await ds.getRepository(Store).count()) === 0;
  } catch {
    empty = true;
  }
  if (!opts.reset && !empty) {
    log('Database already contains data — skipping (set SEED_RESET=true to drop and recreate).');
    return false;
  }
  log(`Resetting schema (${ds.options.type})…`);
  await ds.synchronize(true);
  const rng = new Rng(20261005);
  const now = new Date();
  const tz = 'Asia/Kolkata';
  const today = todayLocal(tz);
  const nowLocal = localParts(now, tz);

  // aiServiceUrl is left to the AI_SERVICE_URL env default (docker / local differ)
  await ds.getRepository(Setting).save(Object.entries(DEFAULT_SETTINGS).filter(([key]) => key !== 'aiServiceUrl').map(([key, value]) => ({ key, value: String(value) })));
  const stores = await seedMasterData(ds, rng);
  log(`Master data: ${stores.length} stores, ${stores.length * 5} cameras, ${stores.length * 11} zones, edge keys dev-edge-key-store-<id>`);

  const all = stores.map((s) => s.id);
  const chennai = stores.filter((s) => s.def.region === 'Chennai').map((s) => s.id);
  const specs: SeedUserSpec[] = [
    ...contractUsers(all, chennai, stores[0].id),
    { email: 'ops.admin@congruence.in', name: 'Sowmya Iyer (Ops Admin)', role: Role.ADMIN, storeIds: [] },
    ...stores.slice(1).map((s) => ({ email: s.def.managerEmail, name: s.def.managerName, role: Role.STORE_MANAGER, storeIds: [s.id] })),
  ];
  const users = await insertUsers(ds, specs);
  const people: PeopleIds = {
    admin: users.get('admin@congruence.in'),
    regional: users.get('regional@congruence.in'),
    auditor: users.get('auditor@congruence.in'),
    staffTnagar: users.get('staff.tnagar@congruence.in'),
    managers: new Map(stores.map((s) => [s.id, users.get(s.def.managerEmail)])),
  };
  log(`Users: ${specs.length} (password Password@123)`);

  log(`History: ${days} days of hourly rollups + POS…`);
  const pos = await seedHistory(ds, stores, today, days, rng, log);
  const pools = await seedLoyalVisits(ds, stores, today, rng);
  const hm = await seedHeatmaps(ds, stores, today, nowLocal.hour, 14, rng);
  const so = await seedStoreOps(ds, stores, today, nowLocal.hour * 60 + nowLocal.minute, days, rng);
  const cs = await seedCameraStatus(ds, stores, today, now, days, rng);
  log(`History done: ${pos} POS bills, ${hm} heatmap frames, ${so} store-ops events, ${cs.rows} camera status intervals (offline now: ${cs.offlineCamera.name})`);

  log("Today's raw edge data through the pipeline…");
  await seedToday(ds, stores, today, now, pools, { ...DEFAULT_SETTINGS }, rng, log);

  const alerts = await seedAlerts(ds, stores, people, now, cs.offlineCamera, rng);
  const ck = await seedChecklists(ds, stores, people, today, now, rng);
  const tt = await seedTasksTickets(ds, stores, people, now, alerts, rng);
  const vv = await seedVendors(ds, stores, people, now, rng);
  const docs = await seedDocuments(ds, stores, people);
  await seedSchedules(ds, stores, people);

  log('v2: snapshots, SHELF zones, AI Manager, Trax v2, recap…');
  const shelves = await seedMedia(ds, stores, today, now, rng, log);
  await seedAiManager(ds, stores, people, today, now, shelves, rng, log);
  await seedTraxV2(ds, stores, people, today, now, ck, rng, log);
  await seedInfra(ds, stores, people, now);
  const recap = await seedRecap(ds, stores, today, log);
  log('v3: recorders, connection tests, discovered devices…');
  await seedRecorders(ds, stores, now, log);
  if (recap.filePath) fs.copyFileSync(path.join(uploadDir(), recap.filePath), path.join(uploadDir(), 'files', 'seed-walkthrough.mp4'));
  log(`Trax: ${ck.templates} templates, ${ck.assignments} assignments, ${ck.submissions} submissions; ${tt.tasks} tasks, ${tt.tickets} tickets; ${vv.vendors} vendors, ${vv.visits} visits; ${docs} documents; ${alerts.length} alerts`);
  log(`Seed completed in ${((Date.now() - t0) / 1000).toFixed(1)}s (today = ${today}).`);
  return true;
}

async function main() {
  const ds = new DataSource({ ...databaseOptions(), synchronize: false });
  await ds.initialize();
  try {
    await runSeed(ds, { reset: process.env.SEED_RESET === 'true', days: parseInt(process.env.SEED_DAYS || '90', 10) });
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
