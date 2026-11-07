import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, In } from 'typeorm';
import { bulkInsert } from '../common/bulk';
import { addDays, dowOf, zonedToUtc } from '../common/time.util';
import { uploadDir } from '../config/database.config';
import { AlertRule } from '../modules/alerts/entities/alert-rule.entity';
import { Alert } from '../modules/alerts/entities/alert.entity';
import { Notification } from '../modules/alerts/entities/notification.entity';
import { ChecklistAnswer } from '../modules/checklists/entities/checklist-answer.entity';
import { ChecklistAssignment } from '../modules/checklists/entities/checklist-assignment.entity';
import { ChecklistQuestion } from '../modules/checklists/entities/checklist-question.entity';
import { ChecklistSubmission } from '../modules/checklists/entities/checklist-submission.entity';
import { ChecklistTemplate } from '../modules/checklists/entities/checklist-template.entity';
import { isFlagged, scoreAnswer } from '../modules/checklists/scoring';
import { DocumentFile } from '../modules/documents/entities/document.entity';
import { ReportSchedule } from '../modules/reports/entities/report-schedule.entity';
import { Task } from '../modules/tasks/entities/task.entity';
import { TicketComment } from '../modules/tickets/entities/ticket-comment.entity';
import { Ticket } from '../modules/tickets/entities/ticket.entity';
import { slaDue, ticketNumber } from '../modules/tickets/tickets.service';
import { VendorVisit } from '../modules/vendors/entities/vendor-visit.entity';
import { Vendor } from '../modules/vendors/entities/vendor.entity';
import { Camera } from '../modules/cameras/entities/camera.entity';
import { SeedStore } from './model';
import { Rng } from './rng';

export interface PeopleIds {
  admin: number;
  regional: number;
  auditor: number;
  staffTnagar: number;
  managers: Map<number, number>; // storeId -> manager user id
}

const H = 3600_000;

// ------------------------------------------------------------------ alert rules + alerts
export const ALERT_RULES: Partial<AlertRule>[] = [
  { name: 'Billing queue too long', metric: 'QUEUE_LENGTH', threshold: 6, severity: 'HIGH', channels: ['IN_APP', 'EMAIL'], cooldownMin: 30 },
  { name: 'Billing wait above 5 minutes', metric: 'QUEUE_WAIT', threshold: 300, severity: 'MEDIUM', channels: ['IN_APP'], cooldownMin: 30 },
  { name: 'Camera offline', metric: 'CAMERA_OFFLINE', threshold: 10, severity: 'CRITICAL', channels: ['IN_APP', 'EMAIL'], cooldownMin: 120, autoTicket: true },
  { name: 'Store opened late', metric: 'STORE_OPEN_LATE', threshold: 15, severity: 'HIGH', channels: ['IN_APP', 'EMAIL'], cooldownMin: 60 },
  { name: 'Store closed early', metric: 'STORE_CLOSE_EARLY', threshold: 15, severity: 'MEDIUM', channels: ['IN_APP'], cooldownMin: 60 },
  { name: 'Footfall drop vs last week', metric: 'FOOTFALL_DROP', threshold: 30, severity: 'MEDIUM', channels: ['IN_APP'], cooldownMin: 180 },
  { name: 'Conversion drop vs last week', metric: 'CONVERSION_DROP', threshold: 25, severity: 'MEDIUM', channels: ['IN_APP'], cooldownMin: 180 },
  { name: 'SOP breach detected', metric: 'SOP_BREACH', threshold: 1, severity: 'HIGH', channels: ['IN_APP'], cooldownMin: 15 },
  { name: 'Staff shortage on floor', metric: 'STAFF_SHORTAGE', threshold: 2, severity: 'HIGH', channels: ['IN_APP'], cooldownMin: 60 },
  { name: 'Billing counter unattended', metric: 'COUNTER_UNATTENDED', threshold: 1, severity: 'MEDIUM', channels: ['IN_APP'], cooldownMin: 15 },
  { name: 'Checklist overdue', metric: 'CHECKLIST_OVERDUE', threshold: 1, severity: 'MEDIUM', channels: ['IN_APP'], cooldownMin: 120 },
  { name: 'Checklist non-compliance', metric: 'CHECKLIST_NON_COMPLIANCE', threshold: 2, severity: 'HIGH', channels: ['IN_APP'], cooldownMin: 30 },
  { name: 'Edge box offline', metric: 'EDGE_OFFLINE', threshold: 10, severity: 'CRITICAL', channels: ['IN_APP', 'EMAIL'], cooldownMin: 240, autoTicket: true },
];

