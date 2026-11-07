import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { toIso } from '../../common/db-types';
import { addDays, localStamp, todayLocal } from '../../common/time.util';
import { CAMERA_STALE_SEC } from '../cameras/camera-status.service';
import { EdgeDevice } from '../edge-devices/entities/edge-device.entity';
import { Store } from '../stores/entities/store.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { AnalyticsService } from './analytics.service';

export const INFRA_CATEGORIES = ['CAMERA', 'NETWORK', 'INFRASTRUCTURE'];
const OPEN_TICKET = ['OPEN', 'IN_PROGRESS', 'REOPENED'];

/** Infra health: edge box + camera status + 7-day uptime + open infra tickets per store. */
@Injectable()
export class InfraService {
  constructor(
    private readonly ds: DataSource,
    private readonly analytics: AnalyticsService,
  ) {}

  async health(ids: number[], now = new Date()) {
    const stores = ids.length ? await this.ds.getRepository(Store).find({ where: { id: In(ids) }, order: { id: 'ASC' } }) : [];
    const devices = ids.length ? await this.ds.getRepository(EdgeDevice).find({ where: { storeId: In(ids) } }) : [];
    const today = todayLocal();
    const cams = await this.analytics.cameraHealth(ids, { from: addDays(today, -6), to: today }, now);
    const tickets = ids.length ? await this.ds.getRepository(Ticket).find({ where: { storeId: In(ids), category: In(INFRA_CATEGORIES), status: In(OPEN_TICKET) } }) : [];
    const staleMs = CAMERA_STALE_SEC() * 1000;
    const audits = await this.analytics.countAudits(ids);
    const rows = stores.map((s) => {
      const devs = devices.filter((d) => d.storeId === s.id);
      const seen = devs.filter((d) => d.lastSeenAt).sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())[0];
      const edgeStatus: 'ONLINE' | 'OFFLINE' | 'NEVER' = !seen ? 'NEVER' : staleMs > 0 && now.getTime() - seen.lastSeenAt.getTime() > staleMs ? 'OFFLINE' : 'ONLINE';
      const sc = cams.filter((c) => c.storeId === s.id);
      const online = sc.filter((c) => c.status === 'ONLINE').length;
      // no cameras → no uptime to report (null, shown as "--"), not 100 %
      const uptime: number | null = sc.length ? Math.round((sc.reduce((a, c) => a + c.uptimePct, 0) / sc.length) * 100) / 100 : null;
      const issues: string[] = [];
      if (edgeStatus === 'OFFLINE') issues.push(`Edge device offline since ${localStamp(seen.lastSeenAt, s.timezone)}`); // store-local, never raw ISO
      if (edgeStatus === 'NEVER') issues.push('Edge device has never reported');
      for (const c of sc.filter((x) => x.status !== 'ONLINE')) issues.push(`Camera "${c.name}" is ${c.status}`);
      if (uptime !== null && uptime < 95) issues.push(`7-day camera uptime ${uptime}% is below 95%`);
      const health: 'GOOD' | 'DEGRADED' | 'DOWN' = edgeStatus === 'OFFLINE' || online === 0 ? 'DOWN' : online < sc.length || (uptime !== null && uptime < 95) ? 'DEGRADED' : 'GOOD';
      const openTickets = tickets.filter((t) => t.storeId === s.id).length;
      const audit = audits.get(s.id) ?? null;
      if (audit?.accuracyInPct != null && audit.accuracyInPct < 95) issues.push(`Counting accuracy ${audit.accuracyInPct}% is below 95% (last manual audit)`);
      return {
        storeId: s.id,
        storeName: s.name,
        edgeStatus,
        edgeLastSeenAt: toIso(seen?.lastSeenAt ?? null),
        edgeVersion: (seen ?? devs[0])?.version ?? null,
        camerasOnline: online,
        camerasTotal: sc.length,
        uptimePct7d: uptime,
        countAccuracyPct: audit?.accuracyInPct ?? null,
        countAudit: audit,
        health,
        openTickets,
        issues,
      };
    });
    return {
      totals: {
        stores: rows.length,
        healthy: rows.filter((r) => r.health === 'GOOD').length,
        degraded: rows.filter((r) => r.health === 'DEGRADED').length,
        down: rows.filter((r) => r.health === 'DOWN').length,
        camerasOnline: rows.reduce((a, r) => a + r.camerasOnline, 0),
        camerasTotal: rows.reduce((a, r) => a + r.camerasTotal, 0),
        openInfraTickets: tickets.length,
      },
      stores: rows,
    };
  }
}
