import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({ imports: [PipelineModule, AlertsModule], controllers: [PosController], providers: [PosService], exports: [PosService] })
export class PosModule {}
