import * as fs from 'fs';
import * as path from 'path';
import { DataSource, In } from 'typeorm';
import { bulkInsert } from '../common/bulk';
import { LookupService } from '../common/lookup.service';
import { addDays, hhmm, localParts, zonedToUtc } from '../common/time.util';
import { uploadDir } from '../config/database.config';
import { AiDetection } from '../modules/ai-manager/entities/ai-detection.entity';
import { AiManagerRule } from '../modules/ai-manager/entities/ai-manager-rule.entity';
import { AI_RULE_TYPES, DEFAULT_AI_PARAMS } from '../modules/ai-manager/ai-manager.views';
import { Alert } from '../modules/alerts/entities/alert.entity';
import { Notification } from '../modules/alerts/entities/notification.entity';
import { Camera } from '../modules/cameras/entities/camera.entity';
import { AiResult, ChecklistAnswer } from '../modules/checklists/entities/checklist-answer.entity';
import { ChecklistAssignment } from '../modules/checklists/entities/checklist-assignment.entity';
import { ChecklistQuestion } from '../modules/checklists/entities/checklist-question.entity';
import { ChecklistSchedule } from '../modules/checklists/entities/checklist-schedule.entity';
import { ChecklistSubmission } from '../modules/checklists/entities/checklist-submission.entity';
import { ChecklistTemplate } from '../modules/checklists/entities/checklist-template.entity';
import { EdgeDevice } from '../modules/edge-devices/entities/edge-device.entity';
import { StoreOpsEvent } from '../modules/ingest/entities/storeops-event.entity';
import { Snapshot } from '../modules/media/entities/snapshot.entity';
import { RecapsService } from '../modules/media/recaps.service';
import { SnapshotsService } from '../modules/media/snapshots.service';
import { Task } from '../modules/tasks/entities/task.entity';
import { slaDue, ticketNumber } from '../modules/tickets/tickets.service';
import { Ticket } from '../modules/tickets/entities/ticket.entity';
import { Zone } from '../modules/zones/entities/zone.entity';
import { openHours, SeedStore } from './model';
import { Rng } from './rng';
import { renderScene, SceneOptions } from './scene';
import { PeopleIds } from './trax';

const H = 3600_000;

/** Renders scenes with bounded concurrency. */
async function renderAll<T>(jobs: { opts: SceneOptions; meta: T }[], concurrency = 4): Promise<{ buf: Buffer; meta: T }[]> {
  const out: { buf: Buffer; meta: T }[] = new Array(jobs.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < jobs.length) {
        const k = i++;
        out[k] = { buf: await renderScene(jobs[k].opts), meta: jobs[k].meta };
      }
    }),
  );
  return out;
}

const viewOf = (c: Camera): SceneOptions['view'] => (c.type === 'ENTRANCE' ? 'ENTRANCE' : c.type === 'BILLING' ? 'BILLING' : 'ZONE');
const stamp = (d: Date, tz: string) => `${localParts(d, tz).date} ${hhmm(d, tz)}:${String(localParts(d, tz).second).padStart(2, '0')}`;

/**
 * Snapshot images (periodic, opening/closing linked to store-ops events, shelf references) and SHELF zones.
 */
