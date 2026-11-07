import 'reflect-metadata';
import { getMetadataStorage } from 'class-validator';
import { getMetadataArgsStorage } from 'typeorm';
import { AiRuleDto, DetectionDto } from '../modules/ai-manager/dto/ai-manager.dto';
import { AiDetection } from '../modules/ai-manager/entities/ai-detection.entity';
import { AiManagerRule } from '../modules/ai-manager/entities/ai-manager-rule.entity';
import { CreateAlertRuleDto } from '../modules/alerts/dto/alert.dto';
import { AlertRule } from '../modules/alerts/entities/alert-rule.entity';
import { CreateCameraDto } from '../modules/cameras/dto/camera.dto';
import { Camera } from '../modules/cameras/entities/camera.entity';
import { AnswerDto, ChecklistScheduleDto, QuestionDto, ReviewDto, TemplateDto } from '../modules/checklists/dto/checklist.dto';
import { ChecklistAnswer } from '../modules/checklists/entities/checklist-answer.entity';
import { ChecklistQuestion } from '../modules/checklists/entities/checklist-question.entity';
import { ChecklistSchedule } from '../modules/checklists/entities/checklist-schedule.entity';
import { ChecklistSubmission } from '../modules/checklists/entities/checklist-submission.entity';
import { ChecklistTemplate } from '../modules/checklists/entities/checklist-template.entity';
import { UploadDocumentDto } from '../modules/documents/dto/document.dto';
import { DocumentFile } from '../modules/documents/entities/document.entity';
import { CreateEdgeDeviceDto } from '../modules/edge-devices/dto/edge-device.dto';
import { EdgeDevice } from '../modules/edge-devices/entities/edge-device.entity';
import { CameraHeartbeatDto, HeartbeatDto, StoreOpsEventDto, VisitorEventDto } from '../modules/ingest/dto/ingest.dto';
import { StoreOpsEvent } from '../modules/ingest/entities/storeops-event.entity';
import { VisitorEvent } from '../modules/ingest/entities/visitor-event.entity';
import { CameraStatusLog } from '../modules/cameras/entities/camera-status-log.entity';
import { PosTransactionDto } from '../modules/pos/dto/pos.dto';
import { PosTransaction } from '../modules/pos/entities/pos-transaction.entity';
import { CreateRecorderDto, DiscoveredDeviceDto } from '../modules/recorders/dto/recorder.dto';
import { DiscoveredDevice } from '../modules/recorders/entities/discovered-device.entity';
import { Recorder } from '../modules/recorders/entities/recorder.entity';
import { RegionDto } from '../modules/regions/dto/region.dto';
import { Region } from '../modules/regions/entities/region.entity';
import { CreateScheduleDto } from '../modules/reports/dto/report.dto';
import { ReportSchedule } from '../modules/reports/entities/report-schedule.entity';
import { CreateStaffDto } from '../modules/staff/dto/staff.dto';
import { Staff } from '../modules/staff/entities/staff.entity';
import { CreateStoreDto } from '../modules/stores/dto/store.dto';
import { Store } from '../modules/stores/entities/store.entity';
import { BulkTaskDto, CreateTaskDto, TaskStatusDto } from '../modules/tasks/dto/task.dto';
import { Task } from '../modules/tasks/entities/task.entity';
import { CommentDto, CreateTicketDto } from '../modules/tickets/dto/ticket.dto';
import { TicketComment } from '../modules/tickets/entities/ticket-comment.entity';
import { Ticket } from '../modules/tickets/entities/ticket.entity';
import { CreateUserDto } from '../modules/users/dto/user.dto';
import { User } from '../modules/users/entities/user.entity';
import { CheckOutDto, CreateVendorDto, CreateVendorVisitDto } from '../modules/vendors/dto/vendor.dto';
import { VendorVisit } from '../modules/vendors/entities/vendor-visit.entity';
import { Vendor } from '../modules/vendors/entities/vendor.entity';
import { CreateZoneDto } from '../modules/zones/dto/zone.dto';
import { Zone } from '../modules/zones/entities/zone.entity';

