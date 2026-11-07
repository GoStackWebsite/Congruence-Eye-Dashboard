/**
 * TypeScript mirror of docs/API_CONTRACT.md (v1).
 * Keep in sync with the contract — every service in the app codes against these shapes.
 */

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'REGIONAL_MANAGER' | 'STORE_MANAGER' | 'AUDITOR' | 'STAFF';
export const ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER', 'AUDITOR', 'STAFF'];

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}

// ---------- Health & Auth ----------
export interface Health {
  status: 'ok';
  db: string;
  time: string;
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  storeIds: number[];
  createdAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}
export interface LoginResponse {
  accessToken: string;
  user: User;
}
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UserCreate {
  email: string;
  name: string;
  role: Role;
  password: string;
  storeIds?: number[];
  isActive?: boolean;
}
export type UserUpdate = Partial<UserCreate>;

// ---------- Master data ----------
export type StoreFormat = 'HIGH_STREET' | 'MALL' | 'AIRPORT' | 'OUTLET' | 'KIOSK';
export const STORE_FORMATS: StoreFormat[] = ['HIGH_STREET', 'MALL', 'AIRPORT', 'OUTLET', 'KIOSK'];
export interface Region {
  id: number;
  name: string;
}

export interface Store {
  id: number;
  code: string;
  name: string;
  regionId: number;
  regionName: string;
  city: string;
  address: string;
  timezone: string;
  openTime: string; // HH:mm
  closeTime: string; // HH:mm
  areaSqft: number;
  format?: StoreFormat;
  isActive: boolean;
  latitude?: number | null;
  longitude?: number | null;
  createdAt: string;
}
export interface StoreDetail extends Store {
  cameras: Camera[];
  zones: Zone[];
}

export type CameraType = 'ENTRANCE' | 'ZONE' | 'BILLING' | 'GENERAL';
export type CameraStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
export interface Camera {
  id: number;
  storeId: number;
  name: string;
  rtspUrl: string;
  type: CameraType;
  status: CameraStatus;
  lastHeartbeatAt: string | null;
  isActive: boolean;
  fps?: number;
}

export type ZoneType = 'ENTRY_LINE' | 'SECTION' | 'QUEUE' | 'STAFF_ONLY' | 'SHELF';
export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
export type Point = [number, number];
export interface Zone {
  id: number;
  storeId: number;
  cameraId: number;
  name: string;
  type: ZoneType;
  polygon: Point[];
  inDirection?: Direction | null;
  engagedDwellSec: number;
  queueAlertLength?: number | null;
  queueAlertWaitSec?: number | null;
  referenceSnapshotId?: number | null;
  isActive: boolean;
}

export interface EdgeDevice {
  id: number;
  storeId: number;
  name: string;
  lastSeenAt: string | null;
  version: string | null;
  apiKeyPrefix: string;
  createdAt: string;
  apiKey?: string;
}

export interface Staff {
  id: number;
  storeId: number;
  code: string;
  name: string;
  designation: string;
  shiftStart: string;
  shiftEnd: string;
  isActive: boolean;
}

export interface Settings {
  engagedStoreDwellSec: number;
  bounceSec: number;
  repeatWindowDays: number;
  currency: string;
  companyName: string;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpFrom?: string | null;
  alertEmailEnabled: boolean;
  aiServiceUrl?: string | null;
  checklistReminderMinutes?: number;
}

export interface AuditLog {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: number | string | null;
  details: unknown;
  createdAt: string;
}

// ---------- Ingestion-ish shapes surfaced to UI ----------
export type VisitorEventType = 'ENTRY' | 'EXIT' | 'ZONE_ENTER' | 'ZONE_EXIT';
export type Gender = 'M' | 'F' | 'U';
export type AgeBand = '0-17' | '18-24' | '25-34' | '35-44' | '45-54' | '55+' | 'U';
export interface VisitorEvent {
  cameraId: number;
  zoneId?: number | null;
  type: VisitorEventType;
  ts: string;
  trackId: string;
  visitorId: string;
  isStaff?: boolean;
  groupId?: string | null;
  gender?: Gender;
  ageBand?: AgeBand;
  dwellSec?: number;
  // backend may enrich
  id?: number;
  zoneName?: string;
  cameraName?: string;
}