export async function seedMedia(ds: DataSource, stores: SeedStore[], today: string, now: Date, rng: Rng, log: (m: string) => void) {
  const snaps = new SnapshotsService(ds);
  const yesterday = addDays(today, -1);
  const jobs: { opts: SceneOptions; meta: { store: SeedStore; cam: Camera; ts: Date; kind: string; eventId?: number } }[] = [];
  const nowLocal = localParts(now, stores[0].tz);
  for (const st of stores) {
    const cams = [st.entrance, ...st.floors, st.billing];
    const hours = openHours(st.def);
    // yesterday: every 15 min for T Nagar (recap), every 2 h elsewhere; today: hourly on entrance + ground floor
    const step = st.def.short === 'TNR' ? 15 : 120;
    for (let m = hours[0].startMin; m < hours[hours.length - 1].endMin; m += step) {
      for (const cam of cams) {
        const ts = new Date(zonedToUtc(yesterday, '00:00', st.tz).getTime() + (m + rng.between(0, 2)) * 60000);
        jobs.push({ opts: { title: `${st.def.name} · ${cam.name}`, ts: stamp(ts, st.tz), view: viewOf(cam), people: Math.round(rng.between(1, 9)), seed: rng.int(1, 1e6) }, meta: { store: st, cam, ts, kind: 'PERIODIC' } });
      }
    }
    for (const h of hours) {
      if (h.hour > nowLocal.hour) break;
      for (const cam of [st.entrance, st.floors[0]]) {
        const ts = new Date(zonedToUtc(today, '00:00', st.tz).getTime() + (h.startMin + rng.between(0, 5)) * 60000);
        if (ts > now) continue;
        jobs.push({ opts: { title: `${st.def.name} · ${cam.name}`, ts: stamp(ts, st.tz), view: viewOf(cam), people: Math.round(rng.between(1, 9)), seed: rng.int(1, 1e6) }, meta: { store: st, cam, ts, kind: 'PERIODIC' } });
      }
    }
  }
  // opening / closing snaps for the last 14 days, linked to the store-ops events
  const events = await ds
    .getRepository(StoreOpsEvent)
    .createQueryBuilder('e')
    .where('e.type IN (:...t)', { t: ['STORE_OPENED', 'STORE_CLOSED'] })
    .andWhere('e.date >= :from', { from: addDays(today, -13) })
    .getMany();
  for (const e of events) {
    const st = stores.find((s) => s.id === e.storeId);
    const opening = e.type === 'STORE_OPENED';
    jobs.push({
      opts: { title: `${st.def.name} · Entrance · ${opening ? 'OPENING' : 'CLOSING'}`, ts: stamp(e.ts, st.tz), view: 'ENTRANCE', people: opening ? 2 : 1, dark: !opening, seed: rng.int(1, 1e6) },
      meta: { store: st, cam: st.entrance, ts: e.ts, kind: opening ? 'OPENING' : 'CLOSING', eventId: e.id },
    });
  }
  const t0 = Date.now();
  const rendered = await renderAll(jobs);
  const links: [number, number][] = [];
  await ds.transaction(async (em) => {
    for (const r of rendered) {
      const s = await snaps.save({ storeId: r.meta.store.id, cameraId: r.meta.cam.id, buffer: r.buf, kind: r.meta.kind, ts: r.meta.ts, tz: r.meta.store.tz }, em);
      if (r.meta.eventId) links.push([r.meta.eventId, s.id]);
    }
    for (const [eventId, snapshotId] of links) await em.getRepository(StoreOpsEvent).update(eventId, { snapshotId });
  });
  // SHELF zones with a "full shelf" reference snapshot
  const shelves = new Map<number, Zone>();
  for (const st of stores) {
    const cam = st.floors[2];
    const ts = zonedToUtc(addDays(today, -20), '09:45', st.tz);
    const buf = await renderScene({ title: `${st.def.name} · ${cam.name} · REFERENCE`, ts: stamp(ts, st.tz), view: 'SHELF', emptyShelfPct: 3, seed: st.id });
    const ref = await snaps.save({ storeId: st.id, cameraId: cam.id, buffer: buf, kind: 'REFERENCE', ts, tz: st.tz });
    const z = await ds.getRepository(Zone).save({
      storeId: st.id, cameraId: cam.id, name: 'Accessories Wall Shelf', type: 'SHELF', engagedDwellSec: 30, isActive: true, referenceSnapshotId: ref.id,
      polygon: [[0.06, 0.1], [0.94, 0.1], [0.94, 0.86], [0.06, 0.86]],
    });
    shelves.set(st.id, z);
  }
  log(`  ${rendered.length + stores.length} snapshot images rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s (${links.length} linked to open/close events)`);
  return shelves;
}

