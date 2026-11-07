import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { AuthUser, MANAGER_PLUS } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { parseAnalytics } from '../analytics/analytics.query';
import { CreateScheduleDto, UpdateScheduleDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly scope: StoreScopeService,
  ) {}

  @Get('export')
  @ApiQuery({ name: 'type', enum: ['traffic', 'zones', 'conversion', 'queue', 'storeops', 'benchmark', 'checklists', 'alerts', 'tasks', 'tickets'] })
  @ApiQuery({ name: 'format', enum: ['csv', 'xlsx'] })
  async export(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>, @Res() res: Response) {
    const p = parseAnalytics(q);
    const ids = await this.scope.resolve(u, p.storeIds);
    const { buffer, fileName, mime } = await this.reports.export(String(q.type ?? ''), String(q.format ?? 'csv'), ids, p);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Get('schedules') list(@CurrentUser() u: AuthUser) {
    return this.reports.listSchedules(u);
  }
  @Post('schedules') @Roles(...MANAGER_PLUS) create(@CurrentUser() u: AuthUser, @Body() dto: CreateScheduleDto) {
    return this.reports.createSchedule(u, dto);
  }
  @Patch('schedules/:id') @Roles(...MANAGER_PLUS) update(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number, @Body() dto: UpdateScheduleDto) {
    return this.reports.updateSchedule(u, id, dto);
  }
  @Delete('schedules/:id') @Roles(...MANAGER_PLUS) remove(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.reports.deleteSchedule(u, id);
  }
  @Post('schedules/:id/run') @HttpCode(200) @Roles(...MANAGER_PLUS) run(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.reports.runSchedule(u, id);
  }
}
