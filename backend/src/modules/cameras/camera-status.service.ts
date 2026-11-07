import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, LessThan, Not } from 'typeorm';
import { EdgeDevice } from '../edge-devices/entities/edge-device.entity';
import { Camera } from './entities/camera.entity';
import { CameraStatusLog } from './entities/camera-status-log.entity';

export const CAMERA_STALE_SEC = () => parseInt(process.env.CAMERA_STALE_SEC || '180', 10);

/** Tracks ONLINE/OFFLINE transitions in camera_status_log (used for uptime / downtime). */
@Injectable()
export class CameraStatusService {
  constructor(private readonly ds: DataSource) {}

  async apply(camera: Camera, status: 'ONLINE' | 'OFFLINE', at: Date, opts: { fps?: number; reason?: string } = {}): Promise<boolean> {
    const logs = this.ds.getRepository(CameraStatusLog);
    const open = await logs.findOne({ where: { cameraId: camera.id, endedAt: IsNull() }, order: { startedAt: 'DESC' } });
    let changed = false;
    if (!open || open.status !== status) {
      if (open) await logs.update(open.id, { endedAt: at });
      await logs.insert({ storeId: camera.storeId, cameraId: camera.id, status, startedAt: at, endedAt: null, reason: opts.reason?.slice(0, 300) ?? null });
      changed = camera.status !== status;
    }
    const patch: Partial<Camera> = { status };
    if (status === 'ONLINE') patch.lastHeartbeatAt = at;
    if (opts.fps !== undefined && opts.fps !== null) patch.fps = opts.fps;
    await this.ds.getRepository(Camera).update(camera.id, patch);
    Object.assign(camera, patch);
    return changed;
  }

  /**
   * Marks ONLINE cameras without a heartbeat for CAMERA_STALE_SEC as OFFLINE.
   * Only applies to stores whose edge device has reported at least once (lastSeenAt set),
   * so seeded/demo stores without a live edge box keep their recorded status. CAMERA_STALE_SEC=0 disables.
   */
  async markStale(now = new Date()): Promise<number[]> {
    if (CAMERA_STALE_SEC() <= 0) return [];
    const cutoff = new Date(now.getTime() - CAMERA_STALE_SEC() * 1000);
    const live = new Set((await this.ds.getRepository(EdgeDevice).find({ where: { lastSeenAt: Not(IsNull()) } })).map((d) => d.storeId));
    const stale = (await this.ds.getRepository(Camera).find({ where: { status: 'ONLINE', isActive: true, lastHeartbeatAt: LessThan(cutoff) } })).filter((c) => live.has(c.storeId));
    for (const c of stale) await this.apply(c, 'OFFLINE', c.lastHeartbeatAt ?? cutoff, { reason: 'Heartbeat timeout' });
    return [...new Set(stale.map((c) => c.storeId))];
  }
}
