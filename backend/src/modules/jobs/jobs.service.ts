import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { addDays, localParts } from '../../common/time.util';
import { SchedulesService } from '../checklists/schedules.service';
import { Recap } from '../media/entities/recap.entity';
import { RecapsService } from '../media/recaps.service';
import { Store } from '../stores/entities/store.entity';
import { StoreScopeService } from '../../common/store-scope.service';
import { AlertEngineService } from '../alerts/alert-engine.service';
import { CameraStatusService } from '../cameras/camera-status.service';
import { ChecklistsService } from '../checklists/checklists.service';
import { AggregationService } from '../pipeline/aggregation.service';
import { VisitBuilderService } from '../pipeline/visit-builder.service';
import { ReportsService } from '../reports/reports.service';
import { SettingsService } from '../settings/settings.service';
import { ProbesService } from '../recorders/probes.service';
import { IngestBatchInterceptor } from '../ingest/ingest-batch.interceptor';

const disabled = () => process.env.DISABLE_CRON === 'true';

/** Background jobs. Disabled with DISABLE_CRON=true (tests). */
@Injectable()
export class JobsService {
  private readonly log = new Logger(JobsService.name);
  private busy = new Set<string>();
  constructor(
    private readonly alerts: AlertEngineService,
    private readonly cameras: CameraStatusService,
    private readonly visits: VisitBuilderService,
    private readonly aggregation: AggregationService,
    private readonly reports: ReportsService,
    private readonly checklists: ChecklistsService,
    private readonly settings: SettingsService,
    private readonly scope: StoreScopeService,
    private readonly schedules: SchedulesService,
    private readonly recaps: RecapsService,
    private readonly ds: DataSource,
    private readonly probes: ProbesService,
  ) {}

  private async once(name: string, fn: () => Promise<unknown>) {
    if (disabled() || this.busy.has(name)) return;
    this.busy.add(name);
    try {
      await fn();
    } catch (e) {
      this.log.warn(`${name} failed: ${(e as Error).message}`);
    } finally {
      this.busy.delete(name);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  everyMinute() {
    return this.once('minute', async () => {
      await this.cameras.markStale();
      await this.probes.expireStale();
      await this.alerts.evaluate();
    });
  }

  @Cron('0 */5 * * * *')
  everyFiveMinutes() {
    return this.once('rollup', async () => {
      const settings = await this.settings.get();
      const stale = await this.visits.closeStale(new Date(), settings);
      const ids = await this.scope.allStoreIds();
      await this.aggregation.recomputeCurrentHours(ids, stale, (s) => localParts(new Date(), s.timezone));
    });
  }

  /** Checklist schedules (today's instances) + nudges (reminders, overdue) every 5 minutes. */
  @Cron('30 */5 * * * *')
  checklistNudges() {
    return this.once('nudges', async () => {
      await this.schedules.generateDue();
      await this.schedules.runNudges();
    });
  }

  /** Recap videos: at 23:45 store-local build today's recap; also backfill yesterday's if missing. */
  @Cron('0 */15 * * * *')
  recapsJob() {
    return this.once('recaps', async () => {
      const stores = await this.ds.getRepository(Store).find({ where: { isActive: true } });
      for (const s of stores) {
        const p = localParts(new Date(), s.timezone);
        const targets: string[] = [];
        if (p.hour === 23 && p.minute >= 45) targets.push(p.date);
        const y = addDays(p.date, -1);
        if (!(await this.ds.getRepository(Recap).findOne({ where: { storeId: s.id, date: y } }))) targets.push(y);
        for (const date of targets) await this.recaps.generate(s.id, date).catch((): null => null);
      }
    });
  }

  @Cron('0 5 * * * *')
  hourly() {
    return this.once('hourly', async () => {
      await this.checklists.markOverdue();
      await this.reports.runDue();
      await IngestBatchInterceptor.purge(this.ds);
    });
  }
}