export async function seedAlerts(ds: DataSource, stores: SeedStore[], people: PeopleIds, now: Date, offlineCamera: Camera, rng: Rng) {
  const rules = await ds.getRepository(AlertRule).save(ALERT_RULES.map((r): Partial<AlertRule> => ({ ...r, storeId: null, isActive: true })));
  const byMetric = new Map(rules.map((r) => [r.metric, r]));
  const msg = (metric: string, st: SeedStore): [string, number] => {
    const n = st.def.name;
    switch (metric) {
      case 'QUEUE_LENGTH': { const v = rng.int(7, 12); return [`Queue at Billing Counter ${rng.int(1, 2)} is ${v} people (threshold 6) at ${n}`, v]; }
      case 'QUEUE_WAIT': { const v = rng.int(310, 520); return [`Wait time at Billing Counter ${rng.int(1, 2)} is ${v}s (threshold 300s) at ${n}`, v]; }
      case 'CAMERA_OFFLINE': { const v = rng.int(12, 240); return [`1 camera(s) offline at ${n}: ${rng.pick(st.floors).name} (${v} min)`, v]; }
      case 'STORE_OPEN_LATE': { const v = rng.int(16, 40); return [`${n} opened ${v} min late (scheduled ${st.def.openTime})`, v]; }
      case 'STORE_CLOSE_EARLY': { const v = rng.int(16, 35); return [`${n} closed ${v} min early (scheduled ${st.def.closeTime})`, v]; }
      case 'FOOTFALL_DROP': { const v = rng.int(31, 48); return [`Footfall at ${n} is down ${v}% vs same hours last week`, v]; }
      case 'CONVERSION_DROP': { const v = rng.int(26, 40); return [`Conversion at ${n} is down ${v}% vs last week`, v]; }
      case 'SOP_BREACH': return [`SOP breach: 1 event(s) in the last 15 min at ${n}`, 1];
      case 'STAFF_SHORTAGE': return [`Only 1 staff present at ${n} (minimum 2)`, 1];
      default: return [`Counter unattended: 1 event(s) in the last 15 min at ${n}`, 1];
    }
  };
  const metrics = ['QUEUE_LENGTH', 'QUEUE_LENGTH', 'QUEUE_WAIT', 'CAMERA_OFFLINE', 'STORE_OPEN_LATE', 'STORE_CLOSE_EARLY', 'FOOTFALL_DROP', 'CONVERSION_DROP', 'SOP_BREACH', 'SOP_BREACH', 'STAFF_SHORTAGE', 'COUNTER_UNATTENDED', 'COUNTER_UNATTENDED'];
  const rows: Partial<Alert>[] = [];
  for (let i = 0; i < 40; i++) {
    const st = rng.pick(stores);
    const metric = rng.pick(metrics);
    const rule = byMetric.get(metric);
    const ageH = i < 6 ? rng.between(0.2, 20) : rng.between(24, 30 * 24);
    const createdAt = new Date(now.getTime() - ageH * H);
    const [message, value] = msg(metric, st);
    const status = ageH < 24 ? rng.weighted(['OPEN', 'ACKNOWLEDGED'], [0.7, 0.3]) : rng.weighted(['RESOLVED', 'ACKNOWLEDGED', 'OPEN'], [0.75, 0.17, 0.08]);
    const ackBy = people.managers.get(st.id) ?? people.admin;
    rows.push({
      ruleId: rule.id, ruleName: rule.name, storeId: st.id, metric, severity: rule.severity, message, value, status, createdAt,
      acknowledgedAt: status !== 'OPEN' ? new Date(createdAt.getTime() + rng.int(3, 45) * 60000) : null,
      acknowledgedById: status !== 'OPEN' ? ackBy : null,
      resolvedAt: status === 'RESOLVED' ? new Date(createdAt.getTime() + rng.int(30, 300) * 60000) : null,
      resolvedById: status === 'RESOLVED' ? ackBy : null,
    });
  }
  const offStore = stores.find((s) => s.id === offlineCamera.storeId);
  const cam = byMetric.get('CAMERA_OFFLINE');
  rows.push({ ruleId: cam.id, ruleName: cam.name, storeId: offStore.id, metric: 'CAMERA_OFFLINE', severity: cam.severity, message: `1 camera(s) offline at ${offStore.def.name}: ${offlineCamera.name} (140 min)`, value: 140, status: 'OPEN', createdAt: new Date(now.getTime() - 140 * 60000 + 11 * 60000) });
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  await bulkInsert(ds.manager, Alert, rows);
  const alerts = await ds.getRepository(Alert).find({ order: { createdAt: 'DESC' } });
  const notes: Partial<Notification>[] = [];
  for (const a of alerts.slice(0, 25)) {
    const recipients = new Set([people.admin, people.managers.get(a.storeId)]);
    if (stores.find((s) => s.id === a.storeId)?.def.region === 'Chennai') recipients.add(people.regional);
    for (const u of recipients) {
      if (!u) continue;
      notes.push({ userId: u, title: `[${a.severity}] ${a.ruleName}`, body: a.message, link: `/alerts/${a.id}`, isRead: a.status !== 'OPEN' && rng.chance(0.8), createdAt: a.createdAt });
    }
  }
  await bulkInsert(ds.manager, Notification, notes);
  return alerts;
}

