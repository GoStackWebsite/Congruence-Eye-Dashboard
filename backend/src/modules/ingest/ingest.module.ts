import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { CamerasModule } from '../cameras/cameras.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

@Module({ imports: [PipelineModule, AlertsModule, CamerasModule], controllers: [IngestController], providers: [IngestService], exports: [IngestService] })
export class IngestModule {}
