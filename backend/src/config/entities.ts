import { DiscoveredDevice } from '../modules/recorders/entities/discovered-device.entity';
import { Probe } from '../modules/recorders/entities/probe.entity';
import { Recorder } from '../modules/recorders/entities/recorder.entity';
import { Zone as ZoneEntity } from '../modules/zones/entities/zone.entity';
import { AiDetection } from '../modules/ai-manager/entities/ai-detection.entity';
import { AiManagerRule } from '../modules/ai-manager/entities/ai-manager-rule.entity';
import { ChecklistSchedule } from '../modules/checklists/entities/checklist-schedule.entity';
import { Recap } from '../modules/media/entities/recap.entity';
import { Snapshot } from '../modules/media/entities/snapshot.entity';
import { Alert } from '../modules/alerts/entities/alert.entity';
import { AlertRule } from '../modules/alerts/entities/alert-rule.entity';
import { Notification } from '../modules/alerts/entities/notification.entity';
import { HourlyStoreMetric } from '../modules/analytics/entities/hourly-store-metric.entity';
import { HourlyZoneMetric } from '../modules/analytics/entities/hourly-zone-metric.entity';
import { Visit } from '../modules/analytics/entities/visit.entity';
import { ZoneTransition } from '../modules/analytics/entities/zone-transition.entity';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';
import { CameraStatusLog } from '../modules/cameras/entities/camera-status-log.entity';
import { Camera } from '../modules/cameras/entities/camera.entity';
import { ChecklistAnswer } from '../modules/checklists/entities/checklist-answer.entity';
import { ChecklistAssignment } from '../modules/checklists/entities/checklist-assignment.entity';
import { ChecklistQuestion } from '../modules/checklists/entities/checklist-question.entity';
import { ChecklistSubmission } from '../modules/checklists/entities/checklist-submission.entity';
import { ChecklistTemplate } from '../modules/checklists/entities/checklist-template.entity';
import { DocumentFile } from '../modules/documents/entities/document.entity';
import { EdgeDevice } from '../modules/edge-devices/entities/edge-device.entity';
import { HeatmapFrame } from '../modules/ingest/entities/heatmap-frame.entity';
import { QueueSnapshot } from '../modules/ingest/entities/queue-snapshot.entity';
import { StoreOpsEvent } from '../modules/ingest/entities/storeops-event.entity';
import { VisitorEvent } from '../modules/ingest/entities/visitor-event.entity';
import { IngestBatch } from '../modules/ingest/entities/ingest-batch.entity';
import { PosTransaction } from '../modules/pos/entities/pos-transaction.entity';
import { Region } from '../modules/regions/entities/region.entity';
import { ReportSchedule } from '../modules/reports/entities/report-schedule.entity';
import { Setting } from '../modules/settings/entities/setting.entity';
import { Staff } from '../modules/staff/entities/staff.entity';
import { Store } from '../modules/stores/entities/store.entity';
import { Task } from '../modules/tasks/entities/task.entity';
import { TicketComment } from '../modules/tickets/entities/ticket-comment.entity';
import { Ticket } from '../modules/tickets/entities/ticket.entity';
import { UserStore } from '../modules/users/entities/user-store.entity';
import { User } from '../modules/users/entities/user.entity';
import { Vendor } from '../modules/vendors/entities/vendor.entity';
import { VendorVisit } from '../modules/vendors/entities/vendor-visit.entity';

export const ENTITIES = [
  Region, Store, User, UserStore, Camera, CameraStatusLog, ZoneEntity, EdgeDevice, Staff, Setting, AuditLog,
  VisitorEvent, QueueSnapshot, HeatmapFrame, StoreOpsEvent, Visit, HourlyStoreMetric, HourlyZoneMetric, ZoneTransition,
  PosTransaction, AlertRule, Alert, Notification,
  ChecklistTemplate, ChecklistQuestion, ChecklistAssignment, ChecklistSubmission, ChecklistAnswer,
  Task, Ticket, TicketComment, DocumentFile, Vendor, VendorVisit, ReportSchedule,
  Snapshot, Recap, ChecklistSchedule, AiManagerRule, AiDetection,
  Recorder, Probe, DiscoveredDevice, IngestBatch,
];