/** READY recap for T Nagar yesterday (real ffmpeg H.264 build). */
export async function seedRecap(ds: DataSource, stores: SeedStore[], today: string, log: (m: string) => void) {
  const svc = new RecapsService(ds, new LookupService(ds));
  const r = await svc.generate(stores[0].id, addDays(today, -1));
  log(`  recap ${stores[0].def.code} ${r.date}: ${r.status} (${r.frameCount} frames, ${r.durationSec}s)${r.error ? ' ' + r.error : ''}`);
  return r;
}

const RULE_NAMES: Record<string, string> = {
  MOBILE_USAGE: 'Mobile phone usage on floor',
  UNATTENDED_CUSTOMER: 'Unattended customers',
  STORE_OPEN_CLOSE: 'Store open / close on time',
  HYGIENE_CLEANING: 'Morning cleaning & mopping',
  HUDDLE_MEETING: 'Morning huddle meeting',
  UNIFORM_COMPLIANCE: 'Staff uniform compliance',
  STOCK_OUT: 'Shelf stock-out',
  QUEUE_BREACH: 'Billing queue breach',
};
const DETAILS: Record<string, [string, string]> = {
  MOBILE_USAGE: ['Staff using mobile phone for {n} s near the counter', 'No mobile usage detected'],
  UNATTENDED_CUSTOMER: ['Customer unattended for {n} s', 'Customers attended within threshold'],
  STORE_OPEN_CLOSE: ['Store opened/closed outside the tolerance', 'Opened and closed on time'],
  HYGIENE_CLEANING: ['Only {n}% of the floor mopped before opening', 'Floor fully cleaned before opening'],
  HUDDLE_MEETING: ['No huddle detected (max {n} staff together)', 'Huddle held: 5 staff, 8 min'],
  UNIFORM_COMPLIANCE: ['Staff without uniform/name badge for {n} s', 'All staff in uniform'],
  STOCK_OUT: ['Shelf {n}% empty', 'Shelf adequately stocked'],
  QUEUE_BREACH: ['Queue of {n} customers at the billing counter', 'Queue within limit'],
};