// ---------- POS ----------
export interface PosTransaction {
  id: number;
  storeId: number;
  storeName: string;
  billNo: string;
  ts: string;
  amount: number;
  itemsCount: number;
  staffCode: string | null;
}
export interface PosImportResult {
  accepted: number;
  duplicates: number;
  errors: string[];
}

// ---------- Analytics ----------
export interface AnalyticsQuery {
  storeIds?: number[];
  from?: string;
  to?: string;
  compare?: boolean;
}

/** Contract v4: ratios of nothing are null (shown "--"); changePct is null when either side is null. */
export interface Kpi {
  value: number | null;
  previous?: number | null;
  changePct?: number | null;
}
/** Contract v4 daily point flags: isPartial = store-local today ("so far"); hasData = any rollup for the date. */
export interface DailyFlags {
  isPartial?: boolean;
  hasData?: boolean;
}

export type OverviewKpiKey =
  | 'footfall'
  | 'uniqueVisitors'
  | 'billableEntities'
  | 'transactions'
  | 'conversionPct'
  | 'revenue'
  | 'atv'
  | 'avgDwellSec'
  | 'engagedPct'
  | 'bounceRatePct'
  | 'missedOpportunities'
  | 'avgQueueWaitSec'
  | 'complianceScore'
  | 'passBy'
  | 'captureRatePct'
  | 'openAlerts';

export interface Overview {
  kpis: Record<OverviewKpiKey, Kpi>;
  daily: ({ date: string; footfall: number; transactions: number; conversionPct: number | null; revenue: number } & DailyFlags)[];
}

export interface Traffic {
  totals: {
    footfallIn: number;
    /** People who crossed the street-side pass-by line; capture rate = footfallIn / passBy (null without a pass-by line). */
    passBy?: number;
    captureRatePct?: number | null;
    footfallOut: number;
    uniqueVisitors: number;
    staffExcluded: number;
    individuals: number;
    groups: number;
    billableEntities: number;
    engaged: number;
    casual: number;
    bounced: number;
    repeatVisitors: number;
    newVisitors: number;
    avgDwellSec: number;
  };
  daily: ({
    date: string;
    footfallIn: number;
    footfallOut: number;
    uniqueVisitors: number;
    billableEntities: number;
    engaged: number;
    bounced: number;
  } & DailyFlags)[];
  hourly: { hour: number; footfall: number; avgPerDay: number; bouncedPct?: number }[];
  peakHour: number;
  dayOfWeek: { dow: number; footfall: number; avgPerDay: number }[];
}

export interface Demographics {
  gender: { male: number; female: number; unknown: number };
  age: { band: string; count: number }[];
  genderByAge: { band: string; male: number; female: number }[];
}

export type ZoneClass = 'HOT' | 'WARM' | 'DEAD';
export interface ZoneAnalytics {
  id: number;
  storeId: number;
  storeName: string;
  name: string;
  type: ZoneType;
  visits: number;
  uniqueVisitors: number;
  avgDwellSec: number;
  engaged: number;
  engagedPct: number;
  male: number;
  female: number;
  classification: ZoneClass;
  bouncedPct?: number;
  concentrationPct?: number;
  dominantAgeBand?: string | null;
  genderSplit?: { malePct: number; femalePct: number };
}

export interface Heatmap {
  cameraId: number;
  width: number;
  height: number;
  grid: number[];
  max: number;
}

export interface JourneyHighlight {
  zoneName: string;
  value: number;
  label: string;
}
export interface Journey {
  nodes: { id: number; name: string }[];
  links: { source: number; target: number; count: number }[];
  totalFootfall?: number;
  highlights?: {
    highestFootfall: JourneyHighlight | null;
    highestImpression: JourneyHighlight | null;
    highestBounced: JourneyHighlight | null;
    highestEngaged: JourneyHighlight | null;
    highestDwell: JourneyHighlight | null;
  };
}

