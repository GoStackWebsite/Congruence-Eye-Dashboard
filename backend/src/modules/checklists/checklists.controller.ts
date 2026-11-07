import { ParseIdPipe } from '../../common/parse-id.pipe';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import { parseIds } from '../../common/paging';
import { StoreScopeService } from '../../common/store-scope.service';
import { AiCheckService } from './ai-check.service';
import { TraxDashboardService } from './dashboard.service';
import { SchedulesService } from './schedules.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/decorators';
import { ADMINS, ASSIGNMENT_WRITERS, AuthUser, REVIEWERS, TEMPLATE_WRITERS } from '../../common/roles';
import { ChecklistsService } from './checklists.service';
import { AnswerTaskDto, AssignmentDto, DraftDto, ReviewDto, ChecklistScheduleDto, SubmissionDto, TemplateDto, UpdateChecklistScheduleDto } from './dto/checklist.dto';

type Q = Record<string, unknown>;

@ApiTags('checklists')
@ApiBearerAuth()
@Controller('checklists')
export class ChecklistsController {
  constructor(
    private readonly svc: ChecklistsService,
    private readonly schedules: SchedulesService,
    private readonly dashboardSvc: TraxDashboardService,
    private readonly ai: AiCheckService,
    private readonly scope: StoreScopeService,
  ) {}

  @Get('templates') templates(@Query() q: Q) {
    return this.svc.listTemplates(q);
  }
  @Post('templates') @Roles(...TEMPLATE_WRITERS) createTemplate(@CurrentUser() u: AuthUser, @Body() dto: TemplateDto) {
    return this.svc.createTemplate(u, dto);
  }
  @Get('templates/:id') template(@Param('id', ParseIdPipe) id: number) {
    return this.svc.getTemplate(id);
  }
  @Put('templates/:id') @Roles(...TEMPLATE_WRITERS) replace(@Param('id', ParseIdPipe) id: number, @Body() dto: TemplateDto) {
    return this.svc.replaceTemplate(id, dto);
  }
  @Delete('templates/:id') @Roles(...TEMPLATE_WRITERS) remove(@Param('id', ParseIdPipe) id: number) {
    return this.svc.deleteTemplate(id);
  }

  @Get('assignments') assignments(@CurrentUser() u: AuthUser, @Query() q: Q) {
    return this.svc.listAssignments(u, q);
  }
  @Post('assignments') @Roles(...ASSIGNMENT_WRITERS) createAssignment(@CurrentUser() u: AuthUser, @Body() dto: AssignmentDto) {
    return this.svc.createAssignment(u, dto);
  }
  @Get('assignments/:id') assignment(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.svc.getAssignment(u, id);
  }

  @Get('submissions') submissions(@CurrentUser() u: AuthUser, @Query() q: Q) {
    return this.svc.listSubmissions(u, q);
  }
  @Post('submissions') submit(@CurrentUser() u: AuthUser, @Body() dto: SubmissionDto) {
    return this.svc.submit(u, dto);
  }
  @Get('submissions/:id') submission(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.svc.getSubmission(u, id);
  }
  @Patch('submissions/:id/review') @Roles(...REVIEWERS) review(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: ReviewDto) {
    return this.svc.review(u, id, dto);
  }

  @Get('compliance') compliance(@CurrentUser() u: AuthUser, @Query() q: Q) {
    return this.svc.compliance(u, q);
  }

  // ---- v2: drafts, schedules, nudges, dashboard, deviations, AI preview
  @Post('assignments/:id/draft') @HttpCode(200) draft(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: DraftDto) {
    return this.svc.saveDraft(u, id, dto.answers);
  }
  @Get('schedules') listSchedules(@CurrentUser() u: AuthUser) {
    return this.schedules.list(u);
  }
  @Post('schedules') @Roles(...ASSIGNMENT_WRITERS) createSchedule(@CurrentUser() u: AuthUser, @Body() dto: ChecklistScheduleDto) {
    return this.schedules.create(u, dto);
  }
  @Patch('schedules/:id') @Roles(...ASSIGNMENT_WRITERS) updateSchedule(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: UpdateChecklistScheduleDto) {
    return this.schedules.update(u, id, dto);
  }
  @Delete('schedules/:id') @Roles(...ASSIGNMENT_WRITERS) deleteSchedule(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.schedules.remove(u, id);
  }
  @Post('schedules/:id/generate') @HttpCode(200) @Roles(...ASSIGNMENT_WRITERS) generate(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.schedules.generateNow(u, id);
  }
  @Post('nudges/run') @HttpCode(200) @Roles(...ADMINS) nudges() {
    return this.schedules.runNudges();
  }
  @Get('dashboard') async dashboard(@CurrentUser() u: AuthUser, @Query() q: Q) {
    return this.dashboardSvc.build(await this.scope.resolve(u, parseIds(q.storeIds)), q);
  }
  @Post('answers/:answerId/task') @Roles(...REVIEWERS) answerTask(@CurrentUser() u: AuthUser, @Param('answerId', ParseIdPipe) answerId: number, @Body() dto: AnswerTaskDto) {
    return this.svc.taskFromAnswer(u, answerId, dto);
  }
  @Post('ai-check')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async aiCheck(@UploadedFile() image: Express.Multer.File, @Body('type') type: string, @Body('referenceUrl') referenceUrl?: string) {
    if (!image?.buffer?.length) throw new BadRequestException('image is required');
    if (type !== 'REFERENCE_MATCH' && type !== 'UNIFORM') throw new BadRequestException('type must be REFERENCE_MATCH or UNIFORM');
    let reference: Buffer | null = null;
    if (type === 'REFERENCE_MATCH') {
      if (!referenceUrl) return { status: 'SKIPPED', score: 0, message: 'No reference image provided', issues: [] as string[] };
      try {
        reference = await this.ai.load(referenceUrl);
      } catch (e) {
        return { status: 'ERROR', score: 0, message: (e as Error).message, issues: [] as string[] };
      }
    }
    return this.ai.check(type, image.buffer, reference);
  }
}