/** 3 AI Manager rules per type across stores + ~30 days of detections (+ evidence snapshots, alerts, notifications). */
export async function seedAiManager(ds: DataSource, stores: SeedStore[], people: PeopleIds, today: string, now: Date, shelves: Map<number, Zone>, rng: Rng, log: (m: string) => void) {
  const groups = [stores.slice(0, 2), stores.slice(2, 4), stores.slice(4, 6)];
  const windows: Record<string, [string, string]> = { HUDDLE_MEETING: ['09:30', '10:15'], HYGIENE_CLEANING: ['09:00', '10:00'], STORE_OPEN_CLOSE: ['09:00', '23:00'] };
  const severities: Record<string, string> = { MOBILE_USAGE: 'MEDIUM', UNATTENDED_CUSTOMER: 'HIGH', STORE_OPEN_CLOSE: 'HIGH', HYGIENE_CLEANING: 'MEDIUM', HUDDLE_MEETING: 'LOW', UNIFORM_COMPLIANCE: 'MEDIUM', STOCK_OUT: 'HIGH', QUEUE_BREACH: 'HIGH' };
  const rules: AiManagerRule[] = [];
  for (const type of AI_RULE_TYPES) {
    for (const [gi, g] of groups.entries()) {
      const zoneIds =
        type === 'STOCK_OUT' ? g.map((s) => shelves.get(s.id).id)
        : type === 'QUEUE_BREACH' ? g.flatMap((s) => s.queues.map((q) => q.id))
        : type === 'MOBILE_USAGE' || type === 'UNATTENDED_CUSTOMER' ? g.flatMap((s) => s.sections.slice(0, 2).map((x) => x.zone.id))
        : [];
      const [ws, we] = windows[type] ?? ['10:00', '21:30'];
      rules.push(
        await ds.getRepository(AiManagerRule).save({
          name: `${RULE_NAMES[type]} — ${g.map((s) => s.def.short).join('/')}`, type, storeIds: g.map((s) => s.id), zoneIds, windowStart: ws, windowEnd: we,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6], params: { ...DEFAULT_AI_PARAMS[type], ...(type === 'QUEUE_BREACH' && gi === 1 ? { maxQueue: 6 } : {}) },
          severity: severities[type], notifyChannels: type === 'STOCK_OUT' || type === 'STORE_OPEN_CLOSE' ? ['IN_APP', 'EMAIL'] : ['IN_APP'], notifyEmails: null, isActive: true,
        }),
      );
    }
  }
  const breachP: Record<string, number> = { MOBILE_USAGE: 0.45, UNATTENDED_CUSTOMER: 0.35, HYGIENE_CLEANING: 0.15, HUDDLE_MEETING: 0.2, UNIFORM_COMPLIANCE: 0.25, STOCK_OUT: 0.3, QUEUE_BREACH: 0.4 };
  const opsEvents = await ds.getRepository(StoreOpsEvent).createQueryBuilder('e').where('e.type IN (:...t)', { t: ['STORE_OPENED', 'STORE_CLOSED'] }).andWhere('e.date >= :from', { from: addDays(today, -29) }).getMany();
  const nowLocal = localParts(now, stores[0].tz);
  const rows: { det: Partial<AiDetection>; render: boolean; store: SeedStore; rule: AiManagerRule }[] = [];
  for (const rule of rules) {
    for (const st of stores.filter((s) => rule.storeIds.includes(s.id))) {
      for (let d = 29; d >= 0; d--) {
        const date = addDays(today, -d);
        const at = (hm: string) => zonedToUtc(date, hm, st.tz);
        const push = (ts: Date, status: string, n: number, cam: Camera, zoneId: number | null) => {
          if (ts > now) return;
          const [b, c] = DETAILS[rule.type];
          rows.push({
            det: { ruleId: rule.id, type: rule.type, storeId: st.id, cameraId: cam.id, zoneId, ts, date, status, details: (status === 'BREACHED' ? b : c).replace('{n}', String(n)), confidence: Math.round(rng.between(0.72, 0.97) * 100) / 100, snapshotId: null, reviewStatus: d > 3 && status === 'BREACHED' && rng.chance(0.12) ? 'FALSE_POSITIVE' : d > 3 && status === 'BREACHED' && rng.chance(0.5) ? 'VALID' : null },
            render: true, // QA: every detection (breached or complied) carries its evidence snapshot
            store: st,
            rule,
          });
        };
        if (rule.type === 'STORE_OPEN_CLOSE') {
          const evs = opsEvents.filter((e) => e.storeId === st.id && e.date === date);
          const open = evs.find((e) => e.type === 'STORE_OPENED');
          if (!open) continue;
          const close = evs.find((e) => e.type === 'STORE_CLOSED');
          const late = /late/.test(open.details ?? '') || /early/.test(close?.details ?? '');
          push(close?.ts ?? open.ts, late ? 'BREACHED' : 'COMPLIED', 0, st.entrance, null);
        } else if (rule.type === 'HUDDLE_MEETING' || rule.type === 'HYGIENE_CLEANING') {
          if (d === 0 && nowLocal.hour < 11) continue;
          const breached = rng.chance(breachP[rule.type]);
          push(at(rule.type === 'HUDDLE_MEETING' ? '09:50' : '09:58'), breached ? 'BREACHED' : 'COMPLIED', rule.type === 'HUDDLE_MEETING' ? rng.int(1, 2) : rng.int(25, 55), st.floors[0], null);
        } else {
          const n = rng.int(1, 3);
          for (let k = 0; k < n; k++) {
            const breached = rng.chance(breachP[rule.type]);
            const hm = `${rng.int(11, 20)}:${String(rng.int(0, 59)).padStart(2, '0')}`;
            const zones = rule.zoneIds.filter((z) => [shelves.get(st.id)?.id, ...st.queues.map((q) => q.id), ...st.sections.map((s) => s.zone.id)].includes(z));
            const zoneId = zones.length ? rng.pick(zones) : null;
            const cam = rule.type === 'QUEUE_BREACH' ? st.billing : rule.type === 'STOCK_OUT' ? st.floors[2] : rng.pick(st.floors);
            const val = rule.type === 'STOCK_OUT' ? (breached ? rng.int(70, 95) : rng.int(5, 45)) : rule.type === 'QUEUE_BREACH' ? (breached ? rng.int(6, 11) : rng.int(1, 4)) : rng.int(25, 240);
            push(at(hm), breached ? 'BREACHED' : 'COMPLIED', val, cam, zoneId);
          }
        }
      }
    }
  }
  // evidence snapshot for every detection (~6 ms per frame)
  const snaps = new SnapshotsService(ds);
  const toRender = rows.filter((r) => r.render);
  const rendered = await renderAll(
    toRender.map((r) => ({
      opts: {
        title: `${r.store.def.name} · ${r.store.floors.concat(r.store.entrance, r.store.billing).find((c) => c.id === r.det.cameraId)?.name ?? ''}`,
        ts: stamp(r.det.ts, r.store.tz),
        view: r.rule.type === 'STOCK_OUT' ? 'SHELF' : r.rule.type === 'QUEUE_BREACH' ? 'BILLING' : r.rule.type === 'STORE_OPEN_CLOSE' ? 'ENTRANCE' : 'ZONE',
        people: r.rule.type === 'QUEUE_BREACH' ? rng.int(7, 11) : rng.int(2, 7),
        emptyShelfPct: r.rule.type === 'STOCK_OUT' ? 80 : undefined,
        badge: r.rule.type.replace(/_/g, ' '),
        seed: rng.int(1, 1e6),
      },
      meta: r,
    })),
  );
  await ds.transaction(async (em) => {
    for (const x of rendered) {
      const s = await snaps.save({ storeId: x.meta.store.id, cameraId: x.meta.det.cameraId, buffer: x.buf, kind: 'AI_MANAGER', ts: x.meta.det.ts, tz: x.meta.store.tz }, em);
      x.meta.det.snapshotId = s.id;
    }
    await bulkInsert(em, AiDetection, rows.map((r) => r.det));
  });
  // implicit AI_MANAGER_BREACH alerts + "breach detected" notifications for the last 2 days
  const recent = await ds.getRepository(AiDetection).createQueryBuilder('d').where('d.status = :s AND d.ts >= :since', { s: 'BREACHED', since: new Date(now.getTime() - 48 * H) }).orderBy('d.ts', 'ASC').getMany();
  const ruleMap = new Map(rules.map((r) => [r.id, r]));
  for (const d of recent) {
    const rule = ruleMap.get(d.ruleId);
    const st = stores.find((s) => s.id === d.storeId);
    const old = now.getTime() - d.ts.getTime() > 12 * H;
    const a = await ds.getRepository(Alert).save({
      ruleId: null, ruleName: rule.name, storeId: d.storeId, metric: 'AI_MANAGER_BREACH', severity: rule.severity, message: `${rule.name}: ${d.details} at ${st.def.name}`, value: d.confidence ?? 1,
      status: old ? 'RESOLVED' : 'OPEN', createdAt: d.ts, acknowledgedAt: old ? new Date(d.ts.getTime() + 20 * 60000) : null, acknowledgedById: old ? people.managers.get(d.storeId) : null,
      resolvedAt: old ? new Date(d.ts.getTime() + 60 * 60000) : null, resolvedById: old ? people.managers.get(d.storeId) : null,
    });
    await ds.getRepository(AiDetection).update(d.id, { alertId: a.id });
    const to = new Set([people.admin, people.managers.get(d.storeId)].filter(Boolean));
    await ds.getRepository(Notification).save([...to].map((userId) => ({ userId, title: `${rule.name} breach detected for store ${st.def.code}`.slice(0, 200), body: a.message.slice(0, 1000), link: `/ai-manager/detections?id=${d.id}`, isRead: old, createdAt: d.ts })));
  }
  log(`  AI Manager: ${rules.length} rules, ${rows.length} detections (${rows.filter((r) => r.det.status === 'BREACHED').length} breached, ${rendered.length} evidence snapshots), ${recent.length} breach alerts`);
  return rules;
}