export interface Conversion {
  funnel: { footfall: number; billableEntities: number; engaged: number; transactions: number };
  segments: { bounced: number; missedOpportunities: number; converted: number };
  totals: { revenue: number; transactions: number; atv: number; conversionPct: number; itemsPerBill: number };
  daily: { date: string; billableEntities: number; transactions: number; conversionPct: number; revenue: number; atv: number }[];
  hourly: {
    hour: number;
    billableEntities: number;
    transactions: number;
    conversionPct: number;
    missedOpportunities: number;
    staffPresentAvg: number;
    customersPerStaff?: number;
  }[];
  byStore: { storeId: number; storeName: string; conversionPct: number; revenue: number; atv: number; missedOpportunities: number }[];
}

export interface LiveQueue {
  zoneId: number;
  storeId: number;
  name: string;
  queueLength: number;
  avgWaitSec: number;
  counterStaffed: boolean;
  ts: string;
}

export interface QueueAnalytics {
  totals: {
    avgQueueLength: number;
    maxQueueLength: number;
    avgWaitSec: number;
    maxWaitSec: number;
    breaches: number;
    unattendedMinutes: number;
  };
  hourly: { hour: number; avgQueueLength: number; avgWaitSec: number }[];
  byCounter: {
    zoneId: number;
    storeId: number;
    storeName: string;
    name: string;
    avgQueueLength: number;
    maxQueueLength: number;
    avgWaitSec: number;
    breaches: number;
  }[];
  live: LiveQueue[];
}

export type StoreOpsEventType =
  | 'STORE_OPENED'
  | 'STORE_CLOSED'
  | 'SOP_BREACH'
  | 'COUNTER_UNATTENDED'
  | 'STAFF_ABSENT'
  | 'LIGHTS_OFF'
  | 'CAMERA_TAMPER';

export interface StoreOps {
  openClose: {
    storeId: number;
    storeName: string;
    date: string;
    scheduledOpen: string;
    actualOpen: string | null;
    lateOpenMin: number;
    scheduledClose: string;
    actualClose: string | null;
    earlyCloseMin: number;
  }[];
  totals: {
    lateOpenings: number;
    earlyClosings: number;
    sopBreaches: number;
    cameraUptimePct: number;
    downtimeMinutes: number;
    offlineCameras: number;
  };
  events: {
    id: number;
    storeId: number;
    storeName: string;
    type: StoreOpsEventType | string;
    ts: string;
    cameraId: number | null;
    details: string | null;
  }[];
  cameraHealth: {
    cameraId: number;
    storeId: number;
    storeName: string;
    name: string;
    status: CameraStatus;
    lastHeartbeatAt: string | null;
    uptimePct: number;
    downtimeMinutes: number;
  }[];
  staffPresence: { hour: number; avgStaff: number }[];
}

export interface BenchmarkRow {
  storeId: number;
  storeName: string;
  regionName: string;
  footfall: number;
  conversionPct: number;
  revenue: number;
  atv: number;
  avgDwellSec: number;
  avgQueueWaitSec: number;
  complianceScore: number;
  revenuePerSqft: number;
  rank: number;
  footfallChangePct: number;
  format?: StoreFormat;
  bouncedPct?: number;
  engagedPct?: number;
}

export interface LiveData {
  storeId: number;
  asOf: string;
  todayFootfall: number;
  currentOccupancy: number;
  lastHourFootfall: number;
  todayTransactions: number;
  todayConversionPct: number;
  queues: LiveQueue[];
  cameras: { id: number; name: string; status: CameraStatus; lastHeartbeatAt: string | null }[];
  recentEvents: VisitorEvent[];
}

// ---------- Alerts & notifications ----------
export type AlertMetric =
  | 'QUEUE_LENGTH'
  | 'QUEUE_WAIT'
  | 'CAMERA_OFFLINE'
  | 'STORE_OPEN_LATE'
  | 'STORE_CLOSE_EARLY'
  | 'FOOTFALL_DROP'
  | 'CONVERSION_DROP'
  | 'SOP_BREACH'
  | 'STAFF_SHORTAGE'
  | 'COUNTER_UNATTENDED'
  | 'CHECKLIST_OVERDUE'
  | 'CHECKLIST_NON_COMPLIANCE'
  | 'AI_MANAGER_BREACH'
  | 'EDGE_OFFLINE';
