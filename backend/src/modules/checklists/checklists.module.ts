import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { TasksModule } from '../tasks/tasks.module';
import { AiCheckService } from './ai-check.service';
import { ChecklistsController } from './checklists.controller';
import { ChecklistsService } from './checklists.service';
import { TraxDashboardService } from './dashboard.service';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [AlertsModule, TasksModule],
  controllers: [ChecklistsController],
  providers: [ChecklistsService, SchedulesService, TraxDashboardService, AiCheckService],
  exports: [ChecklistsService, SchedulesService, AiCheckService],
})
export class ChecklistsModule {}
