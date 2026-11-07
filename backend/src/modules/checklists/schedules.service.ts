import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { EventBusService } from '../../common/event-bus.service';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { addDays, daysInclusive, DEFAULT_TZ, dowOf, hhmm, localDate, todayLocal, zonedToUtc } from '../../common/time.util';
import { Notification } from '../alerts/entities/notification.entity';
import { SettingsService } from '../settings/settings.service';
import { Store } from '../stores/entities/store.entity';
import { User } from '../users/entities/user.entity';
import { ChecklistsService } from './checklists.service';
import { ChecklistScheduleDto, UpdateChecklistScheduleDto } from './dto/checklist.dto';
import { ChecklistAssignment } from './entities/checklist-assignment.entity';
import { ChecklistSchedule } from './entities/checklist-schedule.entity';
import { ChecklistTemplate } from './entities/checklist-template.entity';

/** Is the schedule due on a store-local date? */
export function scheduleDueOn(s: Pick<ChecklistSchedule, 'frequency' | 'repeatEvery' | 'daysOfWeek' | 'dayOfMonth' | 'startDate' | 'endDate'>, date: string): boolean {
  if (date < s.startDate || (s.endDate && date > s.endDate)) return false;
  const every = Math.max(1, s.repeatEvery || 1);
  const diff = daysInclusive(s.startDate, date) - 1;
  switch (s.frequency) {
    case 'ONCE':
      return date === s.startDate;
    case 'DAILY':
      return diff % every === 0;
    case 'WEEKLY': {
      const days = s.daysOfWeek?.length ? s.daysOfWeek : [dowOf(s.startDate)];
      return days.includes(dowOf(date)) && Math.floor(diff / 7) % every === 0;
    }
    case 'MONTHLY': {
      const [y, m, d] = date.split('-').map(Number);
      const [sy, sm, sd] = s.startDate.split('-').map(Number);
      const want = s.dayOfMonth ?? sd;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const months = (y - sy) * 12 + (m - sm);
      return d === Math.min(want, last) && months % every === 0;
    }
    default:
      return false;
  }
}