export const ALERT_METRICS: AlertMetric[] = [
  'QUEUE_LENGTH',
  'QUEUE_WAIT',
  'CAMERA_OFFLINE',
  'STORE_OPEN_LATE',
  'STORE_CLOSE_EARLY',
  'FOOTFALL_DROP',
  'CONVERSION_DROP',
  'SOP_BREACH',
  'STAFF_SHORTAGE',
  'COUNTER_UNATTENDED',
  'CHECKLIST_OVERDUE',
  'CHECKLIST_NON_COMPLIANCE',
  'AI_MANAGER_BREACH',
  'EDGE_OFFLINE',
];
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export const SEVERITIES: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export type AlertChannel = 'IN_APP' | 'EMAIL' | 'WEBHOOK';

export interface AlertRule {
  id: number;
  name: string;
  storeId: number | null;
  metric: AlertMetric;
  threshold: number;
  severity: Severity;
  channels: AlertChannel[];
  emails?: string | null;
  webhookUrl?: string | null;
  cooldownMin: number;
  autoTicket?: boolean;
  isActive: boolean;
}

export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export interface Alert {
  id: number;
  ruleId: number;
  ruleName: string;
  storeId: number;
  storeName: string;
  metric: AlertMetric;
  severity: Severity;
  message: string;
  value: number;
  status: AlertStatus;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  resolvedAt: string | null;
  ticketId: number | null;
}