// ------------------------------------------------------------------ checklists
type Q = Partial<ChecklistQuestion>;
const yes = (section: string, text: string, weight = 1, extra: Q = {}): Q => ({ section, text, type: 'YES_NO', weight, ...extra });
export const TEMPLATES: { t: Partial<ChecklistTemplate>; q: Q[] }[] = [
  {
    t: { name: 'Store Opening Checklist', description: 'To be completed within 30 minutes of opening the shutter', category: 'OPENING', frequency: 'DAILY' },
    q: [
      yes('Entrance & Exterior', 'Shutter opened on time and entrance area swept', 2),
      yes('Entrance & Exterior', 'Signage, glow sign and window lights switched on', 1),
      { section: 'Entrance & Exterior', text: 'Photo of the store front after opening', type: 'PHOTO', weight: 2, requiresPhoto: true },
      yes('Sales Floor', 'All mannequins dressed as per the current VM guide', 2),
      yes('Sales Floor', 'Trial rooms clean, mirrors wiped and hooks available', 1),
      { section: 'Sales Floor', text: 'Number of staff present at opening', type: 'NUMBER', weight: 1, minValue: 5, maxValue: 15 },
      yes('Billing', 'POS terminals, scanners and card machines working', 2),
      { section: 'Billing', text: 'Opening cash float verified (INR)', type: 'NUMBER', weight: 2, minValue: 5000, maxValue: 10000 },
      yes('Billing', 'Carry bag and invoice roll stock adequate', 1),
      yes('Safety', 'Fire exits clear and unlocked', 3),
    ],
  },
  {
    t: { name: 'Store Closing Checklist', description: 'Complete before pulling down the shutter', category: 'CLOSING', frequency: 'DAILY' },
    q: [
      yes('Billing', 'Day-end POS report generated and cash tallied', 3),
      { section: 'Billing', text: 'Cash variance at day end (INR)', type: 'NUMBER', weight: 2, minValue: -100, maxValue: 100 },
      yes('Sales Floor', 'Folding and racks re-arranged by size', 1),
      yes('Sales Floor', 'Trial rooms checked for left-behind garments', 1),
      yes('Safety', 'All lights, AC and escalators switched off', 2),
      yes('Safety', 'CCTV/NVR running and recording', 2),
      { section: 'Safety', text: 'Photo of locked shutter', type: 'PHOTO', weight: 2, requiresPhoto: true },
      { section: 'Notes', text: 'Any incidents to report', type: 'TEXT', weight: 1, required: false },
    ],
  },
  {
    t: { name: 'Visual Merchandising Audit', description: 'Weekly VM compliance audit by the audit team', category: 'VISUAL_MERCHANDISING', frequency: 'WEEKLY' },
    q: [
      { section: 'Window', text: 'Current window display theme', type: 'MCQ_SINGLE', weight: 2, options: ['Festive – Diwali', 'Regular season', 'Clearance sale', 'Not updated'], correctOptions: ['Festive – Diwali', 'Regular season'] },
      { section: 'Window', text: 'Window display photo', type: 'PHOTO', weight: 2, requiresPhoto: true },
      { section: 'Floor', text: 'Which focus walls match the planogram?', type: 'MCQ_MULTI', weight: 4, options: ['Front table', "Women's ethnic wall", "Men's denim wall", 'Kids corner'], correctOptions: ['Front table', "Women's ethnic wall", "Men's denim wall", 'Kids corner'] },
      { section: 'Floor', text: 'Overall visual appeal', type: 'RATING', weight: 3 },
      { section: 'Floor', text: 'Colour blocking on racks', type: 'RATING', weight: 2 },
      yes('Floor', 'Price tags visible on all displayed products', 2),
      { section: 'Floor', text: 'Observations', type: 'TEXT', weight: 1, required: false },
    ],
  },
  {
    t: { name: 'Hygiene & Safety Audit', description: 'Weekly hygiene, safety and statutory compliance check', category: 'HYGIENE', frequency: 'WEEKLY' },
    q: [
      yes('Hygiene', 'Floors mopped and dust-free', 2),
      yes('Hygiene', 'Staff washroom clean and stocked', 2),
      { section: 'Hygiene', text: 'Overall cleanliness', type: 'RATING', weight: 3 },
      { section: 'Hygiene', text: 'AC temperature on floor (°C)', type: 'NUMBER', weight: 1, minValue: 20, maxValue: 26 },
      { section: 'Safety', text: 'Fire extinguisher status', type: 'MCQ_SINGLE', weight: 3, options: ['Valid', 'Expired', 'Missing'], correctOptions: ['Valid'] },
      yes('Safety', 'First-aid kit available and stocked', 2),
      { section: 'Safety', text: 'Photo of fire extinguisher tag', type: 'PHOTO', weight: 1, requiresPhoto: true },
    ],
  },
];

function answerFor(q: ChecklistQuestion, good: boolean, rng: Rng): { value: string | null; photoUrl: string | null } {
  const photo = '/uploads/files/seed-photo.jpg';
  switch (q.type) {
    case 'YES_NO':
      return { value: good ? 'YES' : 'NO', photoUrl: null };
    case 'NUMBER': {
      const lo = q.minValue ?? 0;
      const hi = q.maxValue ?? lo + 10;
      return { value: String(good ? Math.round(rng.between(lo, hi)) : Math.round(hi + Math.max(1, (hi - lo) * 0.2))), photoUrl: null };
    }
    case 'MCQ_SINGLE': {
      const c = q.correctOptions?.length ? q.correctOptions : q.options;
      const wrong = q.options.filter((o) => !c.includes(o));
      return { value: good || !wrong.length ? rng.pick(c) : rng.pick(wrong), photoUrl: null };
    }
    case 'MCQ_MULTI': {
      const c = q.correctOptions?.length ? q.correctOptions : q.options;
      return { value: JSON.stringify(good ? c : c.slice(0, Math.max(1, c.length - 1))), photoUrl: null };
    }
    case 'RATING':
      return { value: String(good ? rng.int(4, 5) : rng.int(2, 3)), photoUrl: null };
    case 'PHOTO':
      return { value: null, photoUrl: photo };
    default:
      return { value: good ? rng.pick(['All in order', 'No issues', 'Minor dust near entrance, cleaned']) : 'Pending follow-up', photoUrl: null };
  }
}

