import { ParseIdPipe } from '../../common/parse-id.pipe';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/decorators';
import { ADMINS, AuthUser } from '../../common/roles';
import { AlertEngineService } from './alert-engine.service';
import { AlertsService } from './alerts.service';
import { CreateAlertRuleDto, UpdateAlertRuleDto } from './dto/alert.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('alerts')
@ApiBearerAuth()
@Controller()
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly engine: AlertEngineService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('alert-rules') rules(@CurrentUser() u: AuthUser) {
    return this.alerts.listRules(u);
  }
  @Post('alert-rules') @Roles(...ADMINS) createRule(@Body() dto: CreateAlertRuleDto) {
    return this.alerts.createRule(dto);
  }
  @Patch('alert-rules/:id') @Roles(...ADMINS) updateRule(@Param('id', ParseIdPipe) id: number, @Body() dto: UpdateAlertRuleDto) {
    return this.alerts.updateRule(id, dto);
  }
  @Delete('alert-rules/:id') @Roles(...ADMINS) deleteRule(@Param('id', ParseIdPipe) id: number) {
    return this.alerts.deleteRule(id);
  }

  @Get('alerts') list(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>) {
    return this.alerts.list(u, q);
  }
  @Post('alerts/evaluate') @HttpCode(200) @Roles(...ADMINS) async evaluate() {
    return { created: await this.engine.evaluate() };
  }
  @Patch('alerts/:id/ack') ack(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.alerts.ack(u, id);
  }
  @Patch('alerts/:id/resolve') resolve(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.alerts.resolve(u, id);
  }
  @Post('alerts/:id/ticket') ticket(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.alerts.toTicket(u, id);
  }

  @Get('notifications') notificationsList(@CurrentUser() u: AuthUser) {
    return this.notifications.list(u.id);
  }
  @Patch('notifications/:id/read') read(@CurrentUser() u: AuthUser, @Param('id', ParseIdPipe) id: number) {
    return this.notifications.read(u.id, id);
  }
  @Post('notifications/read-all') @HttpCode(200) readAll(@CurrentUser() u: AuthUser) {
    return this.notifications.readAll(u.id);
  }
}