export interface AppNotification {
  id: number;
  title: string;
  body: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

// ---------- Checklists ----------
export type ChecklistCategory = 'OPENING' | 'CLOSING' | 'VISUAL_MERCHANDISING' | 'HYGIENE' | 'SAFETY' | 'AUDIT' | 'OTHER';
export const CHECKLIST_CATEGORIES: ChecklistCategory[] = [
  'OPENING',
  'CLOSING',
  'VISUAL_MERCHANDISING',
  'HYGIENE',
  'SAFETY',
  'AUDIT',
  'OTHER',
];
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ADHOC';
export type QuestionType = 'YES_NO' | 'MCQ_SINGLE' | 'MCQ_MULTI' | 'TEXT' | 'NUMBER' | 'RATING' | 'PHOTO' | 'VIDEO';
export const QUESTION_TYPES: QuestionType[] = ['YES_NO', 'MCQ_SINGLE', 'MCQ_MULTI', 'TEXT', 'NUMBER', 'RATING', 'PHOTO', 'VIDEO'];
export type AiCheckType = 'NONE' | 'REFERENCE_MATCH' | 'UNIFORM';

export interface Question {
  id?: number;
  section: string;
  text: string;
  type: QuestionType;
  options?: string[];
  correctOptions?: string[];
  required: boolean;
  weight: number;
  requiresPhoto: boolean;
  sortOrder: number;
  minValue?: number | null;
  maxValue?: number | null;
  referenceImageUrl?: string | null;
  aiCheck?: AiCheckType;
  createTaskOnFail?: boolean;
}

export interface Template {
  id: number;
  name: string;
  description: string;
  category: ChecklistCategory;
  frequency: Frequency;
  isActive: boolean;
  createdAt: string;
  questions: Question[];
  /** Contract v4: 1, then +1 on every PUT. */
  version?: number;
}
export type TemplateInput = Omit<Template, 'id' | 'createdAt' | 'version'>;

export type AssignmentStatus = 'PENDING' | 'IN_PROGRESS' | 'SUBMITTED' | 'OVERDUE' | 'REDO' | 'APPROVED';
export interface Assignment {
  id: number;
  templateId: number;
  templateName: string;
  storeId: number;
  storeName: string;
  assigneeId: number;
  assigneeName: string;
  dueDate: string;
  status: AssignmentStatus;
  submissionId: number | null;
  dueAt?: string | null;
  windowStart?: string | null;
  scheduleId?: number | null;
  draftAnswers?: AnswerInput[] | null;
  template?: Template;
}
export interface AssignmentCreate {
  templateId: number;
  storeId: number;
  assigneeId: number;
  dueDate: string;
}

export interface Answer {
  id: number;
  questionId: number;
  value: string;
  photoUrl: string | null;
  remark: string | null;
  score: number;
  maxScore: number;
  redo: boolean;
  aiResult?: AiResult | null;
  flagged?: boolean;
}
export interface AiResult {
  status: 'PASS' | 'FAIL' | 'ERROR' | 'SKIPPED';
  score: number;
  message: string;
  issues: string[];
  annotatedUrl?: string | null;
}
export interface AnswerInput {
  questionId: number;
  value: string;
  photoUrl?: string;
  remark?: string;
}

export type SubmissionStatus = 'SUBMITTED' | 'APPROVED' | 'REDO';
export interface Submission {
  id: number;
  assignmentId: number | null;
  templateId: number;
  templateName: string;
  storeId: number;
  storeName: string;
  submittedById: number;
  submittedByName: string;
  submittedAt: string;
  score: number;
  maxScore: number;
  scorePct: number;
  status: SubmissionStatus;
  reviewerComment: string | null;
  flags?: number;
  answers?: Answer[];
  /** As it was answered (contract v4 snapshot: old wording, weights and retired questions kept). */
  template?: Template;
  /** Contract v4: template version the answers were given against. */
  templateVersion?: number | null;
  /** Contract v4: submitted after the assignment's dueAt (status stays SUBMITTED). */
  isLate?: boolean;
}
export interface SubmissionCreate {
  assignmentId?: number;
  templateId: number;
  storeId: number;
  answers: AnswerInput[];
}
export interface ReviewRequest {
  status: 'APPROVED' | 'REDO';
  comment?: string;
  redoQuestionIds?: number[];
}
export interface ComplianceRow {
  storeId: number;
  storeName: string;
  submissions: number;
  avgScorePct: number;
  overdue: number;
  byCategory: { category: ChecklistCategory | string; avgScorePct: number }[];
}

// ---------- Tasks / tickets / documents / vendors ----------
export type TaskType = 'GENERAL' | 'ZONE_ALLOCATION' | 'FOLLOW_UP' | 'VISUAL_MERCHANDISING';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'VERIFIED' | 'CANCELLED';
export const TASK_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'VERIFIED', 'CANCELLED'];
export interface Task {
  id: number;
  title: string;
  description: string | null;
  storeId: number;
  storeName: string;
  zoneId: number | null;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  assigneeId: number | null;
  assigneeName: string | null;
  createdById: number;
  createdByName: string;
  dueAt: string | null;
  completedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  startAt?: string | null;
  checklistAnswerId?: number | null;
  proofUrl?: string | null;
  remark?: string | null;
}
export interface TaskInput {
  title: string;
  description?: string;
  storeId: number;
  zoneId?: number | null;
  type: TaskType;
  priority: Priority;
  assigneeId?: number | null;
  dueAt?: string | null;
}

export type TicketCategory = 'PLANOGRAM' | 'INFRASTRUCTURE' | 'CAMERA' | 'NETWORK' | 'MAINTENANCE' | 'OTHER';
export const TICKET_CATEGORIES: TicketCategory[] = ['PLANOGRAM', 'INFRASTRUCTURE', 'CAMERA', 'NETWORK', 'MAINTENANCE', 'OTHER'];
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'REOPENED';
export const TICKET_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'];
export interface TicketComment {
  id: number;
  userId: number;
  userName: string;
  body: string;
  createdAt: string;
}
export interface Ticket {
  id: number;
  number: string;
  title: string;
  description: string | null;
  storeId: number;
  storeName: string;
  category: TicketCategory;
  priority: Priority;
  status: TicketStatus;
  assigneeId: number | null;
  assigneeName: string | null;
  reporterId: number;
  reporterName: string;
  alertId: number | null;
  slaDueAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  isSlaBreached: boolean;
  comments?: TicketComment[];
}
export interface TicketInput {
  title: string;
  description?: string;
  storeId: number;
  category: TicketCategory;
  priority: Priority;
  assigneeId?: number | null;
}