@Injectable()
export class SchedulesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
    private readonly checklists: ChecklistsService,
    private readonly settings: SettingsService,
    private readonly bus: EventBusService,
  ) {}
  private get repo() {
    return this.ds.getRepository(ChecklistSchedule);
  }

  async views(rows: ChecklistSchedule[]) {
    const ids = [...new Set(rows.map((r) => r.templateId))];
    const t = new Map((ids.length ? await this.ds.getRepository(ChecklistTemplate).find({ where: { id: In(ids) } }) : []).map((x) => [x.id, x.name]));
    return rows.map((s) => ({
      id: s.id,
      templateId: s.templateId,
      templateName: t.get(s.templateId) ?? '',
      storeIds: s.storeIds ?? [],
      assigneeId: s.assigneeId ?? null,
      frequency: s.frequency,
      repeatEvery: s.repeatEvery,
      daysOfWeek: s.daysOfWeek ?? [],
      dayOfMonth: s.dayOfMonth ?? null,
      windowStart: s.windowStart,
      windowEnd: s.windowEnd,
      startDate: s.startDate,
      endDate: s.endDate ?? null,
      reminderMinutesBefore: s.reminderMinutesBefore,
      isActive: s.isActive,
      lastGeneratedDate: s.lastGeneratedDate ?? null,
    }));
  }

  async list(user: AuthUser) {
    const rows = await this.repo.find({ order: { id: 'ASC' } });
    return this.views(rows.filter((s) => !s.storeIds?.length || s.storeIds.some((id) => this.scope.canAccess(user, id))));
  }

  private async validate(user: AuthUser, dto: Partial<ChecklistScheduleDto>, changed: Partial<ChecklistScheduleDto> = dto) {
    if (dto.templateId && !(await this.ds.getRepository(ChecklistTemplate).findOne({ where: { id: dto.templateId } }))) throw new BadRequestException('Unknown templateId');
    for (const id of dto.storeIds ?? []) await this.scope.assertStore(user, id);
    if (dto.assigneeId) {
      const u = await this.ds.getRepository(User).findOne({ where: { id: dto.assigneeId } });
      if (!u) throw new BadRequestException('Unknown assigneeId');
      if (changed.assigneeId !== undefined && !u.isActive) throw new BadRequestException('Assignee is inactive');
    }
    if (dto.windowStart && dto.windowEnd && dto.windowEnd <= dto.windowStart) throw new BadRequestException('windowEnd must be after windowStart (a window cannot cross midnight)');
    if (dto.endDate && dto.startDate && dto.endDate < dto.startDate) throw new BadRequestException('endDate must be on/after startDate');
    // an end date that already passed would never generate anything (checked against the earliest store-local today)
    if (changed.endDate && changed.endDate < addDays(todayLocal(DEFAULT_TZ), -1)) throw new BadRequestException('endDate is in the past');
    if (dto.frequency === 'WEEKLY' && (!dto.daysOfWeek || !dto.daysOfWeek.length)) throw new BadRequestException('WEEKLY schedules need at least one day in daysOfWeek');
  }

  async create(user: AuthUser, dto: ChecklistScheduleDto) {
    await this.validate(user, dto);
    if (dto.storeIds && !dto.storeIds.length) throw new BadRequestException('storeIds must list at least one store');
    const s = await this.repo.save(
      this.repo.create({
        ...dto,
        assigneeId: dto.assigneeId ?? null,
        repeatEvery: dto.repeatEvery ?? 1,
        daysOfWeek: dto.daysOfWeek ?? [],
        dayOfMonth: dto.dayOfMonth ?? null,
        endDate: dto.endDate ?? null,
        reminderMinutesBefore: dto.reminderMinutesBefore ?? (await this.settings.get()).checklistReminderMinutes,
        isActive: dto.isActive ?? true,
        createdById: user.id,
      }),
    );
    return (await this.views([s]))[0];
  }

  private async find(user: AuthUser, id: number) {
    const s = await this.repo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Schedule not found');
    for (const sid of s.storeIds ?? []) this.scope.assert(user, sid);
    return s;
  }

  async update(user: AuthUser, id: number, dto: UpdateChecklistScheduleDto) {
    const s = await this.find(user, id);
    await this.validate(
      user,
      {
        ...dto, windowStart: dto.windowStart ?? s.windowStart, windowEnd: dto.windowEnd ?? s.windowEnd, frequency: dto.frequency ?? s.frequency,
        daysOfWeek: dto.daysOfWeek ?? s.daysOfWeek, startDate: dto.startDate ?? s.startDate, endDate: dto.endDate === undefined ? s.endDate : dto.endDate,
      },
      dto,
    );
    if (dto.storeIds && !dto.storeIds.length) throw new BadRequestException('storeIds must list at least one store');
    Object.assign(s, dto);
    return (await this.views([await this.repo.save(s)]))[0];
  }

  async remove(user: AuthUser, id: number) {
    await this.find(user, id);
    await this.ds.getRepository(ChecklistAssignment).update({ scheduleId: id }, { scheduleId: null });
    await this.repo.delete(id);
    return { ok: true };
  }

  /**
   * Creates the assignments for `date` (idempotent per schedule + store + date). Without `date` every store
   * uses its own local today (a Dubai store is still on "yesterday" when Chennai passes midnight).
   * A deactivated (or out-of-store) fixed assignee falls back to the store's first active STORE_MANAGER.
   */
  async generateFor(s: ChecklistSchedule, forDate?: string, now = new Date()): Promise<number> {
    if (!s.isActive) return 0;
    const stores = await this.ds.getRepository(Store).find({ where: s.storeIds?.length ? { id: In(s.storeIds), isActive: true } : { isActive: true }, order: { id: 'ASC' } });
    const fixed = s.assigneeId ? await this.ds.getRepository(User).findOne({ where: { id: s.assigneeId } }) : null;
    let created = 0;
    let lastDate: string | null = null;
    for (const st of stores) {
      const day = forDate ?? localDate(now, st.timezone || DEFAULT_TZ);
      if (!scheduleDueOn(s, day)) continue;
      lastDate = day;
      if (await this.ds.getRepository(ChecklistAssignment).findOne({ select: { id: true }, where: { scheduleId: s.id, dueDate: day, storeId: st.id } })) continue;
      const fixedOk = fixed && fixed.isActive && (await this.checklists.userCanWorkAt(fixed.id, fixed.role, st.id));
      const assigneeId = fixedOk ? fixed.id : (await this.checklists.managersOf(st.id))[0];
      if (!assigneeId) continue;
      const date = day;
      const dueAt = zonedToUtc(date, s.windowEnd, st.timezone || DEFAULT_TZ);
      await this.ds.getRepository(ChecklistAssignment).save({
        templateId: s.templateId, storeId: st.id, assigneeId, assignedById: s.createdById ?? null, dueDate: date,
        dueAt, windowStart: zonedToUtc(date, s.windowStart, st.timezone || DEFAULT_TZ), scheduleId: s.id,
        status: dueAt.getTime() < now.getTime() ? 'OVERDUE' : 'PENDING', submissionId: null,
      });
      created++;
    }
    if (lastDate && s.lastGeneratedDate !== lastDate) await this.repo.update(s.id, { lastGeneratedDate: lastDate });
    return created;
  }

  async generateNow(user: AuthUser, id: number) {
    const s = await this.find(user, id);
    return { created: await this.generateFor(s) };
  }

  /** Cron: generate today's instances (store-local today) for every active schedule. Idempotent. */
  async generateDue(now = new Date()): Promise<number> {
    let n = 0;
    for (const s of await this.repo.find({ where: { isActive: true } })) n += await this.generateFor(s, undefined, now);
    return n;
  }

  /** Nudges: one reminder before the deadline + overdue processing. */
  async runNudges(now = new Date()): Promise<{ reminders: number; overdue: number }> {
    const defaultMin = (await this.settings.get()).checklistReminderMinutes;
    const open = await this.ds
      .getRepository(ChecklistAssignment)
      .createQueryBuilder('a')
      .where('a.status IN (:...st)', { st: ['PENDING', 'IN_PROGRESS', 'REDO'] })
      .andWhere('a.remindedAt IS NULL AND a.dueAt IS NOT NULL AND a.dueAt > :now', { now })
      .getMany();
    const schedules = new Map((await this.repo.find()).map((s) => [s.id, s.reminderMinutesBefore]));
    const templates = new Map((await this.ds.getRepository(ChecklistTemplate).find()).map((t) => [t.id, t.name]));
    const stores = new Map((await this.ds.getRepository(Store).find()).map((s) => [s.id, s]));
    let reminders = 0;
    for (const a of open) {
      const minutes = a.scheduleId && schedules.has(a.scheduleId) ? schedules.get(a.scheduleId) : defaultMin;
      if (minutes <= 0 || a.dueAt.getTime() - now.getTime() > minutes * 60000) continue;
      const st = stores.get(a.storeId);
      const n = await this.ds.getRepository(Notification).save({
        userId: a.assigneeId,
        title: `Reminder: ${templates.get(a.templateId) ?? 'Checklist'}`.slice(0, 200),
        body: `${templates.get(a.templateId) ?? 'Checklist'} at ${st?.name ?? ''} is due at ${hhmm(a.dueAt, st?.timezone)}`.slice(0, 1000),
        link: `/checklists/assignments/${a.id}`,
        isRead: false,
      });
      await this.ds.getRepository(ChecklistAssignment).update(a.id, { remindedAt: now });
      this.bus.emit({ type: 'notification', userId: a.assigneeId, storeId: a.storeId, data: { id: n.id, title: n.title, body: n.body, link: n.link, isRead: false, createdAt: now.toISOString() } });
      reminders++;
    }
    const overdue = await this.checklists.markOverdue(now);
    return { reminders, overdue };
  }
}
