import { Injectable, Logger } from '@nestjs/common';
import { DataSource, In, IsNull, MoreThanOrEqual } from 'typeorm';
import { EventBusService } from '../../common/event-bus.service';
import { toDate } from '../../common/db-types';
import { ADMINS, Role } from '../../common/roles';
import { localParts, minutesOfDay, round, zonedToUtc } from '../../common/time.util';
import { addDays } from '../../common/time.util';
import { HourlyStoreMetric } from '../analytics/entities/hourly-store-metric.entity';
import { Visit } from '../analytics/entities/visit.entity';
import { CameraStatusLog } from '../cameras/entities/camera-status-log.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { QueueSnapshot } from '../ingest/entities/queue-snapshot.entity';
import { StoreOpsEvent } from '../ingest/entities/storeops-event.entity';
import { VisitorEvent } from '../ingest/entities/visitor-event.entity';
import { Store } from '../stores/entities/store.entity';
import { UserStore } from '../users/entities/user-store.entity';
import { User } from '../users/entities/user.entity';
import { Zone } from '../zones/entities/zone.entity';
import { SettingsService } from '../settings/settings.service';
import { AlertsService } from './alerts.service';
import { AlertRule } from './entities/alert-rule.entity';
import { Alert } from './entities/alert.entity';
import { Notification } from './entities/notification.entity';
import { NotifierService } from './notifier.service';
import { ChecklistAssignment } from '../checklists/entities/checklist-assignment.entity';
import { ChecklistSubmission } from '../checklists/entities/checklist-submission.entity';
import { EdgeDevice } from '../edge-devices/entities/edge-device.entity';
import { AiDetection } from '../ai-manager/entities/ai-detection.entity';
import { TicketsService } from '../tickets/tickets.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { PRIORITY_BY_SEVERITY_MAP, TICKET_CATEGORY_BY_METRIC } from './alerts.service';

/** Minimal rule shape used by raise(); AI Manager breaches pass an implicit rule (id null). */
export interface RaiseRule {
  id: number | null;
  name: string;
  metric: string;
  severity: string;
  channels: string[];
  emails?: string | null;
  webhookUrl?: string | null;
  autoTicket?: boolean;
}

interface Hit {
  value: number;
  message: string;
}
const ONCE_PER_DAY = ['STORE_OPEN_LATE', 'STORE_CLOSE_EARLY'];
const MIN_BASELINE = 20;

/** Evaluates alert rules (after ingest and every minute) and fans out alerts. */
@Injectable()
export class AlertEngineService {
  private readonly log = new Logger(AlertEngineService.name);
  constructor(
    private readonly ds: DataSource,
    private readonly bus: EventBusService,
    private readonly notifier: NotifierService,
    private readonly settings: SettingsService,
    private readonly alerts: AlertsService,
    private readonly tickets: TicketsService,
  ) {}

  async evaluate(storeIds?: number[], now = new Date(), metrics?: string[]): Promise<number> {
    const rules = (await this.ds.getRepository(AlertRule).find({ where: { isActive: true } })).filter((r) => !metrics || metrics.includes(r.metric));
    if (!rules.length) return 0;
    const stores = await this.ds.getRepository(Store).find({ where: { isActive: true } });
    const target = storeIds ? stores.filter((s) => storeIds.includes(s.id)) : stores;
    let created = 0;
    for (const rule of rules) {
      for (const store of target) {
        if (rule.storeId && rule.storeId !== store.id) continue;
        try {
          const hit = await this.check(rule, store, now);
          if (!hit) continue;
          if (await this.inCooldown(rule, store, now)) continue;
          await this.raise(rule, store, hit, now);
          created++;
        } catch (e) {
          this.log.warn(`rule ${rule.id} store ${store.id}: ${(e as Error).message}`);
        }
      }
    }
    return created;
  }

  private async inCooldown(rule: AlertRule, store: Store, now: Date): Promise<boolean> {
    const repo = this.ds.getRepository(Alert);
    let since = new Date(now.getTime() - (rule.cooldownMin ?? 30) * 60000);
    if (ONCE_PER_DAY.includes(rule.metric)) {
      const day = zonedToUtc(localParts(now, store.timezone).date, '00:00', store.timezone);
      if (day < since) since = day;
    }
    return (await repo.count({ where: { ruleId: rule.id, storeId: store.id, createdAt: MoreThanOrEqual(since) } })) > 0;
  }

