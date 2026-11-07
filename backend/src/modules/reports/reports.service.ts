import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { toCsv } from '../../common/csv';
import { toIso } from '../../common/db-types';
import { LookupService } from '../../common/lookup.service';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { addDays, DEFAULT_TZ, localParts, pct, round, safeDiv, todayLocal, zonedToUtc } from '../../common/time.util';
import { uploadDir } from '../../config/database.config';
import { Alert } from '../alerts/entities/alert.entity';
import { NotifierService } from '../alerts/notifier.service';
import { Range } from '../analytics/analytics.query';
import { AnalyticsService, sumRows } from '../analytics/analytics.service';
import { HourlyStoreMetric } from '../analytics/entities/hourly-store-metric.entity';
import { ChecklistSubmission } from '../checklists/entities/checklist-submission.entity';
import { ChecklistTemplate } from '../checklists/entities/checklist-template.entity';
import { Task } from '../tasks/entities/task.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { CreateScheduleDto, REPORT_TYPES, UpdateScheduleDto } from './dto/report.dto';
import { ReportSchedule } from './entities/report-schedule.entity';

export interface ReportTable {
  title: string;
  columns: { key: string; header: string }[];
  rows: Record<string, unknown>[];
}

const cols = (spec: string) =>
  spec.split(',').map((s) => {
    const [key, header] = s.split(':');
    return { key: key.trim(), header: (header ?? key).trim() };
  });