/** Edge health story: Adyar edge box offline (→ store DOWN) with an auto infra ticket; others never connected. */
export async function seedInfra(ds: DataSource, stores: SeedStore[], people: PeopleIds, now: Date) {
  const ady = stores.find((s) => s.def.short === 'ADY');
  const lastSeen = new Date(now.getTime() - 150 * 60000);
  await ds.getRepository(EdgeDevice).update({ storeId: ady.id }, { lastSeenAt: lastSeen, version: '1.4.1' });
  const createdAt = new Date(now.getTime() - 130 * 60000);
  const alert = await ds.getRepository(Alert).save({ ruleId: null, ruleName: 'Edge box offline', storeId: ady.id, metric: 'EDGE_OFFLINE', severity: 'CRITICAL', message: `Edge device "Edge box ADY" at ${ady.def.name} offline for 20 min`, value: 20, status: 'ACKNOWLEDGED', createdAt, acknowledgedAt: new Date(createdAt.getTime() + 10 * 60000), acknowledgedById: people.managers.get(ady.id) });
  const t = await ds.getRepository(Ticket).save({ number: '', title: `Edge box offline — ${ady.def.name}`, description: `Auto-created from alert #${alert.id}: edge box stopped reporting; ISP router suspected.`, storeId: ady.id, category: 'NETWORK', priority: 'URGENT', status: 'IN_PROGRESS', assigneeId: people.managers.get(ady.id), reporterId: people.admin, alertId: alert.id, slaDueAt: slaDue(createdAt, 'URGENT'), resolvedAt: null, createdAt });
  await ds.getRepository(Ticket).update(t.id, { number: ticketNumber(t.id) });
  await ds.getRepository(Alert).update(alert.id, { ticketId: t.id });
}

