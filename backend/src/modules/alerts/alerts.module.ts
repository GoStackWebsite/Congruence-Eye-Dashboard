import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { AlertEngineService } from './alert-engine.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { NotificationsService } from './notifications.service';
import { NotifierService } from './notifier.service';
import { StreamController } from './stream.controller';

@Module({
  imports: [TicketsModule],
  controllers: [AlertsController, StreamController],
  providers: [AlertsService, AlertEngineService, NotifierService, NotificationsService],
  exports: [AlertEngineService, AlertsService, NotifierService],
})
export class AlertsModule {}