export async function seedChecklists(ds: DataSource, stores: SeedStore[], people: PeopleIds, today: string, now: Date, rng: Rng) {
  const templates: { t: ChecklistTemplate; q: ChecklistQuestion[] }[] = [];
  for (const def of TEMPLATES) {
    const t = await ds.getRepository(ChecklistTemplate).save({ ...def.t, isActive: true, createdById: people.auditor });
    const qs = await ds.getRepository(ChecklistQuestion).save(
      def.q.map((q, i): Partial<ChecklistQuestion> => ({ templateId: t.id, required: true, requiresPhoto: false, options: [], correctOptions: [], minValue: null, maxValue: null, isActive: true, sortOrder: i + 1, ...q })),
    );
    templates.push({ t, q: qs });
  }
  const [opening, closing, vm, hygiene] = templates;
  const assignments: Partial<ChecklistAssignment>[] = [];
  const windows: Record<string, [string, string]> = { OPENING: ['09:30', '10:30'], CLOSING: ['21:00', '22:30'] };
  const tz = stores[0].tz;
  const timed = (a: Partial<ChecklistAssignment>, category: string): Partial<ChecklistAssignment> => {
    const [ws, we] = windows[category] ?? ['10:00', '18:00'];
    return { ...a, windowStart: zonedToUtc(a.dueDate, ws, tz), dueAt: zonedToUtc(a.dueDate, we, tz) };
  };
  for (const st of stores) {
    const mgr = people.managers.get(st.id) ?? people.admin;
    for (let d = 60; d >= -1; d--) {
      const date = addDays(today, -d);
      assignments.push(timed({ templateId: opening.t.id, storeId: st.id, assigneeId: st.def.short === 'TNR' ? people.staffTnagar : mgr, assignedById: mgr, dueDate: date, status: 'PENDING' }, 'OPENING'));
      assignments.push(timed({ templateId: closing.t.id, storeId: st.id, assigneeId: mgr, assignedById: mgr, dueDate: date, status: 'PENDING' }, 'CLOSING'));
      const dow = dowOf(date);
      if (dow === 1) assignments.push(timed({ templateId: vm.t.id, storeId: st.id, assigneeId: people.auditor, assignedById: people.regional, dueDate: date, status: 'PENDING' }, 'VISUAL_MERCHANDISING'));
      if (dow === 4) assignments.push(timed({ templateId: hygiene.t.id, storeId: st.id, assigneeId: mgr, assignedById: people.regional, dueDate: date, status: 'PENDING' }, 'HYGIENE'));
    }
  }
  await bulkInsert(ds.manager, ChecklistAssignment, assignments);
  const saved = await ds.getRepository(ChecklistAssignment).find();
  const tpl = new Map(templates.map((x) => [x.t.id, x]));
  const quality = new Map(stores.map((s) => [s.id, rng.between(0.84, 0.96)]));
  const subs: Partial<ChecklistSubmission>[] = [];
  const answersByAssignment = new Map<number, Partial<ChecklistAnswer>[]>();
  const assignmentStatus = new Map<number, string>();
  for (const a of saved) {
    const st = stores.find((s) => s.id === a.storeId);
    const age = Math.round((Date.parse(today) - Date.parse(a.dueDate)) / 86400000);
    if (age < 0) continue; // tomorrow → PENDING
    const t = tpl.get(a.templateId);
    const dueMin = t.t.category === 'CLOSING' ? 22 * 60 : t.t.category === 'OPENING' ? 10 * 60 + 45 : 17 * 60;
    const submittedAt = new Date(zonedToUtc(a.dueDate, '00:00', st.tz).getTime() + (dueMin + rng.int(-40, 20)) * 60000);
    if (age === 0 && submittedAt > now) continue; // later today → PENDING
    if (rng.chance(0.04) && age > 0) {
      assignmentStatus.set(a.id, 'OVERDUE');
      continue;
    }
    let answers: Partial<ChecklistAnswer>[] = [];
    let score = 0;
    let max = 0;
    let flags = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      answers = [];
      score = 0;
      max = 0;
      flags = 0;
      for (const q of t.q) {
        const good = rng.chance(quality.get(st.id));
        const ans = answerFor(q, good, rng);
        const s = scoreAnswer(q, ans.value, ans.photoUrl);
        const flagged = isFlagged(q, ans.value, ans.photoUrl);
        if (flagged) flags++;
        score += s;
        max += q.weight;
        answers.push({ questionId: q.id, value: ans.value, photoUrl: ans.photoUrl, remark: good ? null : 'Corrected on the spot', score: s, maxScore: q.weight, redo: false, flagged, aiResult: null });
      }
      if (score / max >= 0.7) break;
    }
    const pct = Math.round((score / max) * 10000) / 100;
    const status = age <= 2 ? 'SUBMITTED' : rng.chance(0.04) && age < 12 ? 'REDO' : 'APPROVED';
    if (status === 'REDO') answers.filter((x) => x.score < x.maxScore).forEach((x) => (x.redo = true));
    const reviewer = rng.pick([people.auditor, people.regional]);
    subs.push({
      assignmentId: a.id, templateId: a.templateId, storeId: a.storeId, submittedById: a.assigneeId, submittedAt, date: a.dueDate,
      score: Math.round(score * 100) / 100, maxScore: max, scorePct: pct, status, flags,
      reviewerComment: status === 'APPROVED' ? (pct > 90 ? 'Good job' : 'OK — close the gaps noted') : status === 'REDO' ? 'Please redo the failed items with photos' : null,
      reviewedById: status === 'SUBMITTED' ? null : reviewer,
      reviewedAt: status === 'SUBMITTED' ? null : new Date(submittedAt.getTime() + rng.int(2, 30) * H),
    });
    answersByAssignment.set(a.id, answers);
    assignmentStatus.set(a.id, status);
  }
  await bulkInsert(ds.manager, ChecklistSubmission, subs);
  const savedSubs = await ds.getRepository(ChecklistSubmission).find({ select: { id: true, assignmentId: true } });
  const answerRows: Partial<ChecklistAnswer>[] = [];
  for (const s of savedSubs) for (const a of answersByAssignment.get(s.assignmentId) ?? []) answerRows.push({ ...a, submissionId: s.id });
  await ds.transaction((em) => bulkInsert(em, ChecklistAnswer, answerRows));
  // assignment status + submission link
  const subByAssignment = new Map(savedSubs.map((s) => [s.assignmentId, s.id]));
  for (const status of ['SUBMITTED', 'APPROVED', 'REDO', 'OVERDUE']) {
    const ids = [...assignmentStatus].filter(([, s]) => s === status).map(([id]) => id);
    for (let i = 0; i < ids.length; i += 500) await ds.getRepository(ChecklistAssignment).update({ id: In(ids.slice(i, i + 500)) }, { status });
  }
  await ds.transaction(async (em) => {
    for (const [aid, sid] of subByAssignment) await em.getRepository(ChecklistAssignment).update(aid, { submissionId: sid });
  });
  return { templates: templates.length, assignments: saved.length, submissions: savedSubs.length, answers: answerRows.length, openingTemplateId: opening.t.id, vmTemplateId: vm.t.id };
}

