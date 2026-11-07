import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { toIso } from '../../common/db-types';
import { LookupService } from '../../common/lookup.service';
import { parseBool, parseIds, parseIntOpt, qstr } from '../../common/paging';
import { ASSIGNMENT_WRITERS, AuthUser, Role } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { addDays, isDateStr, localDate, round, todayLocal, zonedToUtc } from '../../common/time.util';
import { Store } from '../stores/entities/store.entity';
import { User } from '../users/entities/user.entity';
import { AnswerDto, AnswerTaskDto, AssignmentDto, QuestionDto, ReviewDto, SubmissionDto, TemplateDto } from './dto/checklist.dto';
import { AiResult } from './entities/checklist-answer.entity';
import { AiCheckService } from './ai-check.service';
import { AlertEngineService } from '../alerts/alert-engine.service';
import { Notification } from '../alerts/entities/notification.entity';
import { TasksService } from '../tasks/tasks.service';
import { UserStore } from '../users/entities/user-store.entity';
import { EventBusService } from '../../common/event-bus.service';
import { bulkInsert } from '../../common/bulk';
import { KeyedLock } from '../../common/lock';
import { ChecklistAnswer } from './entities/checklist-answer.entity';
import { ChecklistAssignment } from './entities/checklist-assignment.entity';
import { ChecklistQuestion } from './entities/checklist-question.entity';
import { ChecklistSubmission } from './entities/checklist-submission.entity';
import { ChecklistTemplate } from './entities/checklist-template.entity';
import { isAnswered, isFlagged, normaliseValue, scoreAnswer } from './scoring';

