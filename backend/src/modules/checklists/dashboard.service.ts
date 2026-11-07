import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { LookupService } from '../../common/lookup.service';
import { addDays, isDateStr, pct, round, todayLocal } from '../../common/time.util';
import { ChecklistAssignment } from './entities/checklist-assignment.entity';
import { ChecklistSubmission } from './entities/checklist-submission.entity';
import { ChecklistTemplate } from './entities/checklist-template.entity';

const SUBMITTED = ['SUBMITTED', 'APPROVED', 'REDO'];

/** Centralised Trax compliance dashboard (by checklist, store and user), over assignments due in range. */
@Injectable()
export class TraxDashboardService {
  constructor(
    private readonly ds: DataSource,
    private readonly lookup: LookupService,
  ) {}

  async build(ids: number[], q: { from?: unknown; to?: unknown }) {
    const to = isDateStr(q.to) ? q.to : todayLocal();
    const from = isDateStr(q.from) ? q.from : addDays(to, -6);
    const rows = ids.length
      ? await this.ds.getRepository(ChecklistAssignment).createQueryBuilder('a').where('a.storeId IN (:...ids)', { ids }).andWhere('a.dueDate >= :from AND a.dueDate <= :to', { from, to }).getMany()
      : [];
    const subIds = rows.map((a) => a.submissionId).filter((x): x is number => !!x);
    const subs = new Map<number, ChecklistSubmission>();
    for (let i = 0; i < subIds.length; i += 800) for (const s of await this.ds.getRepository(ChecklistSubmission).find({ where: { id: In(subIds.slice(i, i + 800)) } })) subs.set(s.id, s);
    const templates = new Map((await this.ds.getRepository(ChecklistTemplate).find()).map((t) => [t.id, t]));
    const stores = await this.lookup.storeNames(ids);
    const users = await this.lookup.userNames(rows.map((a) => a.assigneeId));

    const stat = (list: ChecklistAssignment[]) => {
      const done = list.filter((a) => SUBMITTED.includes(a.status) && a.submissionId && subs.has(a.submissionId));
      const scores = done.map((a) => subs.get(a.submissionId).scorePct);
      return {
        assigned: list.length,
        submitted: done.length,
        flags: done.reduce((s, a) => s + (subs.get(a.submissionId).flags ?? 0), 0),
        completionPct: pct(done.length, list.length),
        compliancePct: scores.length ? round(scores.reduce((x, y) => x + y, 0) / scores.length, 2) : 0,
      };
    };
    const group = <K>(key: (a: ChecklistAssignment) => K) => {
      const m = new Map<K, ChecklistAssignment[]>();
      for (const a of rows) {
        const k = key(a);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(a);
      }
      return m;
    };
    const all = stat(rows);
    return {
      activeChecklists: new Set(rows.filter((a) => templates.get(a.templateId)?.isActive).map((a) => a.templateId)).size,
      checklistInstances: rows.length,
      notSubmitted: rows.filter((a) => a.status === 'OVERDUE').length,
      open: rows.filter((a) => a.status === 'PENDING').length,
      inProgress: rows.filter((a) => a.status === 'IN_PROGRESS').length,
      submitted: all.submitted,
      completionScorePct: all.completionPct,
      complianceScorePct: all.compliancePct,
      totalFlags: all.flags,
      byChecklist: [...group((a) => a.templateId)]
        .map(([templateId, list]) => ({ templateId, name: templates.get(templateId)?.name ?? '', frequency: templates.get(templateId)?.frequency ?? '', stores: new Set(list.map((a) => a.storeId)).size, ...stat(list) }))
        .sort((a, b) => a.templateId - b.templateId),
      byStore: [...group((a) => a.storeId)].map(([storeId, list]) => ({ storeId, storeName: stores.get(storeId) ?? '', ...stat(list) })).sort((a, b) => a.storeId - b.storeId),
      byUser: [...group((a) => a.assigneeId)].map(([userId, list]) => ({ userId, name: users.get(userId) ?? '', ...stat(list) })).sort((a, b) => a.userId - b.userId),
    };
  }
}