// ------------------------------------------------------------------ tasks & tickets
const TASK_TITLES: [string, string, string][] = [
  ['ZONE_ALLOCATION', "Cover Women's Wear during evening peak (6–9 pm)", "Women's Wear"],
  ['ZONE_ALLOCATION', 'Assist customers in Trial Rooms on Saturday', 'Trial Rooms'],
  ['ZONE_ALLOCATION', 'Footwear section floor duty — weekend', 'Footwear'],
  ['ZONE_ALLOCATION', 'Kids section — festive rush coverage', 'Kids'],
  ['VISUAL_MERCHANDISING', 'Refresh Diwali window display', ''],
  ['VISUAL_MERCHANDISING', 'Re-do colour blocking on denim wall', ''],
  ['VISUAL_MERCHANDISING', 'Install new arrivals standee near entrance', ''],
  ['FOLLOW_UP', 'Follow up on failed hygiene audit items', ''],
  ['FOLLOW_UP', 'Close the gaps from last VM audit', ''],
  ['FOLLOW_UP', 'Investigate conversion drop on Tuesday evening', ''],
  ['GENERAL', 'Restock carry bags and invoice rolls', ''],
  ['GENERAL', 'Train new cashier on returns process', ''],
  ['GENERAL', 'Count and reconcile damaged stock', ''],
  ['GENERAL', 'Update price tags for clearance rack', ''],
  ['GENERAL', 'Fix flickering light in Accessories', ''],
];