/** Schedules, AI templates with scored AI results, drafts and deviation tasks. */
export async function seedTraxV2(ds: DataSource, stores: SeedStore[], people: PeopleIds, today: string, now: Date, ids: { openingTemplateId: number; vmTemplateId: number }, rng: Rng, log: (m: string) => void) {
  const chennai = stores.filter((s) => s.def.region === 'Chennai').map((s) => s.id);
  const [opening, vm] = await ds.getRepository(ChecklistSchedule).save([
    { templateId: ids.openingTemplateId, storeIds: chennai, assigneeId: null, frequency: 'DAILY', repeatEvery: 1, daysOfWeek: [], dayOfMonth: null, windowStart: '09:30', windowEnd: '10:30', startDate: addDays(today, -60), endDate: null, reminderMinutesBefore: 30, isActive: true, lastGeneratedDate: today, createdById: people.regional },
    { templateId: ids.vmTemplateId, storeIds: stores.map((s) => s.id), assigneeId: people.auditor, frequency: 'WEEKLY', repeatEvery: 1, daysOfWeek: [1], dayOfMonth: null, windowStart: '10:00', windowEnd: '18:00', startDate: addDays(today, -60), endDate: null, reminderMinutesBefore: 60, isActive: true, lastGeneratedDate: today, createdById: people.regional },
  ]);
  await ds.getRepository(ChecklistAssignment).update({ templateId: ids.openingTemplateId, storeId: In(chennai) }, { scheduleId: opening.id });
  await ds.getRepository(ChecklistAssignment).update({ templateId: ids.vmTemplateId }, { scheduleId: vm.id });
  // drafts: a couple of today's pending checklists are in progress
  const pending = await ds.getRepository(ChecklistAssignment).find({ where: { dueDate: today, status: 'PENDING' }, take: 3 });
  for (const a of pending.slice(0, 2)) {
    const q = await ds.getRepository(ChecklistQuestion).find({ where: { templateId: a.templateId }, order: { sortOrder: 'ASC' }, take: 3 });
    await ds.getRepository(ChecklistAssignment).update(a.id, { status: 'IN_PROGRESS', draftAnswers: q.filter((x) => x.type === 'YES_NO').map((x) => ({ questionId: x.id, value: 'YES', photoUrl: null as string | null, remark: null as string | null })) });
  }
  // AI-in-Checklist templates
  const files = path.join(uploadDir(), 'files');
  fs.mkdirSync(files, { recursive: true });
  const ref = await renderScene({ title: 'Approved artwork · Diwali 2026', ts: today, view: 'SIGNAGE', seed: 11 });
  fs.writeFileSync(path.join(files, 'reference-diwali-signage.jpg'), ref);
  const signagePhotos = [await renderScene({ title: 'Store signage', ts: today, view: 'SIGNAGE', seed: 12, people: 1 }), await renderScene({ title: 'Store signage', ts: today, view: 'ZONE', seed: 13, people: 3 })];
  signagePhotos.forEach((b, i) => fs.writeFileSync(path.join(files, `seed-signage-${i}.jpg`), b));
  const groom = [await renderScene({ title: 'Staff grooming', ts: today, view: 'UNIFORM', seed: 21 }), await renderScene({ title: 'Staff grooming', ts: today, view: 'UNIFORM', seed: 22, badge: 'NO NAME BADGE' })];
  groom.forEach((b, i) => fs.writeFileSync(path.join(files, `seed-grooming-${i}.jpg`), b));
  const tSign = await ds.getRepository(ChecklistTemplate).save({ name: 'Signage & Marketing Rollout', description: 'Verify the Diwali campaign signage matches the approved artwork (AI reference match)', category: 'VISUAL_MERCHANDISING', frequency: 'ADHOC', isActive: true, createdById: people.auditor });
  const qSign = await ds.getRepository(ChecklistQuestion).save([
    { templateId: tSign.id, section: 'Campaign', text: 'Photo of the main entrance signage', type: 'PHOTO', weight: 4, required: true, requiresPhoto: true, sortOrder: 1, options: [], correctOptions: [], aiCheck: 'REFERENCE_MATCH', referenceImageUrl: '/uploads/files/reference-diwali-signage.jpg', createTaskOnFail: true, isActive: true },
    { templateId: tSign.id, section: 'Campaign', text: 'Festive standee placed at the entrance?', type: 'YES_NO', weight: 2, required: true, requiresPhoto: false, sortOrder: 2, options: [], correctOptions: [], aiCheck: 'NONE', createTaskOnFail: true, isActive: true },
    { templateId: tSign.id, section: 'Campaign', text: 'Walk-through video of the window display', type: 'VIDEO', weight: 1, required: false, requiresPhoto: true, sortOrder: 3, options: [], correctOptions: [], aiCheck: 'NONE', createTaskOnFail: false, isActive: true },
  ]);
  const tGroom = await ds.getRepository(ChecklistTemplate).save({ name: 'Staff Grooming', description: 'Uniform and grooming check at shift start (AI uniform adherence)', category: 'OTHER', frequency: 'DAILY', isActive: true, createdById: people.regional });
  const qGroom = await ds.getRepository(ChecklistQuestion).save([
    { templateId: tGroom.id, section: 'Grooming', text: 'Photo of the staff member in uniform', type: 'PHOTO', weight: 3, required: true, requiresPhoto: true, sortOrder: 1, options: [], correctOptions: [], aiCheck: 'UNIFORM', createTaskOnFail: true, isActive: true },
    { templateId: tGroom.id, section: 'Grooming', text: 'Name badge worn?', type: 'YES_NO', weight: 1, required: true, requiresPhoto: false, sortOrder: 2, options: [], correctOptions: [], aiCheck: 'NONE', createTaskOnFail: false, isActive: true },
  ]);
  let subs = 0;
  let tasks = 0;
  for (const st of stores) {
    const mgr = people.managers.get(st.id) ?? people.admin;
    for (const [tpl, qs, d] of [[tSign, qSign, rng.int(1, 6)], [tGroom, qGroom, 1], [tGroom, qGroom, 2]] as [ChecklistTemplate, ChecklistQuestion[], number][]) {
      const date = addDays(today, -d);
      const fail = rng.chance(0.4);
      const a = await ds.getRepository(ChecklistAssignment).save({ templateId: tpl.id, storeId: st.id, assigneeId: mgr, assignedById: people.regional, dueDate: date, dueAt: zonedToUtc(date, '18:00', st.tz), windowStart: zonedToUtc(date, '10:00', st.tz), status: 'APPROVED', submissionId: null });
      const ai: AiResult = tpl === tSign
        ? fail ? { status: 'FAIL', score: 0.34, message: 'Signage does not match the approved artwork', issues: ['Campaign banner missing', 'Colours differ from reference'] } : { status: 'PASS', score: 0.91, message: 'Matches the approved reference', issues: [] }
        : fail ? { status: 'FAIL', score: 0.41, message: 'Not groomed: name badge missing', issues: ['name badge missing'] } : { status: 'PASS', score: 0.88, message: 'Groomed: uniform and badge detected', issues: [] };
      const answers: Partial<ChecklistAnswer>[] = [];
      let score = 0;
      let max = 0;
      let flags = 0;
      for (const q of qs) {
        max += q.weight;
        let value: string | null = null;
        let photoUrl: string | null = null;
        let s = q.weight;
        let flagged = false;
        let aiResult: AiResult | null = null;
        if (q.type === 'PHOTO') {
          photoUrl = tpl === tSign ? `/uploads/files/seed-signage-${fail ? 1 : 0}.jpg` : `/uploads/files/seed-grooming-${fail ? 1 : 0}.jpg`;
          aiResult = ai;
          if (fail) {
            s = 0;
            flagged = true;
          }
        } else if (q.type === 'YES_NO') {
          value = fail && rng.chance(0.5) ? 'NO' : 'YES';
          if (value === 'NO') {
            s = 0;
            flagged = true;
          }
        } else {
          value = '/uploads/files/seed-walkthrough.mp4';
          s = 0;
          if (!rng.chance(0.5)) continue;
          s = q.weight;
        }
        if (flagged) flags++;
        score += s;
        answers.push({ questionId: q.id, value, photoUrl, remark: flagged ? 'Raised with store manager' : null, score: s, maxScore: q.weight, redo: false, flagged, aiResult });
      }
      const submittedAt = zonedToUtc(date, `1${rng.int(0, 6)}:${String(rng.int(10, 59))}`, st.tz);
      const sub = await ds.getRepository(ChecklistSubmission).save({ assignmentId: a.id, templateId: tpl.id, storeId: st.id, submittedById: mgr, submittedAt, date, score, maxScore: max, scorePct: Math.round((score / max) * 10000) / 100, status: 'APPROVED', flags, reviewerComment: flags ? 'Deviation logged — follow-up task raised' : 'OK', reviewedById: people.auditor, reviewedAt: new Date(submittedAt.getTime() + 2 * H) });
      await ds.getRepository(ChecklistAssignment).update(a.id, { submissionId: sub.id });
      const saved = await ds.getRepository(ChecklistAnswer).save(answers.map((x) => ({ ...x, submissionId: sub.id })));
      subs++;
      for (const ans of saved.filter((x) => x.flagged)) {
        const q = qs.find((x) => x.id === ans.questionId);
        if (!q.createTaskOnFail) continue;
        const done = d > 2;
        await ds.getRepository(Task).save({
          title: `Fix: ${q.text}`, description: `Flagged in "${tpl.name}" submission #${sub.id}${ans.aiResult ? ` — AI: ${ans.aiResult.message}` : ''}`, storeId: st.id, zoneId: null, type: 'FOLLOW_UP', priority: 'HIGH',
          status: done ? 'DONE' : 'TODO', assigneeId: mgr, createdById: mgr, dueAt: new Date(submittedAt.getTime() + 24 * H), completedAt: done ? new Date(submittedAt.getTime() + 20 * H) : null,
          checklistAnswerId: ans.id, proofUrl: done ? (tpl === tSign ? '/uploads/files/seed-signage-0.jpg' : '/uploads/files/seed-grooming-0.jpg') : null, remark: done ? 'Fixed and re-checked' : null, createdAt: new Date(submittedAt.getTime() + 5 * 60000),
        });
        tasks++;
      }
    }
  }
  log(`  Trax v2: 2 schedules, 2 AI templates, ${subs} AI-checked submissions, ${tasks} deviation tasks`);
}