export const MIME = { csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);
  constructor(
    private readonly ds: DataSource,
    private readonly analytics: AnalyticsService,
    private readonly lookup: LookupService,
    private readonly scope: StoreScopeService,
    private readonly notifier: NotifierService,
  ) {}

  private async perStoreDay(ids: number[], r: Range) {
    const rows = await this.analytics.storeRows(ids, r);
    const stores = await this.lookup.storeNames(ids);
    const groups = new Map<string, HourlyStoreMetric[]>();
    for (const x of rows) {
      const k = `${x.date}|${x.storeId}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, list]) => {
        const [date, sid] = k.split('|');
        return { date, storeId: Number(sid), storeName: stores.get(Number(sid)) ?? '', s: sumRows(list) };
      });
  }

  private range(r: Range) {
    return { from: zonedToUtc(r.from, '00:00', DEFAULT_TZ), to: new Date(zonedToUtc(r.to, '00:00', DEFAULT_TZ).getTime() + 86400_000) };
  }

  async build(type: string, ids: number[], r: Range): Promise<ReportTable> {
    const title = `${type}_${r.from}_${r.to}`;
    switch (type) {
      case 'traffic': {
        const rows = (await this.perStoreDay(ids, r)).map(({ date, storeName, s }) => ({
          date, storeName, footfallIn: s.footfallIn, footfallOut: s.footfallOut, uniqueVisitors: s.uniqueVisitors, staffExcluded: s.staffEntries,
          individuals: s.individuals, groups: s.groups, billableEntities: s.billableEntities, engaged: s.engaged, bounced: s.bounced,
          repeatVisitors: s.repeatVisitors, avgDwellSec: safeDiv(s.totalDwellSec, s.dwellCount, 1),
        }));
        return { title, rows, columns: cols('date:Date,storeName:Store,footfallIn:Footfall In,footfallOut:Footfall Out,uniqueVisitors:Unique Visitors,staffExcluded:Staff Excluded,individuals:Individuals,groups:Groups,billableEntities:Billable Entities,engaged:Engaged,bounced:Bounced,repeatVisitors:Repeat Visitors,avgDwellSec:Avg Dwell (s)') };
      }
      case 'zones': {
        const rows = (await this.analytics.zones(ids, r)) as unknown as Record<string, unknown>[];
        return { title, rows, columns: cols('storeName:Store,name:Zone,visits:Visits,uniqueVisitors:Unique Visitors,avgDwellSec:Avg Dwell (s),engaged:Engaged,engagedPct:Engaged %,male:Male,female:Female,classification:Class') };
      }
      case 'conversion': {
        const rows = (await this.perStoreDay(ids, r)).map(({ date, storeName, s }) => ({
          date, storeName, footfall: s.footfallIn, billableEntities: s.billableEntities, transactions: s.transactions,
          conversionPct: pct(s.transactions, s.billableEntities), revenue: s.revenue, atv: safeDiv(s.revenue, s.transactions),
          itemsSold: s.itemsSold, missedOpportunities: Math.max(0, s.engagedEntities - s.transactions),
        }));
        return { title, rows, columns: cols('date:Date,storeName:Store,footfall:Footfall,billableEntities:Billable Entities,transactions:Transactions,conversionPct:Conversion %,revenue:Revenue (INR),atv:ATV (INR),itemsSold:Items Sold,missedOpportunities:Missed Opportunities') };
      }
      case 'queue': {
        const rows = (await this.perStoreDay(ids, r))
          .filter(({ s }) => s.queueSamples > 0)
          .map(({ date, storeName, s }) => ({
            date, storeName, avgQueueLength: safeDiv(s.queueLenWeighted, s.queueSamples), maxQueueLength: s.maxQueueLength,
            avgWaitSec: safeDiv(s.waitWeighted, s.queueSamples, 1), maxWaitSec: round(s.maxWaitSec, 1), breaches: s.queueBreaches,
            unattendedMinutes: round(s.unattendedSec / 60, 1),
          }));
        return { title, rows, columns: cols('date:Date,storeName:Store,avgQueueLength:Avg Queue,maxQueueLength:Max Queue,avgWaitSec:Avg Wait (s),maxWaitSec:Max Wait (s),breaches:Breaches,unattendedMinutes:Unattended (min)') };
      }
      case 'storeops': {
        const so = await this.analytics.storeops(ids, r);
        return { title, rows: so.openClose, columns: cols('date:Date,storeName:Store,scheduledOpen:Scheduled Open,actualOpen:Actual Open,lateOpenMin:Late (min),scheduledClose:Scheduled Close,actualClose:Actual Close,earlyCloseMin:Early (min)') };
      }
      case 'benchmark': {
        const rows = (await this.analytics.benchmark(ids, r)) as unknown as Record<string, unknown>[];
        return { title, rows, columns: cols('rank:Rank,storeName:Store,regionName:Region,footfall:Footfall,footfallChangePct:Footfall Change %,conversionPct:Conversion %,revenue:Revenue (INR),atv:ATV (INR),revenuePerSqft:Revenue / sqft,avgDwellSec:Avg Dwell (s),avgQueueWaitSec:Avg Queue Wait (s),complianceScore:Compliance %') };
      }
      case 'checklists': {
        const subs = ids.length
          ? await this.ds.getRepository(ChecklistSubmission).createQueryBuilder('s').where('s.storeId IN (:...ids)', { ids }).andWhere('s.date >= :from AND s.date <= :to', r).orderBy('s.submittedAt', 'DESC').getMany()
          : [];
        const stores = await this.lookup.storeNames(ids);
        const users = await this.lookup.userNames(subs.map((s) => s.submittedById));
        const templates = new Map((await this.ds.getRepository(ChecklistTemplate).find()).map((t) => [t.id, t]));
        const rows = subs.map((s) => ({
          date: s.date, storeName: stores.get(s.storeId) ?? '', template: templates.get(s.templateId)?.name ?? '', category: templates.get(s.templateId)?.category ?? '',
          submittedBy: users.get(s.submittedById) ?? '', submittedAt: toIso(s.submittedAt), score: s.score, maxScore: s.maxScore, scorePct: s.scorePct, status: s.status,
        }));
        return { title, rows, columns: cols('date:Date,storeName:Store,template:Template,category:Category,submittedBy:Submitted By,submittedAt:Submitted At,score:Score,maxScore:Max Score,scorePct:Score %,status:Status') };
      }
      case 'alerts': {
        const { from, to } = this.range(r);
        const list = ids.length
          ? await this.ds.getRepository(Alert).createQueryBuilder('a').where('a.storeId IN (:...ids)', { ids }).andWhere('a.createdAt >= :from AND a.createdAt < :to', { from, to }).orderBy('a.createdAt', 'DESC').getMany()
          : [];
        const stores = await this.lookup.storeNames(ids);
        const rows = list.map((a) => ({ createdAt: toIso(a.createdAt), storeName: stores.get(a.storeId) ?? '', ruleName: a.ruleName, metric: a.metric, severity: a.severity, value: a.value, status: a.status, message: a.message, resolvedAt: toIso(a.resolvedAt) }));
        return { title, rows, columns: cols('createdAt:Created At,storeName:Store,ruleName:Rule,metric:Metric,severity:Severity,value:Value,status:Status,message:Message,resolvedAt:Resolved At') };
      }
      case 'tasks': {
        const { from, to } = this.range(r);
        const list = ids.length
          ? await this.ds.getRepository(Task).createQueryBuilder('t').where('t.storeId IN (:...ids)', { ids }).andWhere('t.createdAt >= :from AND t.createdAt < :to', { from, to }).orderBy('t.id', 'DESC').getMany()
          : [];
        const stores = await this.lookup.storeNames(ids);
        const users = await this.lookup.userNames(list.flatMap((t) => [t.assigneeId, t.createdById]));
        const rows = list.map((t) => ({ id: t.id, title: t.title, storeName: stores.get(t.storeId) ?? '', type: t.type, priority: t.priority, status: t.status, assignee: t.assigneeId ? users.get(t.assigneeId) : '', createdBy: users.get(t.createdById) ?? '', dueAt: toIso(t.dueAt), completedAt: toIso(t.completedAt), createdAt: toIso(t.createdAt) }));
        return { title, rows, columns: cols('id:ID,title:Title,storeName:Store,type:Type,priority:Priority,status:Status,assignee:Assignee,createdBy:Created By,dueAt:Due At,completedAt:Completed At,createdAt:Created At') };
      }
      case 'tickets': {
        const { from, to } = this.range(r);
        const list = ids.length
          ? await this.ds.getRepository(Ticket).createQueryBuilder('t').where('t.storeId IN (:...ids)', { ids }).andWhere('t.createdAt >= :from AND t.createdAt < :to', { from, to }).orderBy('t.id', 'DESC').getMany()
          : [];
        const stores = await this.lookup.storeNames(ids);
        const users = await this.lookup.userNames(list.flatMap((t) => [t.assigneeId, t.reporterId]));
        const now = Date.now();
        const rows = list.map((t) => ({ number: t.number, title: t.title, storeName: stores.get(t.storeId) ?? '', category: t.category, priority: t.priority, status: t.status, assignee: t.assigneeId ? users.get(t.assigneeId) : '', reporter: users.get(t.reporterId) ?? '', slaDueAt: toIso(t.slaDueAt), resolvedAt: toIso(t.resolvedAt), slaBreached: (t.resolvedAt ? t.resolvedAt.getTime() : now) > t.slaDueAt.getTime() ? 'YES' : 'NO', createdAt: toIso(t.createdAt) }));
        return { title, rows, columns: cols('number:Ticket,title:Title,storeName:Store,category:Category,priority:Priority,status:Status,assignee:Assignee,reporter:Reporter,slaDueAt:SLA Due,resolvedAt:Resolved At,slaBreached:SLA Breached,createdAt:Created At') };
      }
      default:
        throw new BadRequestException(`type must be one of ${REPORT_TYPES.join(', ')}`);
    }
  }

  async render(table: ReportTable, format: string): Promise<Buffer> {
    if (format === 'csv') return Buffer.from('﻿' + toCsv(table.columns, table.rows), 'utf8');
    if (format !== 'xlsx') throw new BadRequestException('format must be csv or xlsx');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Congruence Eye';
    wb.created = new Date();
    const ws = wb.addWorksheet(table.title.split('_')[0].slice(0, 31) || 'Report');
    ws.columns = table.columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(12, Math.min(40, c.header.length + 4)) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of table.rows) ws.addRow(Object.fromEntries(table.columns.map((c) => [c.key, r[c.key] ?? null])));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async export(type: string, format: string, ids: number[], r: Range) {
    if (!REPORT_TYPES.includes(type)) throw new BadRequestException(`type must be one of ${REPORT_TYPES.join(', ')}`);
    if (format !== 'csv' && format !== 'xlsx') throw new BadRequestException('format must be csv or xlsx');
    const table = await this.build(type, ids, r);
    return { buffer: await this.render(table, format), fileName: `${table.title}.${format}`, mime: MIME[format] };
  }

  // ---------------------------------------------------------------- schedules
  static scheduleView(s: ReportSchedule) {
    return { id: s.id, name: s.name, type: s.type, format: s.format, storeIds: s.storeIds ?? [], frequency: s.frequency, recipients: s.recipients, isActive: s.isActive, lastRunAt: toIso(s.lastRunAt) };
  }

  async listSchedules(user: AuthUser) {
    const rows = await this.ds.getRepository(ReportSchedule).find({ order: { id: 'ASC' } });
    return rows.filter((s) => !s.storeIds?.length || s.storeIds.some((id) => this.scope.canAccess(user, id))).map(ReportsService.scheduleView);
  }

  async createSchedule(user: AuthUser, dto: CreateScheduleDto) {
    for (const id of dto.storeIds ?? []) this.scope.assert(user, id);
    const repo = this.ds.getRepository(ReportSchedule);
    const s = await repo.save(repo.create({ ...dto, storeIds: dto.storeIds ?? [], recipients: dto.recipients ?? '', isActive: dto.isActive ?? true, createdById: user.id }));
    return ReportsService.scheduleView(s);
  }

  private async findSchedule(user: AuthUser, id: number) {
    const s = await this.ds.getRepository(ReportSchedule).findOne({ where: { id } });
    if (!s) throw new NotFoundException('Report schedule not found');
    for (const sid of s.storeIds ?? []) this.scope.assert(user, sid);
    return s;
  }

  async updateSchedule(user: AuthUser, id: number, dto: UpdateScheduleDto) {
    const s = await this.findSchedule(user, id);
    for (const sid of dto.storeIds ?? []) this.scope.assert(user, sid);
    Object.assign(s, dto);
    return ReportsService.scheduleView(await this.ds.getRepository(ReportSchedule).save(s));
  }

  async deleteSchedule(user: AuthUser, id: number) {
    await this.findSchedule(user, id);
    await this.ds.getRepository(ReportSchedule).delete(id);
    return { ok: true };
  }

  static periodFor(frequency: string, today: string): Range {
    const to = addDays(today, -1);
    const days = frequency === 'MONTHLY' ? 30 : frequency === 'WEEKLY' ? 7 : 1;
    return { from: addDays(to, -(days - 1)), to };
  }

  async runSchedule(user: AuthUser | null, id: number) {
    const s = user ? await this.findSchedule(user, id) : await this.ds.getRepository(ReportSchedule).findOne({ where: { id } });
    if (!s) throw new NotFoundException('Report schedule not found');
    const all = await this.scope.allStoreIds();
    const ids = s.storeIds?.length ? all.filter((x) => s.storeIds.includes(x)) : all;
    const r = ReportsService.periodFor(s.frequency, todayLocal(DEFAULT_TZ));
    const { buffer, fileName } = await this.export(s.type, s.format, ids, r);
    const dir = path.join(uploadDir(), 'reports');
    fs.mkdirSync(dir, { recursive: true });
    const stored = `${s.name.replace(/[^\w\-]+/g, '_').slice(0, 60)}-${fileName.replace(/\.(csv|xlsx)$/, '')}-${Date.now()}.${s.format}`;
    const full = path.join(dir, stored);
    fs.writeFileSync(full, buffer);
    const file = `/uploads/reports/${stored}`;
    await this.ds.getRepository(ReportSchedule).update(s.id, { lastRunAt: new Date(), lastFile: file });
    if (s.recipients && (await this.notifier.smtpConfigured())) {
      await this.notifier.sendMail(s.recipients.split(/[,;\s]+/), `[Congruence Eye] ${s.name} (${r.from} → ${r.to})`, `Attached: ${s.type} report for ${r.from} to ${r.to}.`, [{ filename: fileName, path: full }]);
    }
    return { ok: true, file };
  }

  /** Called hourly: runs schedules due at/after 07:00 (store time, default Asia/Kolkata). */
  async runDue(now = new Date()) {
    const local = localParts(now, DEFAULT_TZ);
    if (local.hour < 7) return 0;
    const day = Number(local.date.slice(8, 10));
    const list = await this.ds.getRepository(ReportSchedule).find({ where: { isActive: true } });
    let ran = 0;
    for (const s of list) {
      const last = s.lastRunAt ? localParts(s.lastRunAt, DEFAULT_TZ).date : null;
      if (last === local.date) continue;
      const due = s.frequency === 'DAILY' || (s.frequency === 'WEEKLY' && local.dow === 1) || (s.frequency === 'MONTHLY' && day === 1);
      if (!due) continue;
      try {
        await this.runSchedule(null, s.id);
        ran++;
      } catch (e) {
        this.log.warn(`schedule ${s.id} failed: ${(e as Error).message}`);
      }
    }
    return ran;
  }
}

