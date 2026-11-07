import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({ imports: [AnalyticsModule, AlertsModule], controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}