export type DocumentCategory = 'SOP' | 'CIRCULAR' | 'PLANOGRAM' | 'TRAINING' | 'OTHER';
export const DOCUMENT_CATEGORIES: DocumentCategory[] = ['SOP', 'CIRCULAR', 'PLANOGRAM', 'TRAINING', 'OTHER'];
export interface DocumentItem {
  id: number;
  title: string;
  category: DocumentCategory;
  storeId: number | null;
  storeName: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedByName: string;
  createdAt: string;
}

export type VendorCategory = 'HOUSEKEEPING' | 'SECURITY' | 'MAINTENANCE' | 'IT' | 'SUPPLIER' | 'OTHER';
export const VENDOR_CATEGORIES: VendorCategory[] = ['HOUSEKEEPING', 'SECURITY', 'MAINTENANCE', 'IT', 'SUPPLIER', 'OTHER'];
export interface Vendor {
  id: number;
  name: string;
  category: VendorCategory;
  contactName: string;
  phone: string;
  email: string;
  isActive: boolean;
}
export type VendorVisitStatus = 'SCHEDULED' | 'CHECKED_IN' | 'COMPLETED' | 'MISSED' | 'CANCELLED';
export interface VendorVisit {
  id: number;
  vendorId: number;
  vendorName: string;
  storeId: number;
  storeName: string;
  purpose: string;
  scheduledAt: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: VendorVisitStatus;
  rating: number | null;
  notes: string | null;
}

export interface UploadResult {
  url: string;
}

// ---------- Reports ----------
export type ReportType =
  | 'traffic'
  | 'zones'
  | 'conversion'
  | 'queue'
  | 'storeops'
  | 'benchmark'
  | 'checklists'
  | 'alerts'
  | 'tasks'
  | 'tickets';
export const REPORT_TYPES: ReportType[] = [
  'traffic',
  'zones',
  'conversion',
  'queue',
  'storeops',
  'benchmark',
  'checklists',
  'alerts',
  'tasks',
  'tickets',
];
export type ReportFormat = 'csv' | 'xlsx';
export interface ReportSchedule {
  id: number;
  name: string;
  type: ReportType;
  format: ReportFormat;
  storeIds: number[];
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  recipients: string;
  isActive: boolean;
  lastRunAt: string | null;
}

// =====================================================================
// Contract v2 (docs/API_CONTRACT_V2.md)
// =====================================================================

export type SnapshotKind = 'PERIODIC' | 'EVENT' | 'OPENING' | 'CLOSING' | 'AI_MANAGER' | 'REFERENCE';
export const SNAPSHOT_KINDS: SnapshotKind[] = ['PERIODIC', 'EVENT', 'OPENING', 'CLOSING', 'AI_MANAGER', 'REFERENCE'];
export interface SnapshotImage {
  id: number;
  storeId: number;
  storeName: string;
  cameraId: number;
  cameraName: string;
  ts: string;
  kind: SnapshotKind;
  url: string;
}

export interface Recap {
  id: number;
  storeId: number;
  storeName: string;
  date: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  url: string | null;
  durationSec: number;
  frameCount: number;
  error: string | null;
  createdAt: string;
}

export type InfraHealthStatus = 'GOOD' | 'DEGRADED' | 'DOWN';
export interface InfraHealth {
  totals: { stores: number; healthy: number; degraded: number; down: number; camerasOnline: number; camerasTotal: number; openInfraTickets: number };
  stores: {
    storeId: number;
    storeName: string;
    edgeStatus: 'ONLINE' | 'OFFLINE' | 'NEVER';
    edgeLastSeenAt: string | null;
    edgeVersion: string | null;
    camerasOnline: number;
    camerasTotal: number;
    /** null when the store has no cameras (contract v4). */
    uptimePct7d: number | null;
    /** Door-counting accuracy from the last manual audit on the store PC (null = never audited). */
    countAccuracyPct?: number | null;
    health: InfraHealthStatus;
    openTickets: number;
    issues: string[];
  }[];
}

