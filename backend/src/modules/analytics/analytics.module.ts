import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { InfraController } from './infra.controller';
import { InfraService } from './infra.service';

@Module({ controllers: [AnalyticsController, InfraController], providers: [AnalyticsService, InfraService], exports: [AnalyticsService, InfraService] })
export class AnalyticsModule {}