  async check(rule: AlertRule, store: Store, now: Date): Promise<Hit | null> {
    const t = rule.threshold;
    const tz = store.timezone;
    const local = localParts(now, tz);
    const nowMin = local.hour * 60 + local.minute;
    switch (rule.metric) {
      case 'QUEUE_LENGTH':
      case 'QUEUE_WAIT': {
        // every snapshot of the recent window counts (not only the newest per counter): batched uploads
        // (edge spool replay, back-filled simulator runs) would otherwise hide breaches inside the batch
        const recent = await this.recentQueues(store.id, now);
        if (!recent.length) return null;
        const key = rule.metric === 'QUEUE_LENGTH' ? 'queueLength' : 'avgWaitSec';
        const worst = recent.reduce((a, b) => (b[key] > a[key] ? b : a));
        if (!(worst[key] > t)) return null;
        return rule.metric === 'QUEUE_LENGTH'
          ? { value: worst.queueLength, message: `Queue at ${worst.name} is ${worst.queueLength} people (threshold ${t}) at ${store.name}` }
          : { value: round(worst.avgWaitSec, 0), message: `Wait time at ${worst.name} is ${Math.round(worst.avgWaitSec)}s (threshold ${t}s) at ${store.name}` };
      }
      case 'CAMERA_OFFLINE': {
        const cams = await this.ds.getRepository(Camera).find({ where: { storeId: store.id, isActive: true, status: 'OFFLINE' } });
        if (!cams.length) return null;
        const logs = await this.ds.getRepository(CameraStatusLog).find({ where: { cameraId: In(cams.map((c) => c.id)), endedAt: IsNull() } });
        const offline = cams
          .map((c) => {
            const since = logs.find((l) => l.cameraId === c.id && l.status === 'OFFLINE')?.startedAt ?? c.lastHeartbeatAt ?? now;
            return { c, min: (now.getTime() - since.getTime()) / 60000 };
          })
          .filter((x) => x.min > t);
        if (!offline.length) return null;
        const max = Math.max(...offline.map((x) => x.min));
        return { value: Math.round(max), message: `${offline.length} camera(s) offline at ${store.name}: ${offline.map((x) => `${x.c.name} (${Math.round(x.min)} min)`).join(', ')}` };
      }
      case 'STORE_OPEN_LATE': {
        const sched = minutesOfDay(store.openTime);
        const ev = await this.ds.getRepository(StoreOpsEvent).findOne({ where: { storeId: store.id, date: local.date, type: 'STORE_OPENED' }, order: { ts: 'ASC' } });
        let late: number;
        if (ev) {
          const p = localParts(ev.ts, tz);
          late = p.hour * 60 + p.minute - sched;
        } else {
          if (nowMin >= minutesOfDay(store.closeTime)) return null;
          late = nowMin - sched;
        }
        if (!(late > t)) return null;
        return { value: late, message: ev ? `${store.name} opened ${late} min late (scheduled ${store.openTime})` : `${store.name} not opened yet, ${late} min past ${store.openTime}` };
      }
      case 'STORE_CLOSE_EARLY': {
        const ev = await this.ds.getRepository(StoreOpsEvent).findOne({ where: { storeId: store.id, date: local.date, type: 'STORE_CLOSED' }, order: { ts: 'DESC' } });
        if (!ev) return null;
        const p = localParts(ev.ts, tz);
        const early = minutesOfDay(store.closeTime) - (p.hour * 60 + p.minute);
        if (!(early > t)) return null;
        return { value: early, message: `${store.name} closed ${early} min early (scheduled ${store.closeTime})` };
      }
      case 'FOOTFALL_DROP':
      case 'CONVERSION_DROP': {
        if (local.hour === 0) return null;
        const [cur, prev] = await Promise.all([this.sumHours(store.id, local.date, local.hour), this.sumHours(store.id, addDays(local.date, -7), local.hour)]);
        if (rule.metric === 'FOOTFALL_DROP') {
          if (prev.footfall < MIN_BASELINE) return null;
          const drop = ((prev.footfall - cur.footfall) / prev.footfall) * 100;
          if (!(drop > t)) return null;
          return { value: round(drop, 1), message: `Footfall at ${store.name} is down ${round(drop, 1)}% vs same hours last ${weekday(local.dow)} (${cur.footfall} vs ${prev.footfall})` };
        }
        if (prev.billable < MIN_BASELINE || prev.transactions === 0) return null;
        const pc = (prev.transactions / prev.billable) * 100;
        const cc = cur.billable > 0 ? (cur.transactions / cur.billable) * 100 : 0;
        const drop = ((pc - cc) / pc) * 100;
        if (!(drop > t)) return null;
        return { value: round(drop, 1), message: `Conversion at ${store.name} is down ${round(drop, 1)}% (${round(cc, 1)}% vs ${round(pc, 1)}% last week)` };
      }
      case 'SOP_BREACH':
      case 'COUNTER_UNATTENDED': {
        const since = new Date(now.getTime() - 15 * 60000);
        const count = await this.ds.getRepository(StoreOpsEvent).count({ where: { storeId: store.id, type: rule.metric, ts: MoreThanOrEqual(since) } });
        if (count < Math.max(1, t)) return null;
        const label = rule.metric === 'SOP_BREACH' ? 'SOP breach' : 'Counter unattended';
        return { value: count, message: `${label}: ${count} event(s) in the last 15 min at ${store.name}` };
      }
      case 'STAFF_SHORTAGE': {
        if (nowMin < minutesOfDay(store.openTime) + 30 || nowMin >= minutesOfDay(store.closeTime)) return null;
        const live = await this.ds.getRepository(VisitorEvent).count({ where: { storeId: store.id, date: local.date } });
        if (!live) return null;
        const present = await this.ds.getRepository(Visit).count({ where: { storeId: store.id, date: local.date, isStaff: true, exitTs: IsNull() } });
        if (!(present < t)) return null;
        return { value: present, message: `Only ${present} staff present at ${store.name} (minimum ${t})` };
      }
      case 'CHECKLIST_OVERDUE': {
        const since = new Date(now.getTime() - 24 * 3600_000);
        const rows = await this.ds
          .getRepository(ChecklistAssignment)
          .createQueryBuilder('a')
          .where('a.storeId = :s AND a.status = :st', { s: store.id, st: 'OVERDUE' })
          .andWhere('a.dueAt >= :since AND a.dueAt <= :now', { since, now })
          .getCount();
        if (rows < Math.max(1, t)) return null;
        return { value: rows, message: `${rows} checklist(s) overdue at ${store.name}` };
      }
      case 'CHECKLIST_NON_COMPLIANCE': {
        const since = new Date(now.getTime() - 15 * 60000);
        const sub = await this.ds
          .getRepository(ChecklistSubmission)
          .createQueryBuilder('s')
          .where('s.storeId = :s AND s.submittedAt >= :since AND s.flags > 0', { s: store.id, since })
          .orderBy('s.flags', 'DESC')
          .getOne();
        if (!sub || sub.flags < Math.max(1, t)) return null;
        return { value: sub.flags, message: `Checklist submission #${sub.id} at ${store.name} has ${sub.flags} flagged answer(s)` };
      }
      case 'AI_MANAGER_BREACH': {
        const since = new Date(now.getTime() - 15 * 60000);
        const count = await this.ds.getRepository(AiDetection).count({ where: { storeId: store.id, status: 'BREACHED', ts: MoreThanOrEqual(since) } });
        if (count < Math.max(1, t)) return null;
        return { value: count, message: `AI Manager: ${count} breach(es) in the last 15 min at ${store.name}` };
      }
      case 'EDGE_OFFLINE': {
        const devs = await this.ds.getRepository(EdgeDevice).find({ where: { storeId: store.id } });
        const seen = devs.filter((d) => d.lastSeenAt).sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())[0];
        if (!seen) return null;
        const min = (now.getTime() - seen.lastSeenAt.getTime()) / 60000;
        if (!(min > t)) return null;
        return { value: Math.round(min), message: `Edge device "${seen.name}" at ${store.name} offline for ${Math.round(min)} min` };
      }
      default:
        return null;
    }
  }

  /** Queue snapshots of the last 10 minutes, newest first, with the zone name. */
  private async recentQueues(storeId: number, now: Date) {
    const since = new Date(now.getTime() - 10 * 60000);
    const rows = await this.ds.getRepository(QueueSnapshot).find({ where: { storeId, ts: MoreThanOrEqual(since) }, order: { ts: 'DESC' }, take: 500 });
    const zones = new Map((await this.ds.getRepository(Zone).find({ where: { storeId } })).map((z) => [z.id, z.name]));
    return rows.map((r) => Object.assign(r, { name: zones.get(r.zoneId) ?? `Zone ${r.zoneId}` }));
  }

  private async sumHours(storeId: number, date: string, beforeHour: number) {
    const r = await this.ds
      .getRepository(HourlyStoreMetric)
      .createQueryBuilder('m')
      .select('SUM(m.footfallIn)', 'footfall')
      .addSelect('SUM(m.billableEntities)', 'billable')
      .addSelect('SUM(m.transactions)', 'transactions')
      .where('m.storeId = :storeId AND m.date = :date AND m.hour < :h', { storeId, date, h: beforeHour })
      .getRawOne<{ footfall: unknown; billable: unknown; transactions: unknown }>();
    return { footfall: Number(r?.footfall ?? 0), billable: Number(r?.billable ?? 0), transactions: Number(r?.transactions ?? 0) };
  }

  /** Persists an alert and fans out: in-app notifications, SSE, email, webhook. */
  async raise(rule: RaiseRule | AlertRule, store: Store, hit: Hit, now = new Date(), opts: { notificationTitle?: string } = {}): Promise<Alert> {
    const alert = await this.ds.getRepository(Alert).save(
      this.ds.getRepository(Alert).create({
        ruleId: rule.id,
        ruleName: rule.name,
        storeId: store.id,
        metric: rule.metric,
        severity: rule.severity,
        message: hit.message.slice(0, 1000),
        value: hit.value,
        status: 'OPEN',
        createdAt: now,
      }),
    );
    const view = (await this.alerts.views([alert]))[0];
    this.bus.emit({ type: 'alert', storeId: store.id, data: view });
    const recipients = await this.recipients(store.id);
    const channels = rule.channels ?? [];
    if (channels.includes('IN_APP') && recipients.length) {
      const title = opts.notificationTitle ?? `[${rule.severity}] ${rule.name}`;
      const rows = recipients.map((u) => ({ userId: u.id, title: title.slice(0, 200), body: hit.message.slice(0, 1000), link: `/alerts/${alert.id}`, isRead: false }));
      await this.ds.getRepository(Notification).insert(rows);
      const saved = await this.ds.getRepository(Notification).find({ where: { userId: In(recipients.map((u) => u.id)), link: `/alerts/${alert.id}` } });
      for (const n of saved) {
        this.bus.emit({
          type: 'notification',
          userId: n.userId,
          storeId: store.id,
          data: { id: n.id, title: n.title, body: n.body, link: n.link, isRead: n.isRead, createdAt: n.createdAt?.toISOString?.() ?? toDate(n.createdAt)?.toISOString() },
        });
      }
    }
    if (channels.includes('EMAIL')) {
      const s = await this.settings.get();
      if (s.alertEmailEnabled || rule.emails) {
        const to = rule.emails ? rule.emails.split(/[,;\s]+/) : recipients.map((u) => u.email);
        void this.notifier.sendMail(to, `[Congruence Eye] ${rule.severity}: ${rule.name} — ${store.name}`, `${hit.message}\n\nValue: ${hit.value}\nTime: ${now.toISOString()}`);
      }
    }
    if (channels.includes('WEBHOOK') && rule.webhookUrl) this.notifier.webhook(rule.webhookUrl, { event: 'alert', alert: view });
    if (rule.autoTicket) {
      try {
        const system = await this.systemUser();
        const category = TICKET_CATEGORY_BY_METRIC[rule.metric] ?? 'OTHER';
        const title = `${rule.name} — ${store.name}`.slice(0, 200);
        // re-use the open ticket for the same issue instead of opening one per alert
        const open = await this.ds.getRepository(Ticket).findOne({ where: { storeId: store.id, category, title, status: In(['OPEN', 'IN_PROGRESS', 'REOPENED']) } });
        if (open) {
          alert.ticketId = open.id;
          await this.ds.getRepository(Alert).update(alert.id, { ticketId: open.id });
        } else if (system) {
          const t = await this.tickets.create(
            system,
            {
              title,
              description: `Auto-created from alert #${alert.id}: ${hit.message}`,
              storeId: store.id,
              category,
              priority: PRIORITY_BY_SEVERITY_MAP(rule.severity),
            },
            alert.id,
          );
          alert.ticketId = t.id as number;
          await this.ds.getRepository(Alert).update(alert.id, { ticketId: alert.ticketId });
        }
      } catch (e) {
        this.log.warn(`auto ticket failed: ${(e as Error).message}`);
      }
    }
    return alert;
  }

  private async systemUser() {
    const u = await this.ds.getRepository(User).findOne({ where: { role: In([Role.SUPER_ADMIN, Role.ADMIN]), isActive: true }, order: { id: 'ASC' } });
    return u ? { id: u.id, email: u.email, name: u.name, role: Role.SUPER_ADMIN, storeIds: [] as number[] } : null;
  }

  /** Users to notify for a store: admins + regional/store managers assigned to it. */
  async recipients(storeId: number): Promise<User[]> {
    const users = await this.ds.getRepository(User).find({ where: { isActive: true } });
    const links = await this.ds.getRepository(UserStore).find({ where: { storeId } });
    const linked = new Set(links.map((l) => l.userId));
    return users.filter(
      (u) => ADMINS.includes(u.role as Role) || ((u.role === Role.REGIONAL_MANAGER || u.role === Role.STORE_MANAGER) && linked.has(u.id)),
    );
  }
}

const weekday = (d: number) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d];