/**
 * QA edge-case plan §5/§10: a DTO must never accept a longer string than its SQL Server column
 * (nvarchar(n) overflow = 500 "String or binary data would be truncated" in production only — SQLite does not
 * enforce lengths). For every DTO → entity pair, each @MaxLength must be ≤ the column length of the same
 * property, and every string column written from a DTO must have a @MaxLength.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cls = new (...a: any[]) => unknown;
const PAIRS: [Cls, Cls, Record<string, string>?][] = [
  [CreateStoreDto, Store], [RegionDto, Region], [CreateUserDto, User], [CreateCameraDto, Camera], [CreateZoneDto, Zone],
  [CreateEdgeDeviceDto, EdgeDevice], [CreateStaffDto, Staff], [CreateAlertRuleDto, AlertRule], [AiRuleDto, AiManagerRule],
  [DetectionDto, AiDetection], [TemplateDto, ChecklistTemplate], [QuestionDto, ChecklistQuestion], [AnswerDto, ChecklistAnswer],
  [ReviewDto, ChecklistSubmission, { comment: 'reviewerComment' }], [ChecklistScheduleDto, ChecklistSchedule],
  [CreateTaskDto, Task], [BulkTaskDto, Task], [TaskStatusDto, Task], [CreateTicketDto, Ticket], [CommentDto, TicketComment],
  [UploadDocumentDto, DocumentFile], [CreateVendorDto, Vendor], [CreateVendorVisitDto, VendorVisit], [CheckOutDto, VendorVisit],
  [CreateScheduleDto, ReportSchedule], [PosTransactionDto, PosTransaction], [CreateRecorderDto, Recorder], [DiscoveredDeviceDto, DiscoveredDevice],
  [VisitorEventDto, VisitorEvent], [StoreOpsEventDto, StoreOpsEvent], [HeartbeatDto, EdgeDevice], [CameraHeartbeatDto, CameraStatusLog],
];

function columnLengths(entity: Cls): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of getMetadataArgsStorage().columns) {
    if (c.target !== entity) continue;
    const len = c.options.length;
    if (['nvarchar', 'varchar'].includes(String(c.options.type)) && len !== undefined && /^\d+$/.test(String(len))) m.set(c.propertyName, Number(len));
  }
  return m;
}

function dtoRules(dto: Cls) {
  const metas = getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false);
  const max = new Map<string, number>();
  const strings = new Set<string>();
  for (const v of metas) {
    if (v.name === 'maxLength' || v.constraintCls?.name === 'MaxLength' || (v.type === 'customValidation' && v.name === 'maxLength')) max.set(v.propertyName, Number(v.constraints?.[0]));
    if (v.name === 'isString') strings.add(v.propertyName);
  }
  return { max, strings };
}

describe('DTO @MaxLength vs SQL Server column lengths', () => {
  it('the metadata readers see the rules (self-check)', () => {
    expect(dtoRules(CreateStoreDto).max.get('name')).toBe(150);
    expect(dtoRules(CreateStoreDto).strings.has('name')).toBe(true);
    expect(columnLengths(Store).get('name')).toBeGreaterThan(0);
    expect(columnLengths(Ticket).get('title')).toBeGreaterThan(0);
  });

  it.each(PAIRS.map(([d, e, alias]) => [d.name, e.name, d, e, alias ?? {}] as const))('%s → %s', (_d, _e, dto, entity, alias) => {
    const cols = columnLengths(entity);
    const { max, strings } = dtoRules(dto);
    const problems: string[] = [];
    for (const prop of strings) {
      const col = cols.get(alias[prop] ?? prop);
      if (col === undefined) continue; // not a bounded string column (text / json / not persisted as-is)
      const m = max.get(prop);
      if (m === undefined) problems.push(`${prop}: no @MaxLength (column nvarchar(${col}))`);
      else if (m > col) problems.push(`${prop}: @MaxLength(${m}) > column nvarchar(${col})`);
    }
    expect(problems).toEqual([]);
  });
});
