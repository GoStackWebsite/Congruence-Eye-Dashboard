import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { from, mergeMap, Observable, switchMap } from 'rxjs';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { AuthUser } from '../../common/roles';
import { AiManagerRule } from '../ai-manager/entities/ai-manager-rule.entity';
import { AlertRule } from '../alerts/entities/alert-rule.entity';
import { Alert } from '../alerts/entities/alert.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { ChecklistAssignment } from '../checklists/entities/checklist-assignment.entity';
import { ChecklistSchedule } from '../checklists/entities/checklist-schedule.entity';
import { ChecklistSubmission } from '../checklists/entities/checklist-submission.entity';
import { ChecklistTemplate } from '../checklists/entities/checklist-template.entity';
import { DocumentFile } from '../documents/entities/document.entity';
import { EdgeDevice } from '../edge-devices/entities/edge-device.entity';
import { Recorder } from '../recorders/entities/recorder.entity';
import { Region } from '../regions/entities/region.entity';
import { ReportSchedule } from '../reports/entities/report-schedule.entity';
import { SettingsService } from '../settings/settings.service';
import { Staff } from '../staff/entities/staff.entity';
import { Store } from '../stores/entities/store.entity';
import { Task } from '../tasks/entities/task.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { User } from '../users/entities/user.entity';
import { VendorVisit } from '../vendors/entities/vendor-visit.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Zone } from '../zones/entities/zone.entity';
import { AuditService } from './audit.service';

const ACTIONS: Record<string, string> = { POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' };
const SKIP = [/^\/api\/auth\/login/, /^\/api\/ingest\//, /^\/api\/notifications/, /^\/api\/stream/];

/** Audited entity (first URL segment, or first two for nested resources) → table, for before/after snapshots. */
const TARGETS: Record<string, EntityTarget<ObjectLiteral>> = {
  users: User, regions: Region, stores: Store, cameras: Camera, zones: Zone, staff: Staff, 'edge-devices': EdgeDevice,
  'alert-rules': AlertRule, alerts: Alert, tasks: Task, tickets: Ticket, vendors: Vendor, 'vendor-visits': VendorVisit, documents: DocumentFile,
  recorders: Recorder, 'checklists/templates': ChecklistTemplate, 'checklists/schedules': ChecklistSchedule,
  'checklists/assignments': ChecklistAssignment, 'checklists/submissions': ChecklistSubmission,
  'ai-manager/rules': AiManagerRule, 'reports/schedules': ReportSchedule,
};

/** Secret columns are left out of snapshots entirely (not even masked). */
const SECRET_COLUMN = /password|apikey|secret|token|hash|enc$/i;

/** Plain JSON copy of an entity row (dates → ISO), without secret columns. */
const plain = (o: unknown): Record<string, unknown> | null => {
  if (!o) return null;
  const row = JSON.parse(JSON.stringify(o)) as Record<string, unknown>;
  for (const k of Object.keys(row)) if (SECRET_COLUMN.test(k)) delete row[k];
  return row;
};

/** Only the fields that changed: { before: {k: old}, after: {k: new} }. */
export function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before || !after) return { before, after };
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === 'updatedAt') continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return { before: b, after: a };
}

/**
 * Writes an audit_logs row for every successful create/update/delete made by a user.
 * Updates and deletes also store the previous values: `details.before` / `details.after` hold the
 * changed fields only (secrets masked), so the audit diff no longer has to be rebuilt from earlier entries.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly log = new Logger(AuditInterceptor.name);
  constructor(
    private readonly audit: AuditService,
    private readonly ds: DataSource,
    private readonly settings: SettingsService,
  ) {}

  private async load(entity: string, id: number | null): Promise<Record<string, unknown> | null> {
    try {
      if (entity === 'settings') return plain(await this.settings.get());
      const target = TARGETS[entity];
      if (!target || !id) return null;
      return plain(await this.ds.getRepository(target).findOne({ where: { id } }));
    } catch (e) {
      this.log.warn(`audit snapshot failed: ${(e as Error).message}`);
      return null;
    }
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const method: string = req.method;
    const action = ACTIONS[method];
    const url: string = (req.originalUrl || req.url || '').split('?')[0];
    if (!action || SKIP.some((r) => r.test(url))) return next.handle();
    const segs = url.replace(/^\/api\//, '').split('/').filter(Boolean);
    const entity = segs[0] + (segs[1] && !/^\d+$/.test(segs[1]) ? '/' + segs[1] : '');
    const last = segs[segs.length - 1];
    const idParam = Number(req.params?.id);
    const wantsBefore = method !== 'POST' || segs.length > 2; // updates, deletes and actions on an existing record
    const before$ = from(wantsBefore ? this.load(entity, isFinite(idParam) && idParam > 0 ? idParam : null) : Promise.resolve(null));
    return before$.pipe(
      switchMap((before) =>
        next.handle().pipe(
          mergeMap(async (res: unknown) => {
            const user: AuthUser | undefined = req.user;
            if (!user) return res;
            const resId = res && typeof res === 'object' && 'id' in (res as object) ? Number((res as { id: unknown }).id) : null;
            const entityId = isFinite(idParam) && idParam > 0 ? idParam : resId;
            const act =
              segs.length > 2 && /^(ack|resolve|verify|status|review|run|rotate-key|check-in|check-out|ticket|comments|test|generate-cameras|draft|generate)$/.test(last)
                ? last.toUpperCase().replace(/-/g, '_')
                : action;
            const details: Record<string, unknown> = { method, path: url, body: req.body && Object.keys(req.body).length ? req.body : undefined };
            if (before) {
              const after = await this.load(entity, entityId);
              Object.assign(details, diff(before, after));
            }
            await this.audit.record(user, act, entity, entityId, details);
            return res;
          }),
        ),
      ),
    );
  }
}