@Injectable()
export class ChecklistsService {
  private readonly draftLock = new KeyedLock();
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
    private readonly lookup: LookupService,
    private readonly ai: AiCheckService,
    private readonly alerts: AlertEngineService,
    private readonly tasks: TasksService,
    private readonly bus: EventBusService,
  ) {}

  // ------------------------------------------------------------ templates
  static questionView(q: ChecklistQuestion) {
    return {
      id: q.id,
      section: q.section,
      text: q.text,
      type: q.type,
      options: q.options ?? [],
      correctOptions: q.correctOptions ?? [],
      required: q.required,
      weight: q.weight,
      requiresPhoto: q.requiresPhoto,
      sortOrder: q.sortOrder,
      minValue: q.minValue ?? null,
      maxValue: q.maxValue ?? null,
      referenceImageUrl: q.referenceImageUrl ?? null,
      aiCheck: q.aiCheck ?? 'NONE',
      createTaskOnFail: !!q.createTaskOnFail,
    };
  }

  private async templateViews(rows: ChecklistTemplate[]) {
    const qs = rows.length
      ? await this.ds.getRepository(ChecklistQuestion).find({ where: { templateId: In(rows.map((r) => r.id)), isActive: true }, order: { sortOrder: 'ASC', id: 'ASC' } })
      : [];
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      frequency: t.frequency,
      isActive: t.isActive,
      version: t.version ?? 1,
      createdAt: toIso(t.createdAt),
      questions: qs.filter((q) => q.templateId === t.id).map(ChecklistsService.questionView),
    }));
  }

  async listTemplates(q: Record<string, unknown>) {
    const where: Record<string, unknown> = {};
    if (q.category) where.category = qstr(q.category);
    if (q.isActive !== undefined) where.isActive = parseBool(q.isActive);
    return this.templateViews(await this.ds.getRepository(ChecklistTemplate).find({ where, order: { id: 'ASC' } }));
  }

  async getTemplate(id: number) {
    const t = await this.ds.getRepository(ChecklistTemplate).findOne({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    return (await this.templateViews([t]))[0];
  }

  private validateQuestions(qs: QuestionDto[]) {
    for (const q of qs) {
      if (q.minValue !== null && q.minValue !== undefined && q.maxValue !== null && q.maxValue !== undefined && q.minValue > q.maxValue) throw new BadRequestException(`minValue must be <= maxValue ("${q.text}")`);
      if (q.options?.length && new Set(q.options).size !== q.options.length) throw new BadRequestException(`duplicate options in "${q.text}"`);
      if (q.aiCheck && q.aiCheck !== 'NONE' && q.type !== 'PHOTO') throw new BadRequestException(`aiCheck is only supported on PHOTO questions ("${q.text}")`);
      if (q.aiCheck === 'REFERENCE_MATCH' && !q.referenceImageUrl) throw new BadRequestException(`REFERENCE_MATCH question "${q.text}" needs referenceImageUrl`);
      if ((q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI') && !(q.options?.length)) throw new BadRequestException(`MCQ question "${q.text}" needs options`);
      for (const c of q.correctOptions ?? []) if (!q.options?.includes(c)) throw new BadRequestException(`correct option "${c}" not in options`);
    }
  }

  private questionRow(templateId: number, q: QuestionDto, i: number): Partial<ChecklistQuestion> {
    return {
      templateId,
      section: q.section || 'General',
      text: q.text,
      type: q.type,
      options: q.options ?? [],
      correctOptions: q.correctOptions ?? [],
      required: q.required ?? true,
      weight: q.weight ?? 1,
      requiresPhoto: q.requiresPhoto ?? (q.type === 'PHOTO' || q.type === 'VIDEO'),
      sortOrder: q.sortOrder ?? i + 1,
      minValue: q.minValue ?? null,
      maxValue: q.maxValue ?? null,
      referenceImageUrl: q.referenceImageUrl ?? null,
      aiCheck: q.aiCheck ?? 'NONE',
      createTaskOnFail: q.createTaskOnFail ?? false,
      isActive: true,
    };
  }

  async createTemplate(user: AuthUser, dto: TemplateDto) {
    this.validateQuestions(dto.questions);
    const repo = this.ds.getRepository(ChecklistTemplate);
    const t = await repo.save(
      repo.create({ name: dto.name, description: dto.description ?? '', category: dto.category, frequency: dto.frequency, isActive: dto.isActive ?? true, createdById: user.id }),
    );
    await this.ds.getRepository(ChecklistQuestion).insert(dto.questions.map((q, i) => this.questionRow(t.id, q, i)));
    return this.getTemplate(t.id);
  }

  /** PUT replaces the template; questions not present are retired (kept for historic answers). */
  async replaceTemplate(id: number, dto: TemplateDto) {
    this.validateQuestions(dto.questions);
    const repo = this.ds.getRepository(ChecklistTemplate);
    const t = await repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    Object.assign(t, { name: dto.name, description: dto.description ?? '', category: dto.category, frequency: dto.frequency, isActive: dto.isActive ?? t.isActive, version: (t.version ?? 1) + 1 });
    await repo.save(t);
    const qRepo = this.ds.getRepository(ChecklistQuestion);
    const existing = await qRepo.find({ where: { templateId: id } });
    const keep = new Set<number>();
    for (const [i, q] of dto.questions.entries()) {
      const row = this.questionRow(id, q, i);
      const match = q.id ? existing.find((e) => e.id === q.id) : undefined;
      if (match) {
        keep.add(match.id);
        await qRepo.update(match.id, row);
      } else await qRepo.insert(row);
    }
    const retire = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (retire.length) await qRepo.update({ id: In(retire) }, { isActive: false });
    return this.getTemplate(id);
  }

  async deleteTemplate(id: number) {
    const repo = this.ds.getRepository(ChecklistTemplate);
    const t = await repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Template not found');
    t.isActive = false;
    await repo.save(t);
    return { ok: true };
  }

  // ------------------------------------------------------------ assignments
  /**
   * Past-due PENDING / IN_PROGRESS assignments → OVERDUE, with a notification to the assignee and the
   * store's managers, then CHECKLIST_OVERDUE rule evaluation. Returns the number of assignments marked.
   */
  async markOverdue(now = new Date()): Promise<number> {
    const due = await this.ds
      .getRepository(ChecklistAssignment)
      .createQueryBuilder('a')
      .where('a.status IN (:...st)', { st: ['PENDING', 'IN_PROGRESS'] })
      .andWhere('((a.dueAt IS NOT NULL AND a.dueAt < :now) OR (a.dueAt IS NULL AND a.dueDate < :today))', { now, today: todayLocal() })
      .getMany();
    if (!due.length) return 0;
    for (let i = 0; i < due.length; i += 500) {
      await this.ds.getRepository(ChecklistAssignment).update({ id: In(due.slice(i, i + 500).map((a) => a.id)) }, { status: 'OVERDUE' });
    }
    // notify only recent misses (avoid flooding on historic backfills)
    const recent = due.filter((a) => !a.dueAt || now.getTime() - a.dueAt.getTime() < 24 * 3600_000);
    const templates = new Map((await this.ds.getRepository(ChecklistTemplate).find()).map((t) => [t.id, t.name]));
    const stores = await this.lookup.storeNames(recent.map((a) => a.storeId));
    const rows: Partial<Notification>[] = [];
    for (const a of recent) {
      const managers = await this.managersOf(a.storeId);
      for (const userId of new Set([a.assigneeId, ...managers])) {
        rows.push({ userId, title: `Overdue: ${templates.get(a.templateId) ?? 'Checklist'}`.slice(0, 200), body: `${templates.get(a.templateId) ?? 'Checklist'} at ${stores.get(a.storeId) ?? ''} was due ${a.dueAt ? a.dueAt.toISOString() : a.dueDate} and has not been submitted`.slice(0, 1000), link: `/checklists/assignments/${a.id}`, isRead: false });
      }
    }
    if (rows.length) await bulkInsert(this.ds.manager, Notification, rows);
    for (const n of rows) this.bus.emit({ type: 'notification', userId: n.userId, data: { title: n.title, body: n.body, link: n.link } });
    const storeIds = [...new Set(recent.map((a) => a.storeId))];
    if (storeIds.length) await this.alerts.evaluate(storeIds, now, ['CHECKLIST_OVERDUE']).catch(() => 0);
    return due.length;
  }

  async managersOf(storeId: number): Promise<number[]> {
    const rows = await this.ds
      .getRepository(User)
      .createQueryBuilder('u')
      .innerJoin(UserStore, 'us', 'us.userId = u.id')
      .where('us.storeId = :storeId AND u.role = :role AND u.isActive = :a', { storeId, role: 'STORE_MANAGER', a: true })
      .orderBy('u.id', 'ASC')
      .getMany();
    return rows.map((u) => u.id);
  }

  private async assignmentViews(rows: ChecklistAssignment[]) {
    const stores = await this.lookup.storeNames(rows.map((r) => r.storeId));
    const users = await this.lookup.userNames(rows.map((r) => r.assigneeId));
    const tIds = [...new Set(rows.map((r) => r.templateId))];
    const templates = new Map((tIds.length ? await this.ds.getRepository(ChecklistTemplate).find({ where: { id: In(tIds) } }) : []).map((t) => [t.id, t.name]));
    return rows.map((a) => ({
      id: a.id,
      templateId: a.templateId,
      templateName: templates.get(a.templateId) ?? '',
      storeId: a.storeId,
      storeName: stores.get(a.storeId) ?? '',
      assigneeId: a.assigneeId,
      assigneeName: users.get(a.assigneeId) ?? '',
      dueDate: a.dueDate,
      status: a.status,
      submissionId: a.submissionId ?? null,
      dueAt: toIso(a.dueAt),
      windowStart: toIso(a.windowStart),
      scheduleId: a.scheduleId ?? null,
    }));
  }

  async listAssignments(user: AuthUser, q: Record<string, unknown>) {
    await this.markOverdue();
    const ids = await this.scope.resolve(user, parseIds(q.storeIds), false);
    if (!ids.length) return [];
    const qb = this.ds.getRepository(ChecklistAssignment).createQueryBuilder('a').where('a.storeId IN (:...ids)', { ids });
    if (q.status) qb.andWhere('a.status IN (:...st)', { st: String(q.status).split(',') });
    if (parseBool(q.mine)) qb.andWhere('a.assigneeId = :me', { me: user.id });
    const tid = parseIntOpt(q.templateId);
    if (tid) qb.andWhere('a.templateId = :tid', { tid });
    if (isDateStr(q.from)) qb.andWhere('a.dueDate >= :from', { from: q.from });
    if (isDateStr(q.to)) qb.andWhere('a.dueDate <= :to', { to: q.to });
    qb.orderBy('a.dueDate', 'DESC').addOrderBy('a.id', 'DESC').take(1000);
    return this.assignmentViews(await qb.getMany());
  }

  async getAssignment(user: AuthUser, id: number) {
    await this.markOverdue();
    const a = await this.ds.getRepository(ChecklistAssignment).findOne({ where: { id } });
    if (!a) throw new NotFoundException('Assignment not found');
    this.scope.assert(user, a.storeId);
    return { ...(await this.assignmentViews([a]))[0], draftAnswers: a.draftAnswers ?? null, template: await this.getTemplate(a.templateId) };
  }

  /** Section-wise saving: stores partial answers and moves the assignment to IN_PROGRESS. */
  async saveDraft(user: AuthUser, id: number, answers: AnswerDto[]) {
    // concurrent saves (two sections saved at once, two devices) are serialised so no answer is lost
    await this.draftLock.run(`draft:${id}`, () => this.saveDraftNow(user, id, answers));
    return this.getAssignment(user, id);
  }

  private async saveDraftNow(user: AuthUser, id: number, answers: AnswerDto[]) {
    const repo = this.ds.getRepository(ChecklistAssignment);
    const a = await repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Assignment not found');
    this.scope.assert(user, a.storeId);
    if (a.assigneeId !== user.id && !ASSIGNMENT_WRITERS.includes(user.role as Role)) throw new ForbiddenException('Only the assignee can save a draft');
    if (a.status === 'SUBMITTED' || a.status === 'APPROVED') throw new ConflictException(`Assignment already ${a.status.toLowerCase()}`);
    const merged = new Map<number, unknown>(((a.draftAnswers ?? []) as { questionId: number }[]).map((x) => [x.questionId, x]));
    for (const x of answers) merged.set(x.questionId, { questionId: x.questionId, value: x.value ?? null, photoUrl: x.photoUrl ?? null, remark: x.remark ?? null });
    a.draftAnswers = [...merged.values()];
    if (a.status !== 'OVERDUE') a.status = 'IN_PROGRESS';
    await repo.update(a.id, { draftAnswers: a.draftAnswers, status: a.status });
  }

  async createAssignment(user: AuthUser, dto: AssignmentDto) {
    await this.scope.assertStore(user, dto.storeId);
    const t = await this.ds.getRepository(ChecklistTemplate).findOne({ where: { id: dto.templateId } });
    if (!t || !t.isActive) throw new BadRequestException('Unknown or inactive template');
    const assignee = await this.ds.getRepository(User).findOne({ where: { id: dto.assigneeId } });
    if (!assignee || !assignee.isActive) throw new BadRequestException('Unknown or inactive assignee');
    if (!(await this.userCanWorkAt(assignee.id, assignee.role, dto.storeId))) throw new BadRequestException('Assignee is not assigned to this store');
    const repo = this.ds.getRepository(ChecklistAssignment);
    const store = await this.ds.getRepository(Store).findOneByOrFail({ id: dto.storeId });
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : new Date(zonedToUtc(dto.dueDate, '23:59', store.timezone).getTime() + 59_000);
    const status = dueAt.getTime() < Date.now() ? 'OVERDUE' : 'PENDING';
    const a = await repo.save(
      repo.create({ templateId: dto.templateId, storeId: dto.storeId, assigneeId: dto.assigneeId, dueDate: dto.dueDate, dueAt, windowStart: dto.windowStart ? new Date(dto.windowStart) : null, assignedById: user.id, status, submissionId: null }),
    );
    return (await this.assignmentViews([a]))[0];
  }

  // ------------------------------------------------------------ submissions
  private async submissionViews(rows: ChecklistSubmission[], withAnswers = false) {
    const stores = await this.lookup.storeNames(rows.map((r) => r.storeId));
    const users = await this.lookup.userNames(rows.map((r) => r.submittedById));
    const tIds = [...new Set(rows.map((r) => r.templateId))];
    const templates = new Map((tIds.length ? await this.ds.getRepository(ChecklistTemplate).find({ where: { id: In(tIds) } }) : []).map((t) => [t.id, t.name]));
    const answers = withAnswers && rows.length ? await this.ds.getRepository(ChecklistAnswer).find({ where: { submissionId: In(rows.map((r) => r.id)) }, order: { id: 'ASC' } }) : [];
    return rows.map((s) => {
      const v: Record<string, unknown> = {
        id: s.id,
        assignmentId: s.assignmentId ?? null,
        templateId: s.templateId,
        templateName: templates.get(s.templateId) ?? '',
        storeId: s.storeId,
        storeName: stores.get(s.storeId) ?? '',
        submittedById: s.submittedById,
        submittedByName: users.get(s.submittedById) ?? '',
        submittedAt: toIso(s.submittedAt),
        score: s.score,
        maxScore: s.maxScore,
        scorePct: s.scorePct,
        status: s.status,
        reviewerComment: s.reviewerComment ?? null,
        flags: s.flags ?? 0,
        templateVersion: s.templateVersion ?? null,
        isLate: !!s.isLate,
      };
      if (withAnswers) {
        v.answers = answers
          .filter((a) => a.submissionId === s.id)
          .map((a) => ({ id: a.id, questionId: a.questionId, value: a.value ?? '', photoUrl: a.photoUrl ?? null, remark: a.remark ?? null, score: a.score, maxScore: a.maxScore, redo: a.redo, aiResult: a.aiResult ?? null, flagged: !!a.flagged }));
      }
      return v;
    });
  }

  async listSubmissions(user: AuthUser, q: Record<string, unknown>) {
    const ids = await this.scope.resolve(user, parseIds(q.storeIds), false);
    if (!ids.length) return [];
    const qb = this.ds.getRepository(ChecklistSubmission).createQueryBuilder('s').where('s.storeId IN (:...ids)', { ids });
    const tid = parseIntOpt(q.templateId);
    if (tid) qb.andWhere('s.templateId = :tid', { tid });
    if (isDateStr(q.from)) qb.andWhere('s.date >= :from', { from: q.from });
    if (isDateStr(q.to)) qb.andWhere('s.date <= :to', { to: q.to });
    if (q.status) qb.andWhere('s.status IN (:...st)', { st: String(q.status).split(',') });
    qb.orderBy('s.submittedAt', 'DESC').addOrderBy('s.id', 'DESC').take(1000);
    return this.submissionViews(await qb.getMany());
  }

  async getSubmission(user: AuthUser, id: number) {
    const s = await this.ds.getRepository(ChecklistSubmission).findOne({ where: { id } });
    if (!s) throw new NotFoundException('Submission not found');
    this.scope.assert(user, s.storeId);
    // the template as it was answered (snapshot), so later edits/retired questions do not break history
    return { ...(await this.submissionViews([s], true))[0], template: s.templateSnapshot ?? (await this.getTemplate(s.templateId)) };
  }

  async submit(user: AuthUser, dto: SubmissionDto, submittedAt = new Date()) {
    const store = await this.scope.assertStore(user, dto.storeId);
    const template = await this.ds.getRepository(ChecklistTemplate).findOne({ where: { id: dto.templateId } });
    if (!template) throw new BadRequestException('Unknown template');
    let assignment: ChecklistAssignment | null = null;
    if (dto.assignmentId) {
      assignment = await this.ds.getRepository(ChecklistAssignment).findOne({ where: { id: dto.assignmentId } });
      if (!assignment) throw new BadRequestException('Unknown assignment');
      if (assignment.templateId !== dto.templateId || assignment.storeId !== dto.storeId) throw new BadRequestException('Assignment does not match template/store');
      if (assignment.assigneeId !== user.id && !ASSIGNMENT_WRITERS.includes(user.role as Role)) throw new ForbiddenException('Only the assignee can submit');
      if (assignment.status === 'SUBMITTED' || assignment.status === 'APPROVED') throw new ConflictException(`Assignment already ${assignment.status.toLowerCase()}`);
    }
    const aiCache = new Map<string, Buffer | null>();
    const loadRef = async (url: string) => {
      if (!aiCache.has(url)) aiCache.set(url, await this.ai.load(url).catch((): null => null));
      return aiCache.get(url);
    };
    const questions = await this.ds.getRepository(ChecklistQuestion).find({ where: { templateId: template.id, isActive: true }, order: { sortOrder: 'ASC', id: 'ASC' } });
    const byQ = new Map(dto.answers.map((a) => [a.questionId, a]));
    for (const a of dto.answers) if (!questions.some((q) => q.id === a.questionId)) throw new BadRequestException(`questionId ${a.questionId} is not part of the template`);
    if (byQ.size !== dto.answers.length) throw new BadRequestException('Each question can be answered only once');
    this.validateAnswers(questions, byQ);
    const answerRows: Partial<ChecklistAnswer>[] = [];
    const missing: string[] = [];
    const missingIds: number[] = [];
    let score = 0;
    let maxScore = 0;
    let flags = 0;
    for (const q of questions) {
      const a = byQ.get(q.id);
      const value = a ? normaliseValue(q.type, a.value) : null;
      const answered = isAnswered(q.type, value, a?.photoUrl);
      if (q.required && !answered) {
        missing.push(q.text);
        missingIds.push(q.id);
      }
      maxScore += Number(q.weight);
      if (!a) continue;
      let s = answered ? scoreAnswer(q, value, a?.photoUrl) : 0;
      let flagged = isFlagged(q, value, a?.photoUrl);
      let aiResult: AiResult | null = null;
      const photo = a.photoUrl || (q.type === 'PHOTO' ? value : null);
      if (answered && photo && q.aiCheck && q.aiCheck !== 'NONE') {
        try {
          const image = await this.ai.load(photo);
          const ref = q.aiCheck === 'REFERENCE_MATCH' && q.referenceImageUrl ? await loadRef(q.referenceImageUrl) : null;
          aiResult = await this.ai.check(q.aiCheck, image, ref);
        } catch (e) {
          aiResult = { status: 'ERROR', score: 0, message: (e as Error).message, issues: [] };
        }
        if (aiResult.status === 'FAIL') {
          s = 0;
          flagged = true;
        }
      }
      if (flagged) flags++;
      score += s;
      answerRows.push({ questionId: q.id, value, photoUrl: a.photoUrl ?? null, remark: a.remark ?? null, score: s, maxScore: Number(q.weight), redo: false, aiResult, flagged });
    }
    if (missing.length) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: `Missing required answers: ${missing.join('; ')}`, missingQuestionIds: missingIds });
    const repo = this.ds.getRepository(ChecklistSubmission);
    const snapshot = (await this.templateViews([template]))[0];
    const sub = await repo.save(
      repo.create({
        assignmentId: assignment?.id ?? null,
        templateId: template.id,
        storeId: dto.storeId,
        submittedById: user.id,
        submittedAt,
        date: localDate(submittedAt, store.timezone),
        score: round(score, 2),
        maxScore: round(maxScore, 2),
        scorePct: maxScore > 0 ? round((score / maxScore) * 100, 2) : 0,
        status: 'SUBMITTED',
        flags,
        templateVersion: template.version ?? 1,
        templateSnapshot: snapshot as unknown as Record<string, unknown>,
        isLate: !!assignment?.dueAt && submittedAt.getTime() > assignment.dueAt.getTime(),
      }),
    );
    if (answerRows.length) await this.ds.getRepository(ChecklistAnswer).save(answerRows.map((r) => ({ ...r, submissionId: sub.id })));
    if (assignment) await this.ds.getRepository(ChecklistAssignment).update(assignment.id, { status: 'SUBMITTED', submissionId: sub.id, draftAnswers: null });
    if (flags) {
      // real-time deviation handling: auto tasks for createTaskOnFail questions + non-compliance rule
      const saved = await this.ds.getRepository(ChecklistAnswer).find({ where: { submissionId: sub.id, flagged: true } });
      const managerId = (await this.managersOf(dto.storeId))[0] ?? null;
      for (const ans of saved) {
        const q = questions.find((x) => x.id === ans.questionId);
        if (!q?.createTaskOnFail) continue;
        await this.tasks.createFromAnswer(user, {
          storeId: dto.storeId,
          answerId: ans.id,
          title: `Fix: ${q.text}`,
          description: `Flagged in "${template.name}" submission #${sub.id}${ans.aiResult?.message ? ` — AI: ${ans.aiResult.message}` : ''}`,
          assigneeId: managerId ?? user.id,
          priority: 'HIGH',
        });
      }
      await this.alerts.evaluate([dto.storeId], new Date(), ['CHECKLIST_NON_COMPLIANCE']).catch(() => 0);
    }
    return (await this.submissionViews([sub], true))[0];
  }

  async review(user: AuthUser, id: number, dto: ReviewDto) {
    const repo = this.ds.getRepository(ChecklistSubmission);
    const s = await repo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Submission not found');
    this.scope.assert(user, s.storeId);
    s.status = dto.status;
    s.reviewerComment = dto.comment ?? null;
    s.reviewedById = user.id;
    s.reviewedAt = new Date();
    await repo.save(s);
    const ansRepo = this.ds.getRepository(ChecklistAnswer);
    if (dto.status === 'REDO') {
      await ansRepo.update({ submissionId: id }, { redo: false });
      if (dto.redoQuestionIds?.length) await ansRepo.update({ submissionId: id, questionId: In(dto.redoQuestionIds) }, { redo: true });
    }
    if (s.assignmentId) await this.ds.getRepository(ChecklistAssignment).update(s.assignmentId, { status: dto.status });
    return (await this.submissionViews([s], true))[0];
  }

  /** POST /checklists/answers/:answerId/task — follow-up task from a checklist response. */
  async taskFromAnswer(user: AuthUser, answerId: number, dto: AnswerTaskDto) {
    const ans = await this.ds.getRepository(ChecklistAnswer).findOne({ where: { id: answerId } });
    if (!ans) throw new NotFoundException('Answer not found');
    const sub = await this.ds.getRepository(ChecklistSubmission).findOneByOrFail({ id: ans.submissionId });
    this.scope.assert(user, sub.storeId);
    const q = await this.ds.getRepository(ChecklistQuestion).findOne({ where: { id: ans.questionId } });
    return this.tasks.createFromAnswer(user, {
      storeId: sub.storeId,
      answerId,
      title: dto.title ?? `Follow-up: ${q?.text ?? 'checklist deviation'}`,
      description: `From checklist submission #${sub.id}${ans.remark ? ` — remark: ${ans.remark}` : ''}`,
      assigneeId: dto.assigneeId,
      dueAt: new Date(dto.dueAt),
      priority: dto.priority ?? 'MEDIUM',
    });
  }

  /** Answers must be valid for their question type (400 with the question ids), before anything is scored. */
  private validateAnswers(questions: ChecklistQuestion[], byQ: Map<number, AnswerDto>) {
    const bad: { questionId: number; reason: string }[] = [];
    for (const q of questions) {
      const a = byQ.get(q.id);
      if (!a) continue;
      const value = normaliseValue(q.type, a.value);
      const options = (q.options ?? []).map(String);
      if (value !== null) {
        if (q.type === 'YES_NO' && !['YES', 'NO'].includes(value.trim().toUpperCase())) bad.push({ questionId: q.id, reason: 'must be YES or NO' });
        if (q.type === 'MCQ_SINGLE' && !options.includes(value)) bad.push({ questionId: q.id, reason: 'not one of the options' });
        if (q.type === 'MCQ_MULTI') {
          const chosen: string[] = JSON.parse(value);
          if (chosen.some((c) => !options.includes(c))) bad.push({ questionId: q.id, reason: 'not one of the options' });
          if (q.type === 'MCQ_MULTI' && new Set(chosen).size !== chosen.length) bad.push({ questionId: q.id, reason: 'duplicate options' });
        }
        if (q.type === 'NUMBER' && !isFinite(Number(value))) bad.push({ questionId: q.id, reason: 'must be a number' });
        if (q.type === 'RATING' && !(isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 5)) bad.push({ questionId: q.id, reason: 'must be a rating from 0 to 5' });
      }
      // requiresPhoto: an answered question needs its evidence photo (PHOTO/VIDEO carry it in value or photoUrl)
      const answered = isAnswered(q.type, value, a.photoUrl);
      const photo = (a.photoUrl && a.photoUrl.trim()) || ((q.type === 'PHOTO' || q.type === 'VIDEO') && value);
      if (q.requiresPhoto && (answered || q.required) && !photo) bad.push({ questionId: q.id, reason: 'photo required' });
    }
    if (bad.length) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: `Invalid answers: ${bad.map((b) => `question ${b.questionId} ${b.reason}`).join('; ')}`,
        invalidAnswers: bad,
      });
    }
  }

  /** Admins work everywhere; everyone else only at their assigned stores (user_stores). */
  async userCanWorkAt(userId: number, role: string, storeId: number): Promise<boolean> {
    if (role === Role.SUPER_ADMIN || role === Role.ADMIN) return true;
    return !!(await this.ds.getRepository(UserStore).findOne({ where: { userId, storeId } }));
  }

  // ------------------------------------------------------------ compliance
  async compliance(user: AuthUser, q: Record<string, unknown>) {
    await this.markOverdue();
    const ids = await this.scope.resolve(user, parseIds(q.storeIds));
    if (!ids.length) return [];
    const to = isDateStr(q.to) ? q.to : todayLocal();
    const from = isDateStr(q.from) ? q.from : addDays(to, -6);
    const subs = await this.ds
      .getRepository(ChecklistSubmission)
      .createQueryBuilder('s')
      .where('s.storeId IN (:...ids)', { ids })
      .andWhere('s.date >= :from AND s.date <= :to', { from, to })
      .getMany();
    const overdue: { storeId: unknown; c: unknown }[] = await this.ds
      .getRepository(ChecklistAssignment)
      .createQueryBuilder('a')
      .select('a.storeId', 'storeId')
      .addSelect('COUNT(*)', 'c')
      .where('a.storeId IN (:...ids)', { ids })
      .andWhere('a.status = :st', { st: 'OVERDUE' })
      .andWhere('a.dueDate >= :from AND a.dueDate <= :to', { from, to })
      .groupBy('a.storeId')
      .getRawMany();
    const overdueBy = new Map(overdue.map((o) => [Number(o.storeId), Number(o.c)]));
    const templates = new Map((await this.ds.getRepository(ChecklistTemplate).find()).map((t) => [t.id, t.category]));
    const stores = new Map((await this.ds.getRepository(Store).find({ where: { id: In(ids) } })).map((s) => [s.id, s.name]));
    const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : 0);
    return ids.map((storeId) => {
      const mine = subs.filter((s) => s.storeId === storeId);
      const cats = new Map<string, number[]>();
      for (const s of mine) {
        const c = templates.get(s.templateId) ?? 'OTHER';
        if (!cats.has(c)) cats.set(c, []);
        cats.get(c).push(s.scorePct);
      }
      return {
        storeId,
        storeName: stores.get(storeId) ?? '',
        submissions: mine.length,
        avgScorePct: avg(mine.map((s) => s.scorePct)),
        overdue: overdueBy.get(storeId) ?? 0,
        byCategory: [...cats].map(([category, xs]) => ({ category, avgScorePct: avg(xs) })).sort((a, b) => a.category.localeCompare(b.category)),
      };
    });
  }
}