export interface TrafficDensity {
  cells: { dow: number; hour: number; avgFootfall: number }[];
  max: number;
  hours: number[];
}

export type BenchmarkGroupBy = 'region' | 'format' | 'city';
export interface BenchmarkGroup {
  group: string;
  stores: number;
  footfall: number;
  conversionPct: number;
  revenue: number;
  atv: number;
  avgDwellSec: number;
  bouncedPct: number;
  engagedPct: number;
  missedOpportunities: number;
}

export type ScheduleFrequency = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
export interface ChecklistSchedule {
  id: number;
  templateId: number;
  templateName: string;
  storeIds: number[];
  assigneeId: number | null;
  frequency: ScheduleFrequency;
  repeatEvery: number;
  daysOfWeek: number[];
  dayOfMonth: number | null;
  windowStart: string;
  windowEnd: string;
  startDate: string;
  endDate: string | null;
  reminderMinutesBefore: number;
  isActive: boolean;
  lastGeneratedDate: string | null;
}
export type ChecklistScheduleInput = Omit<ChecklistSchedule, 'id' | 'templateName' | 'lastGeneratedDate'>;

export interface TraxDashboard {
  activeChecklists: number;
  checklistInstances: number;
  notSubmitted: number;
  open: number;
  inProgress: number;
  submitted: number;
  completionScorePct: number;
  complianceScorePct: number;
  totalFlags: number;
  byChecklist: { templateId: number; name: string; frequency: string; stores: number; assigned: number; submitted: number; flags: number; completionPct: number; compliancePct: number }[];
  byStore: { storeId: number; storeName: string; assigned: number; submitted: number; flags: number; completionPct: number; compliancePct: number }[];
  byUser: { userId: number; name: string; assigned: number; submitted: number; flags: number; completionPct: number; compliancePct: number }[];
}

export interface AnswerTaskRequest {
  title?: string;
  assigneeId: number;
  dueAt: string;
  priority?: Priority;
}
export interface BulkTaskRequest {
  storeIds: number[];
  title: string;
  description?: string;
  type?: TaskType;
  priority?: Priority;
  dueAt?: string | null;
  startAt?: string | null;
  assigneeId?: number | null;
}

export type AiManagerType =
  | 'MOBILE_USAGE'
  | 'UNATTENDED_CUSTOMER'
  | 'STORE_OPEN_CLOSE'
  | 'HYGIENE_CLEANING'
  | 'HUDDLE_MEETING'
  | 'UNIFORM_COMPLIANCE'
  | 'STOCK_OUT'
  | 'QUEUE_BREACH';
export const AI_MANAGER_TYPES: AiManagerType[] = [
  'MOBILE_USAGE',
  'UNATTENDED_CUSTOMER',
  'STORE_OPEN_CLOSE',
  'HYGIENE_CLEANING',
  'HUDDLE_MEETING',
  'UNIFORM_COMPLIANCE',
  'STOCK_OUT',
  'QUEUE_BREACH',
];
export type ParamValue = number | string | boolean;
export interface AiManagerRule {
  id: number;
  name: string;
  type: AiManagerType;
  storeIds: number[];
  zoneIds: number[];
  windowStart: string;
  windowEnd: string;
  daysOfWeek: number[];
  params: Record<string, ParamValue>;
  severity: Severity;
  notifyChannels: AlertChannel[];
  notifyEmails: string | null;
  isActive: boolean;
}
export type AiManagerRuleInput = Omit<AiManagerRule, 'id'>;
/** PENDING (contract v4): open / close day not decided yet. */
export type DetectionStatus = 'BREACHED' | 'COMPLIED' | 'PENDING';
export interface Detection {
  id: number;
  ruleId: number | null;
  ruleName: string | null;
  type: AiManagerType;
  storeId: number;
  storeName: string;
  cameraId: number | null;
  cameraName: string | null;
  zoneId: number | null;
  zoneName: string | null;
  ts: string;
  status: DetectionStatus;
  details: string | null;
  confidence: number | null;
  snapshotUrl: string | null;
  reviewStatus: 'VALID' | 'FALSE_POSITIVE' | null;
}
export interface AiManagerSummary {
  /** Contract v4: totals.detections equals GET /detections total (false positives included). */
  totals?: { detections: number; falsePositives: number; breached: number; complied: number; compliancePct: number | null };
  byType: { type: AiManagerType; breached: number; complied: number; compliancePct: number }[];
  byStore: { storeId: number; storeName: string; breached: number; complied: number; compliancePct: number }[];
  daily: { date: string; breached: number; complied: number }[];
}
export type OpenCloseStatus = 'ON_TIME' | 'LATE' | 'EARLY' | 'MISSING' | 'PENDING';
export interface OpenCloseRow {
  storeId: number;
  storeName: string;
  date: string;
  scheduledOpen: string;
  scheduledClose: string;
  actualOpen: string | null;
  actualClose: string | null;
  openStatus: OpenCloseStatus;
  closeStatus: OpenCloseStatus;
  openingSnapUrl: string | null;
  closingSnapUrl: string | null;
  detectionStatus: DetectionStatus;
}

