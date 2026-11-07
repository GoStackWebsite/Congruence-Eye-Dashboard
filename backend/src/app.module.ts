import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from './common/core.module';
import { AuthGuard } from './common/guards/auth.guard';
import { databaseOptions } from './config/database.config';
import { AiManagerModule } from './modules/ai-manager/ai-manager.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { MediaModule } from './modules/media/media.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { CamerasModule } from './modules/cameras/cameras.module';
import { ChecklistsModule } from './modules/checklists/checklists.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { PlatformModule } from './modules/platform.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { PosModule } from './modules/pos/pos.module';
import { RegionsModule } from './modules/regions/regions.module';
import { ReportsModule } from './modules/reports/reports.module';
import { StaffModule } from './modules/staff/staff.module';
import { StoresModule } from './modules/stores/stores.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { ZonesModule } from './modules/zones/zones.module';
import { RecordersModule } from './modules/recorders/recorders.module';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({ useFactory: () => databaseOptions() }),
    ScheduleModule.forRoot(),
    CoreModule,
    PlatformModule,
    RegionsModule,
    StoresModule,
    CamerasModule,
    ZonesModule,
    StaffModule,
    PipelineModule,
    IngestModule,
    PosModule,
    AnalyticsModule,
    AlertsModule,
    ChecklistsModule,
    TasksModule,
    TicketsModule,
    DocumentsModule,
    VendorsModule,
    ReportsModule,
    MediaModule,
    AiManagerModule,
    RecordersModule,
    JobsModule,
  ],
  providers: [
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