export async function seedTasksTickets(ds: DataSource, stores: SeedStore[], people: PeopleIds, now: Date, alerts: Alert[], rng: Rng) {
  const tasks: Partial<Task>[] = [];
  for (let i = 0; i < 30; i++) {
    const st = i < 8 ? stores[0] : rng.pick(stores);
    const [type, title, zoneName] = TASK_TITLES[i % TASK_TITLES.length];
    const zone = zoneName ? st.sections.find((s) => s.def.name === zoneName)?.zone : null;
    const createdAt = new Date(now.getTime() - rng.between(1, 25 * 24) * H);
    const status = rng.weighted(['TODO', 'IN_PROGRESS', 'DONE', 'VERIFIED', 'CANCELLED'], [0.25, 0.2, 0.2, 0.3, 0.05]);
    const mgr = people.managers.get(st.id) ?? people.admin;
    const assignee = st.def.short === 'TNR' && rng.chance(0.6) ? people.staffTnagar : mgr;
    const completedAt = status === 'DONE' || status === 'VERIFIED' ? new Date(createdAt.getTime() + rng.between(2, 48) * H) : null;
    tasks.push({
      title, description: `${title} at ${st.def.name}.`, storeId: st.id, zoneId: type === 'ZONE_ALLOCATION' ? (zone?.id ?? st.sections[0].zone.id) : null, type,
      priority: rng.weighted(['LOW', 'MEDIUM', 'HIGH', 'URGENT'], [0.2, 0.45, 0.25, 0.1]), status, assigneeId: assignee, createdById: rng.chance(0.5) ? mgr : people.regional,
      dueAt: new Date(createdAt.getTime() + rng.between(24, 96) * H), completedAt, verifiedAt: status === 'VERIFIED' ? new Date(completedAt.getTime() + rng.between(1, 12) * H) : null,
      verifiedById: status === 'VERIFIED' ? mgr : null, createdAt,
    });
  }
  await bulkInsert(ds.manager, Task, tasks);

  const ticketSpecs: [string, string, string][] = [
    ['PLANOGRAM', "Women's ethnic wall not as per planogram", 'Sarees and kurtis mixed on the same bay; planogram v3 needs re-setup.'],
    ['PLANOGRAM', 'Front table missing festive SKUs', 'Diwali gift sets not received for the front table.'],
    ['PLANOGRAM', "Men's denim wall size sequence wrong", 'Sizes 32–36 interleaved.'],
    ['CAMERA', 'Floor camera view blurred', 'Lens needs cleaning / refocus; heatmap quality degraded.'],
    ['CAMERA', 'Entrance camera angle shifted', 'Entry line counts look low since yesterday.'],
    ['CAMERA', 'Billing camera offline intermittently', 'Goes offline 2–3 times a day.'],
    ['NETWORK', 'Store internet down — POS sync delayed', 'Primary ISP link down, failover on 4G dongle.'],
    ['NETWORK', 'Edge box cannot reach server', 'Heartbeats missing for 20 min.'],
    ['INFRASTRUCTURE', 'AC not cooling on first floor', 'Temperature 29°C at 4 pm.'],
    ['INFRASTRUCTURE', 'Trial room door lock broken', 'Room 3 lock not working.'],
    ['MAINTENANCE', 'Escalator making noise', 'Grinding noise at the top landing.'],
    ['MAINTENANCE', 'Leak near staff washroom', 'Water seeping under the door.'],
    ['OTHER', 'Customer complaint about billing wait', 'Customer waited 12 min on Sunday evening.'],
  ];
  const comments = ['Vendor informed, visit scheduled.', 'Checked on site — issue confirmed.', 'Spare part ordered.', 'Temporary fix applied, monitoring.', 'Closed after verification by store manager.'];
  const tickets: Ticket[] = [];
  for (let i = 0; i < 25; i++) {
    const [category, title, description] = ticketSpecs[i % ticketSpecs.length];
    const st = rng.pick(stores);
    const priority = rng.weighted(['LOW', 'MEDIUM', 'HIGH', 'URGENT'], [0.2, 0.4, 0.3, 0.1]);
    const createdAt = new Date(now.getTime() - rng.between(2, 30 * 24) * H);
    const sla = slaDue(createdAt, priority);
    const status = rng.weighted(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'], [0.25, 0.25, 0.25, 0.2, 0.05]);
    const done = status === 'RESOLVED' || status === 'CLOSED';
    const resolvedAt = done ? new Date(createdAt.getTime() + (rng.chance(0.3) ? sla.getTime() - createdAt.getTime() + rng.between(1, 30) * H : rng.between(0.5, 0.9) * (sla.getTime() - createdAt.getTime()))) : null;
    const t = await ds.getRepository(Ticket).save({
      number: '', title, description, storeId: st.id, category, priority, status, assigneeId: status === 'OPEN' ? null : (people.managers.get(st.id) ?? people.admin),
      reporterId: rng.pick([people.managers.get(st.id) ?? people.admin, people.auditor, people.regional]), alertId: null, slaDueAt: sla, resolvedAt: resolvedAt && resolvedAt > now ? now : resolvedAt, createdAt,
    });
    t.number = ticketNumber(t.id);
    await ds.getRepository(Ticket).update(t.id, { number: t.number });
    tickets.push(t);
    const nc = rng.int(0, 3);
    for (let k = 0; k < nc; k++) {
      await ds.getRepository(TicketComment).save({ ticketId: t.id, userId: rng.pick([t.reporterId, t.assigneeId ?? people.admin]), body: comments[(i + k) % comments.length], createdAt: new Date(Math.min(now.getTime(), createdAt.getTime() + (k + 1) * rng.between(1, 20) * H)) });
    }
  }
  // two tickets raised from alerts
  for (const a of alerts.filter((x) => x.metric === 'CAMERA_OFFLINE' || x.metric === 'QUEUE_LENGTH').slice(0, 2)) {
    const createdAt = new Date(a.createdAt.getTime() + 20 * 60000);
    const priority = a.severity === 'CRITICAL' ? 'URGENT' : 'HIGH';
    const t = await ds.getRepository(Ticket).save({ number: '', title: a.ruleName, description: `Created from alert #${a.id}: ${a.message}`, storeId: a.storeId, category: a.metric === 'CAMERA_OFFLINE' ? 'CAMERA' : 'OTHER', priority, status: 'IN_PROGRESS', assigneeId: people.managers.get(a.storeId) ?? people.admin, reporterId: people.admin, alertId: a.id, slaDueAt: slaDue(createdAt, priority), resolvedAt: null, createdAt });
    await ds.getRepository(Ticket).update(t.id, { number: ticketNumber(t.id) });
    await ds.getRepository(Alert).update(a.id, { ticketId: t.id, status: a.status === 'OPEN' ? 'ACKNOWLEDGED' : a.status, acknowledgedAt: a.acknowledgedAt ?? createdAt, acknowledgedById: a.acknowledgedById ?? people.admin });
  }
  return { tasks: tasks.length, tickets: tickets.length + 2 };
}

// ------------------------------------------------------------------ vendors, documents, schedules
export async function seedVendors(ds: DataSource, stores: SeedStore[], people: PeopleIds, now: Date, rng: Rng) {
  const vendors = await ds.getRepository(Vendor).save([
    { name: 'Chennai Facility Services', category: 'HOUSEKEEPING', contactName: 'Mani Selvam', phone: '+91 98400 12345', email: 'ops@chennaifacility.in', isActive: true },
    { name: 'SecureGuard Services Pvt Ltd', category: 'SECURITY', contactName: 'Rajesh Kannan', phone: '+91 98410 22334', email: 'control@secureguard.in', isActive: true },
    { name: 'CoolAir HVAC Solutions', category: 'MAINTENANCE', contactName: 'Imran Basha', phone: '+91 97890 45678', email: 'service@coolairhvac.in', isActive: true },
    { name: 'TechNet IT Services', category: 'IT', contactName: 'Sundar Rajan', phone: '+91 99400 56789', email: 'support@technetit.in', isActive: true },
    { name: 'Tiruppur Textiles Supplies', category: 'SUPPLIER', contactName: 'Palanisamy K', phone: '+91 94430 67890', email: 'orders@tiruppurtextiles.in', isActive: true },
    { name: 'Bright Spark Electricals', category: 'MAINTENANCE', contactName: 'Ramesh Babu', phone: '+91 98844 78901', email: 'jobs@brightspark.in', isActive: true },
  ]);
  const purposes: Record<string, string[]> = {
    HOUSEKEEPING: ['Weekly deep cleaning', 'Pest control treatment', 'Glass facade cleaning'],
    SECURITY: ['Monthly guard roster review', 'CCTV room audit'],
    MAINTENANCE: ['AC preventive maintenance', 'Escalator servicing', 'Lighting repair', 'DG set servicing'],
    IT: ['POS terminal service', 'Network switch replacement', 'Edge box health check'],
    SUPPLIER: ['Festive stock delivery', 'Return of damaged stock'],
    OTHER: ['General visit'],
  };
  const rows: Partial<VendorVisit>[] = [];
  for (let i = 0; i < 40; i++) {
    const v = rng.pick(vendors);
    const st = rng.pick(stores);
    const offsetDays = i < 26 ? -rng.between(1, 30) : i < 28 ? 0 : rng.between(1, 14);
    const scheduledAt = new Date(zonedToUtc(addDays(new Date(now.getTime() + 5.5 * H).toISOString().slice(0, 10), Math.round(offsetDays)), `${rng.int(8, 10)}:${rng.pick(['00', '30'])}`, st.tz).getTime());
    let status = 'SCHEDULED';
    let checkInAt: Date | null = null;
    let checkOutAt: Date | null = null;
    let rating: number | null = null;
    if (offsetDays < 0) {
      status = rng.weighted(['COMPLETED', 'MISSED', 'CANCELLED'], [0.75, 0.15, 0.1]);
      if (status === 'COMPLETED') {
        checkInAt = new Date(scheduledAt.getTime() + rng.int(-10, 40) * 60000);
        checkOutAt = new Date(checkInAt.getTime() + rng.int(45, 240) * 60000);
        rating = rng.weighted([3, 4, 5], [0.2, 0.5, 0.3]);
      }
    } else if (offsetDays === 0 && scheduledAt < now) {
      status = 'CHECKED_IN';
      checkInAt = new Date(scheduledAt.getTime() + rng.int(0, 20) * 60000);
    }
    rows.push({ vendorId: v.id, storeId: st.id, purpose: rng.pick(purposes[v.category]), scheduledAt, checkInAt, checkOutAt, status, rating, notes: status === 'COMPLETED' ? rng.pick(['Work completed satisfactorily', 'Completed, follow-up needed next week', 'On time, good quality']) : status === 'MISSED' ? 'Vendor did not turn up' : null, createdById: people.managers.get(st.id) ?? people.admin });
  }
  await bulkInsert(ds.manager, VendorVisit, rows);
  return { vendors: vendors.length, visits: rows.length };
}

function minimalPdf(lines: string[]): Buffer {
  const text = lines.map((l, i) => `BT /F1 12 Tf 50 ${780 - i * 18} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A recognisable store-front photo (shutter up, signage, lit window, racks) rendered to JPEG with sharp. */
export async function seedPhotoJpeg(): Promise<Buffer> {
  const racks = Array.from({ length: 6 }, (_, i) => {
    const x = 70 + i * 86;
    const hues = ['#d94f70', '#3a7bd5', '#f2a541', '#4caf7d', '#8e6ccf', '#e0773c'];
    const items = Array.from({ length: 5 }, (_, j) => `<rect x="${x + 6 + j * 14}" y="${262 + (j % 2) * 6}" width="10" height="${70 - (j % 2) * 6}" rx="2" fill="${hues[(i + j) % hues.length]}"/>`).join('');
    return `<rect x="${x}" y="250" width="78" height="96" rx="4" fill="#efe6d8" stroke="#b9a98f"/>${items}<rect x="${x}" y="340" width="78" height="6" fill="#8d7b62"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bcd7ee"/><stop offset="1" stop-color="#e9f1f7"/></linearGradient></defs>
    <rect width="640" height="480" fill="url(#sky)"/>
    <rect x="30" y="110" width="580" height="330" fill="#f6f2ea" stroke="#9c8f7a" stroke-width="3"/>
    <rect x="30" y="110" width="580" height="70" fill="#123a6b"/>
    <text x="320" y="157" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle">CONGRUENCE</text>
    <rect x="55" y="195" width="530" height="18" fill="#7c868f"/><rect x="55" y="195" width="530" height="4" fill="#5d666e"/>
    <rect x="55" y="215" width="530" height="210" fill="#fff8e7" stroke="#c7b99f"/>${racks}
    <rect x="0" y="440" width="640" height="40" fill="#8a8f96"/>
    <rect x="12" y="452" width="250" height="20" rx="4" fill="rgba(16,24,40,0.72)"/>
    <text x="22" y="467" font-family="DejaVu Sans Mono, monospace" font-size="12" fill="#ffffff">Store front · shutter open</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

export async function seedDocuments(ds: DataSource, stores: SeedStore[], people: PeopleIds) {
  const dir = path.join(uploadDir(), 'documents');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(uploadDir(), 'files'), { recursive: true });
  // checklist photo evidence of the seeded submissions: a real 640×480 store-front JPEG (not a 1-pixel placeholder)
  fs.writeFileSync(path.join(uploadDir(), 'files', 'seed-photo.jpg'), await seedPhotoJpeg());
  const docs: [string, string, number | null, string, string, Buffer][] = [
    ['Store Opening SOP v3', 'SOP', null, 'store-opening-sop-v3.txt', 'text/plain', Buffer.from([
      'CONGRUENCE — STORE OPENING SOP (v3)', '', '1. Arrive 30 minutes before opening time.', '2. Disarm the alarm and open the shutter at the scheduled time.',
      '3. Switch on signage, window and floor lights.', '4. Complete the "Store Opening Checklist" in Congruence Eye within 30 minutes.',
      '5. Verify cash float (INR 5,000 – 10,000) and POS terminals.', '6. Brief the team on the day\'s targets and zone allocation.', '',
    ].join('\n'))],
    ['Diwali 2026 Circular', 'CIRCULAR', null, 'diwali-2026-circular.pdf', 'application/pdf', minimalPdf([
      'Congruence - Diwali 2026 Circular', 'Extended hours: 9:30 AM - 10:30 PM from 1 Nov to 8 Nov.', 'Festive window display to be live by 20 Oct.', 'All billing counters must be staffed from 5 PM to close.', 'Queue alert threshold reduced to 5 people during the festive period.',
    ])],
    ["T Nagar Planogram — Women's Ethnic Wall", 'PLANOGRAM', stores[0].id, 'tnagar-planogram-womens-ethnic.txt', 'text/plain', Buffer.from([
      "PLANOGRAM: Women's Ethnic Wall — Congruence T Nagar", '', 'Bay 1: Silk sarees (Kanchipuram) — premium, face-out', 'Bay 2: Cotton sarees — folded, colour blocked light → dark',
      'Bay 3: Kurtis S–XXL — hanging, size sequence left → right', 'Bay 4: Dupattas & accessories', '',
    ].join('\n'))],
  ];
  for (const [title, category, storeId, fileName, mimeType, buf] of docs) {
    const storedName = `seed-${fileName}`;
    fs.writeFileSync(path.join(dir, storedName), buf);
    await ds.getRepository(DocumentFile).save({ title, category, storeId, fileName, storedName, mimeType, size: buf.length, uploadedById: people.admin });
  }
  return docs.length;
}

export async function seedSchedules(ds: DataSource, stores: SeedStore[], people: PeopleIds) {
  await ds.getRepository(ReportSchedule).save([
    { name: 'Daily Traffic Summary', type: 'traffic', format: 'xlsx', storeIds: [], frequency: 'DAILY', recipients: 'ops@congruence.in', isActive: true, createdById: people.admin },
    { name: 'Weekly Chennai Benchmark', type: 'benchmark', format: 'xlsx', storeIds: stores.filter((s) => s.def.region === 'Chennai').map((s) => s.id), frequency: 'WEEKLY', recipients: 'ceo@congruence.in, regional@congruence.in', isActive: true, createdById: people.regional },
  ]);
  return 2;
}