// =====================================================================
// Contract v3 — DVR / NVR recorders and connection tests (docs/API_CONTRACT_V3_RECORDERS.md)
// =====================================================================

export type RecorderBrand = 'HIKVISION' | 'CP_PLUS' | 'DAHUA' | 'UNIVIEW' | 'GODREJ' | 'HONEYWELL' | 'TIANDY' | 'GENERIC_ONVIF' | 'CUSTOM';
export type RecorderKind = 'DVR' | 'NVR' | 'HYBRID';
export type RecorderStream = 'MAIN' | 'SUB';
export type RecorderStatus = 'ONLINE' | 'PARTIAL' | 'OFFLINE' | 'UNKNOWN';
export interface RecorderBrandInfo {
  brand: RecorderBrand;
  label: string;
  defaultRtspPort: number;
  mainTemplate: string | null;
  subTemplate: string | null;
  notes: string | null;
}
export interface Recorder {
  id: number;
  storeId: number;
  storeName: string;
  name: string;
  kind: RecorderKind;
  brand: RecorderBrand;
  host: string;
  rtspPort: number;
  httpPort: number;
  username: string;
  hasPassword: boolean;
  channels: number;
  stream: RecorderStream;
  urlTemplate: string | null;
  status: RecorderStatus;
  lastCheckedAt: string | null;
  camerasLinked: number;
  createdAt: string;
}
/** POST/PATCH body: the Recorder fields plus a write-only password (omit on PATCH to keep it). */
export type RecorderInput = Pick<Recorder, 'storeId' | 'name' | 'kind' | 'brand' | 'host' | 'rtspPort' | 'httpPort' | 'username' | 'channels' | 'stream' | 'urlTemplate'> & {
  password?: string;
};
export type ProbeStatus = 'PENDING' | 'RUNNING' | 'OK' | 'FAILED' | 'EXPIRED';
export type ProbeErrorCode = 'AUTH' | 'TIMEOUT' | 'UNREACHABLE' | 'NOT_FOUND' | 'UNSUPPORTED_CODEC' | 'EDGE_OFFLINE' | 'OTHER';
export interface Probe {
  id: number;
  storeId: number;
  cameraId: number | null;
  recorderId: number | null;
  channel: number | null;
  status: ProbeStatus;
  requestedAt: string;
  completedAt: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  latencyMs: number | null;
  error: string | null;
  errorCode: ProbeErrorCode | null;
  snapshotUrl: string | null;
}
export interface DiscoveredDevice {
  host: string;
  rtspPort: number;
  httpPort: number | null;
  brandGuess: RecorderBrand | null;
  onvif: boolean;
  seenAt: string;
}
/** Camera fields added by contract v3 (absent until the recorder backend is merged). */
export interface CameraRecorderLink {
  recorderId?: number | null;
  channel?: number | null;
  streamProfile?: RecorderStream | null;
}
