import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { AiManagerController, AiManagerIngestController } from './ai-manager.controller';
import { AiManagerService } from './ai-manager.service';

@Module({ imports: [AlertsModule], controllers: [AiManagerController, AiManagerIngestController], providers: [AiManagerService], exports: [AiManagerService] })
export class AiManagerModule {}
