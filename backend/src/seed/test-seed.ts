import { DataSource } from 'typeorm';
import { Camera } from '../modules/cameras/entities/camera.entity';
import { EdgeDevice } from '../modules/edge-devices/entities/edge-device.entity';
import { devKeyFor, hashKey, keyPrefix } from '../modules/edge-devices/edge-devices.service';
import { Region } from '../modules/regions/entities/region.entity';
import { Store } from '../modules/stores/entities/store.entity';
import { Zone } from '../modules/zones/entities/zone.entity';
import { contractUsers, insertUsers } from './users.seed';

export interface TestSeed {
  regions: { chennai: number; coimbatore: number };
  stores: { tnagar: number; annanagar: number; coimbatore: number };
  cameras: { entrance: number; floor: number; billing: number; entrance2: number };
  zones: { entry: number; mens: number; womens: number; footwear: number; queue1: number; staffArea: number };
  users: Map<string, number>;
  keys: { tnagar: string; annanagar: string };
}

/** Minimal deterministic data for e2e tests (no history). */
export async function testSeed(ds: DataSource): Promise<TestSeed> {
  const regions = ds.getRepository(Region);
  const chennai = await regions.save({ name: 'Chennai' });
  const cbe = await regions.save({ name: 'Coimbatore' });
  const stores = ds.getRepository(Store);
  const mk = (code: string, name: string, regionId: number, city: string) =>
    stores.save({ code, name, regionId, city, address: `${name}, ${city}`, timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '21:30', areaSqft: 5000, isActive: true, latitude: 13.04, longitude: 80.23 });
  const s1 = await mk('CNG-TNR', 'Congruence T Nagar', chennai.id, 'Chennai');
  const s2 = await mk('CNG-ANN', 'Congruence Anna Nagar', chennai.id, 'Chennai');
  const s3 = await mk('CNG-CBE', 'Congruence RS Puram', cbe.id, 'Coimbatore');
  const cams = ds.getRepository(Camera);
  const cam = (storeId: number, name: string, type: string) => cams.save({ storeId, name, type, rtspUrl: `rtsp://10.0.${storeId}.10/${name.replace(/\s/g, '')}`, status: 'UNKNOWN', isActive: true });
  const entrance = await cam(s1.id, 'Entrance', 'ENTRANCE');
  const floor = await cam(s1.id, 'Floor 1', 'ZONE');
  const billing = await cam(s1.id, 'Billing', 'BILLING');
  const entrance2 = await cam(s2.id, 'Entrance', 'ENTRANCE');
  const zones = ds.getRepository(Zone);
  const z = (cameraId: number, name: string, type: string, extra: Partial<Zone> = {}) =>
    zones.save({
      storeId: s1.id, cameraId, name, type, isActive: true, engagedDwellSec: 30,
      polygon: type === 'ENTRY_LINE' ? [[0.1, 0.8], [0.9, 0.8]] : [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]],
      inDirection: type === 'ENTRY_LINE' ? 'UP' : null, ...extra,
    } as Partial<Zone>);
  const entry = await z(entrance.id, 'Main Door', 'ENTRY_LINE');
  const mens = await z(floor.id, "Men's Wear", 'SECTION');
  const womens = await z(floor.id, "Women's Wear", 'SECTION');
  const footwear = await z(floor.id, 'Footwear', 'SECTION', { engagedDwellSec: 60 });
  const queue1 = await z(billing.id, 'Billing Counter 1', 'QUEUE', { queueAlertLength: 6, queueAlertWaitSec: 300 });
  const staffArea = await z(billing.id, 'Cash Desk Staff Area', 'STAFF_ONLY');
  const devices = ds.getRepository(EdgeDevice);
  for (const s of [s1, s2]) {
    const key = devKeyFor(s.id);
    await devices.save({ storeId: s.id, name: `Edge ${s.code}`, apiKeyHash: hashKey(key), apiKeyPrefix: keyPrefix(key), version: '1.0.0' });
  }
  const users = await insertUsers(ds, contractUsers([s1.id, s2.id, s3.id], [s1.id, s2.id], s1.id));
  return {
    regions: { chennai: chennai.id, coimbatore: cbe.id },
    stores: { tnagar: s1.id, annanagar: s2.id, coimbatore: s3.id },
    cameras: { entrance: entrance.id, floor: floor.id, billing: billing.id, entrance2: entrance2.id },
    zones: { entry: entry.id, mens: mens.id, womens: womens.id, footwear: footwear.id, queue1: queue1.id, staffArea: staffArea.id },
    users,
    keys: { tnagar: devKeyFor(s1.id), annanagar: devKeyFor(s2.id) },
  };
}
