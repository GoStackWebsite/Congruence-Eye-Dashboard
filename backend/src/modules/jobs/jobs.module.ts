import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { CamerasModule } from '../cameras/cameras.module';
import { ChecklistsModule } from '../checklists/checklists.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ReportsModule } from '../reports/reports.module';
import { JobsService } from './jobs.service';
import { MediaModule } from '../media/media.module';
import { RecordersModule } from '../recorders/recorders.module';

@Module({ imports: [AlertsModule, CamerasModule, PipelineModule, ReportsModule, ChecklistsModule, MediaModule, RecordersModule], providers: [JobsService] })
export class JobsModule {}
