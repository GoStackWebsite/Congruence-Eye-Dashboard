# Congruence Eye — REST API Contract (v1)

This is the single source of truth shared by `backend/`, `frontend/`, `ai-service/` and `e2e/`.

- Base URL: `/api` (backend listens on `PORT`, default 3000; Angular dev proxy forwards `/api`).
- JSON everywhere; property names camelCase; IDs are integers.
- Timestamps: ISO-8601 strings (UTC, with `Z`). `date` = `YYYY-MM-DD` store-local. `hour` = 0..23 store-local.
- Auth: `Authorization: Bearer <jwt>` for users. `X-Api-Key: <key>` for edge devices (`/api/ingest/*`, and also accepted on `POST /api/pos/transactions`).
- Errors: `{ "statusCode": 400, "message": "..." | ["..."], "error": "Bad Request" }` (NestJS default).
- Validation: request DTOs use class-validator; unknown properties are stripped.
- List endpoints return a plain array unless marked **paged**. Paged endpoints accept `page` (1-based, default 1) and `pageSize` (default 25, max 500) and return `{ items, total, page, pageSize }`.

## Roles

`SUPER_ADMIN`, `ADMIN`, `REGIONAL_MANAGER`, `STORE_MANAGER`, `AUDITOR`, `STAFF`.

- SUPER_ADMIN and ADMIN see all stores and can manage master data and users.
- Other roles see only `user.storeIds`. Requests for stores outside that scope are silently filtered from lists and return 403 for single-store requests.
- Write permissions:
  - master data (regions, stores, cameras, zones, edge devices, users, settings, alert rules): ADMIN+
  - staff roster, POS import, documents upload, vendors, vendor visits: STORE_MANAGER+
  - checklist templates: ADMIN, REGIONAL_MANAGER, AUDITOR
  - checklist assignments: ADMIN, REGIONAL_MANAGER, STORE_MANAGER, AUDITOR
  - checklist submissions: any role (assignee); review: ADMIN, REGIONAL_MANAGER, AUDITOR, STORE_MANAGER
  - tasks: create STORE_MANAGER+; status change by assignee or manager; verify STORE_MANAGER+
  - tickets: create any; change status/assign STORE_MANAGER+ or assignee
- "STORE_MANAGER+" means STORE_MANAGER, REGIONAL_MANAGER, ADMIN or SUPER_ADMIN.

## Common analytics query params

`storeIds=1,2,3` (optional, default = all stores in scope), `from=YYYY-MM-DD`, `to=YYYY-MM-DD` (inclusive; default = last 7 days ending today), `compare=true` (adds previous-period values where noted).

---

## Health & Auth

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/health` | – | `{ status: "ok", db: "up", time }` (public) |
| POST | `/api/auth/login` | `{ email, password }` | `{ accessToken, user: User }` (401 on bad creds) |
| GET | `/api/auth/me` | – | `User` |
| POST | `/api/auth/change-password` | `{ currentPassword, newPassword }` | `{ ok: true }` |

`User` = `{ id, email, name, role, isActive, storeIds: number[], createdAt }`

Seed users (password for all: `Password@123`):

| Email | Role | Stores |
|---|---|---|
| admin@congruence.in | SUPER_ADMIN | all |
| regional@congruence.in | REGIONAL_MANAGER | all Chennai stores |
| manager.tnagar@congruence.in | STORE_MANAGER | T Nagar (id 1) |
| auditor@congruence.in | AUDITOR | all |
| staff.tnagar@congruence.in | STAFF | T Nagar (id 1) |

## Master data (ADMIN+ writes)

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/users` | POST `{ email, name, role, password, storeIds?, isActive? }` |
| GET/PATCH/DELETE | `/api/users/:id` | PATCH any of the POST fields; DELETE = deactivate (isActive=false) |
| GET/POST | `/api/regions` | `Region` = `{ id, name }` |
| PATCH/DELETE | `/api/regions/:id` | |
| GET/POST | `/api/stores` | `Store` (below) |
| GET/PATCH/DELETE | `/api/stores/:id` | GET includes `cameras: Camera[]`, `zones: Zone[]` |
| GET/POST | `/api/cameras?storeId=` | `Camera` |
| GET/PATCH/DELETE | `/api/cameras/:id` | |
| GET | `/api/cameras/:id/snapshot` | latest JPEG (404 if none) |
| GET/POST | `/api/zones?storeId=&cameraId=` | `Zone` |
| PATCH/DELETE | `/api/zones/:id` | |
| GET/POST | `/api/edge-devices?storeId=` | POST returns the device incl. plaintext `apiKey` (only time it is shown) |
| DELETE | `/api/edge-devices/:id` | |
| POST | `/api/edge-devices/:id/rotate-key` | `{ apiKey }` |
| GET/POST | `/api/staff?storeId=` | `Staff` (STORE_MANAGER+) |
| PATCH/DELETE | `/api/staff/:id` | |
| GET/PUT | `/api/settings` | `Settings` object (PUT ADMIN+) |
| GET | `/api/audit-logs?userId=&entity=&page=&pageSize=` | **paged**, ADMIN+. `{ id, userId, userName, action, entity, entityId, details, createdAt }` |

```ts
Store   = { id, code, name, regionId, regionName, city, address, timezone, openTime: "HH:mm", closeTime: "HH:mm",
            areaSqft, isActive, latitude?, longitude?, createdAt }
Camera  = { id, storeId, name, rtspUrl, type: "ENTRANCE"|"ZONE"|"BILLING"|"GENERAL", status: "ONLINE"|"OFFLINE"|"UNKNOWN",
            lastHeartbeatAt: string|null, isActive, fps?: number }
Zone    = { id, storeId, cameraId, name, type: "ENTRY_LINE"|"SECTION"|"QUEUE"|"STAFF_ONLY",
            polygon: [number,number][]   // normalised 0..1 coords; ENTRY_LINE uses exactly 2 points
            inDirection?: "UP"|"DOWN"|"LEFT"|"RIGHT"  // ENTRY_LINE only: crossing direction that means "entering"
            engagedDwellSec: number, queueAlertLength?: number, queueAlertWaitSec?: number, isActive }
EdgeDevice = { id, storeId, name, lastSeenAt, version, apiKeyPrefix, createdAt, apiKey? }
Staff   = { id, storeId, code, name, designation, shiftStart: "HH:mm", shiftEnd: "HH:mm", isActive }
Settings = { engagedStoreDwellSec: 300, bounceSec: 60, repeatWindowDays: 30, currency: "INR",
             companyName: "Congruence", smtpHost?, smtpPort?, smtpUser?, smtpFrom?, alertEmailEnabled: boolean }
```

## Ingestion (edge device, `X-Api-Key`)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/ingest/config` | – | `{ store: Store, cameras: Camera[], zones: Zone[], settings: Settings }` |
| POST | `/api/ingest/events` | `{ events: VisitorEvent[] }` (≤ 5000) | `{ accepted: number }` |
| POST | `/api/ingest/queue` | `{ snapshots: QueueSnapshot[] }` | `{ accepted }` |
| POST | `/api/ingest/heatmap` | `{ cameraId, ts, width: 32, height: 18, grid: number[] /* width*height */ }` | `{ ok: true }` |
| POST | `/api/ingest/heartbeat` | `{ version?, cameras: { cameraId, status: "ONLINE"|"OFFLINE", fps?, reason? }[] }` | `{ ok: true }` |
| POST | `/api/ingest/storeops` | `{ events: StoreOpsEvent[] }` | `{ accepted }` |
| POST | `/api/ingest/snapshot` | multipart: `cameraId`, `file` (image/jpeg) | `{ ok: true }` |

```ts
VisitorEvent = { cameraId, zoneId?: number, type: "ENTRY"|"EXIT"|"ZONE_ENTER"|"ZONE_EXIT", ts: string,
                 trackId: string,          // tracker id, unique per camera session
                 visitorId: string,        // re-id hash; same person across cameras/visits when known
                 isStaff?: boolean, groupId?: string|null,
                 gender?: "M"|"F"|"U", ageBand?: "0-17"|"18-24"|"25-34"|"35-44"|"45-54"|"55+"|"U",
                 dwellSec?: number }       // on EXIT (store dwell) / ZONE_EXIT (zone dwell)
QueueSnapshot = { zoneId, ts, queueLength: number, avgWaitSec: number, counterStaffed: boolean }
StoreOpsEvent = { type: "STORE_OPENED"|"STORE_CLOSED"|"SOP_BREACH"|"COUNTER_UNATTENDED"|"STAFF_ABSENT"|"LIGHTS_OFF"|"CAMERA_TAMPER",
                  ts, cameraId?: number, details?: string }
```

## POS

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/pos/transactions` | `{ transactions: { storeId, billNo, ts, amount, itemsCount, staffCode? }[] }` (JWT STORE_MANAGER+ or X-Api-Key) | `{ accepted, duplicates }` (dedupe on storeId+billNo) |
| POST | `/api/pos/import` | multipart `file` CSV with header `storeCode,billNo,ts,amount,itemsCount,staffCode` | `{ accepted, duplicates, errors: string[] }` |
| GET | `/api/pos/transactions?storeIds&from&to&page&pageSize` | – | **paged** `{ id, storeId, storeName, billNo, ts, amount, itemsCount, staffCode }` |

## Analytics (all accept common params)

`Kpi = { value: number, previous?: number, changePct?: number }`

**GET `/api/analytics/overview`**
```ts
{ kpis: { footfall: Kpi, uniqueVisitors: Kpi, billableEntities: Kpi, transactions: Kpi, conversionPct: Kpi, revenue: Kpi,
          atv: Kpi, avgDwellSec: Kpi, engagedPct: Kpi, bounceRatePct: Kpi, missedOpportunities: Kpi, avgQueueWaitSec: Kpi,
          complianceScore: Kpi, openAlerts: Kpi },
  daily: { date, footfall, transactions, conversionPct, revenue }[] }
```
**GET `/api/analytics/traffic`**
```ts
{ totals: { footfallIn, footfallOut, uniqueVisitors, staffExcluded, individuals, groups, billableEntities,
            engaged, casual, bounced, repeatVisitors, newVisitors, avgDwellSec },
  daily: { date, footfallIn, footfallOut, uniqueVisitors, billableEntities, engaged, bounced }[],
  hourly: { hour, footfall, avgPerDay }[],          // aggregated across range, hours 0..23
  peakHour: number, dayOfWeek: { dow /*0=Sun*/, footfall, avgPerDay }[] }
```
**GET `/api/analytics/demographics`**
```ts
{ gender: { male, female, unknown }, age: { band, count }[], genderByAge: { band, male, female }[] }
```
**GET `/api/analytics/zones`** (`storeIds` optional)
```ts
{ id /*zoneId*/, storeId, storeName, name, type, visits, uniqueVisitors, avgDwellSec, engaged, engagedPct,
  male, female, classification: "HOT"|"WARM"|"DEAD" }[]
```
**GET `/api/analytics/heatmap?storeId=&cameraId=&from&to`** → `{ cameraId, width, height, grid: number[], max: number }`

**GET `/api/analytics/journey?storeId=&from&to`** → `{ nodes: { id, name }[], links: { source: id, target: id, count }[] }` (node id 0 = "Entrance")

**GET `/api/analytics/conversion`**
```ts
{ funnel: { footfall, billableEntities, engaged, transactions },
  segments: { bounced, missedOpportunities, converted },
  totals: { revenue, transactions, atv, conversionPct, itemsPerBill },
  daily: { date, billableEntities, transactions, conversionPct, revenue, atv }[],
  hourly: { hour, billableEntities, transactions, conversionPct, missedOpportunities, staffPresentAvg }[],
  byStore: { storeId, storeName, conversionPct, revenue, atv, missedOpportunities }[] }
```
**GET `/api/analytics/queue`**
```ts
{ totals: { avgQueueLength, maxQueueLength, avgWaitSec, maxWaitSec, breaches, unattendedMinutes },
  hourly: { hour, avgQueueLength, avgWaitSec }[],
  byCounter: { zoneId, storeId, storeName, name, avgQueueLength, maxQueueLength, avgWaitSec, breaches }[],
  live: { zoneId, storeId, name, queueLength, avgWaitSec, counterStaffed, ts }[] }   // latest snapshot per queue zone
```
**GET `/api/analytics/storeops`**
```ts
{ openClose: { storeId, storeName, date, scheduledOpen, actualOpen: string|null /*HH:mm*/, lateOpenMin,
               scheduledClose, actualClose: string|null, earlyCloseMin }[],
  totals: { lateOpenings, earlyClosings, sopBreaches, cameraUptimePct, downtimeMinutes, offlineCameras },
  events: { id, storeId, storeName, type, ts, cameraId, details }[],     // newest 200
  cameraHealth: { cameraId, storeId, storeName, name, status, lastHeartbeatAt, uptimePct, downtimeMinutes }[],
  staffPresence: { hour, avgStaff }[] }
```
**GET `/api/analytics/benchmark`**
```ts
{ storeId, storeName, regionName, footfall, conversionPct, revenue, atv, avgDwellSec, avgQueueWaitSec,
  complianceScore, revenuePerSqft, rank /*by revenue*/, footfallChangePct }[]
```
**GET `/api/analytics/live?storeId=`**
```ts
{ storeId, asOf, todayFootfall, currentOccupancy, lastHourFootfall, todayTransactions, todayConversionPct,
  queues: (same as queue.live)[], cameras: { id, name, status, lastHeartbeatAt }[], recentEvents: VisitorEvent-like[] /* 20 newest */ }
```

## Alerts & notifications

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/alert-rules` | `AlertRule` (ADMIN+ writes) |
| PATCH/DELETE | `/api/alert-rules/:id` | |
| GET | `/api/alerts?status=&storeIds=&severity=&page=&pageSize=` | **paged** `Alert` |
| PATCH | `/api/alerts/:id/ack` | → `Alert` |
| PATCH | `/api/alerts/:id/resolve` | → `Alert` |
| POST | `/api/alerts/:id/ticket` | creates a Ticket linked to the alert → `Ticket` |
| POST | `/api/alerts/evaluate` | ADMIN+, forces rule evaluation now → `{ created: number }` |
| GET | `/api/notifications` | newest 100 for the current user: `{ id, title, body, link, isRead, createdAt }` |
| PATCH | `/api/notifications/:id/read` | |
| POST | `/api/notifications/read-all` | |
| GET | `/api/stream?token=<jwt>` | Server-Sent Events: `event: alert` (data = Alert), `event: notification`, `event: live` (data = `{ storeId }`) |

```ts
AlertRule = { id, name, storeId: number|null, metric: "QUEUE_LENGTH"|"QUEUE_WAIT"|"CAMERA_OFFLINE"|"STORE_OPEN_LATE"|"STORE_CLOSE_EARLY"
              |"FOOTFALL_DROP"|"CONVERSION_DROP"|"SOP_BREACH"|"STAFF_SHORTAGE"|"COUNTER_UNATTENDED",
              threshold: number, severity: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", channels: ("IN_APP"|"EMAIL"|"WEBHOOK")[],
              emails?: string, webhookUrl?: string, cooldownMin: number, isActive }
Alert = { id, ruleId, ruleName, storeId, storeName, metric, severity, message, value, status: "OPEN"|"ACKNOWLEDGED"|"RESOLVED",
          createdAt, acknowledgedAt, acknowledgedByName, resolvedAt, ticketId: number|null }
```
Threshold meaning: QUEUE_LENGTH people, QUEUE_WAIT seconds, CAMERA_OFFLINE minutes offline, STORE_OPEN_LATE / STORE_CLOSE_EARLY minutes,
FOOTFALL_DROP / CONVERSION_DROP % drop of today-so-far vs same hours on the same weekday last week, SOP_BREACH / COUNTER_UNATTENDED count of events in the last 15 min, STAFF_SHORTAGE minimum staff present.

## Trax: Checklists & audits

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/checklists/templates` | `Template` with nested `questions` |
| GET/PUT/DELETE | `/api/checklists/templates/:id` | PUT replaces whole template incl. questions |
| GET/POST | `/api/checklists/assignments?storeIds&status&mine=true` | POST `{ templateId, storeId, assigneeId, dueDate }` |
| GET | `/api/checklists/assignments/:id` | includes `template` |
| GET/POST | `/api/checklists/submissions?storeIds&templateId&from&to` | POST `{ assignmentId?, templateId, storeId, answers: { questionId, value, photoUrl?, remark? }[] }` → `Submission` (scored) |
| GET | `/api/checklists/submissions/:id` | includes `answers` and `template` |
| PATCH | `/api/checklists/submissions/:id/review` | `{ status: "APPROVED"|"REDO", comment?, redoQuestionIds?: number[] }` |
| GET | `/api/checklists/compliance?storeIds&from&to` | `{ storeId, storeName, submissions, avgScorePct, overdue, byCategory: { category, avgScorePct }[] }[]` |

```ts
Template = { id, name, description, category: "OPENING"|"CLOSING"|"VISUAL_MERCHANDISING"|"HYGIENE"|"SAFETY"|"AUDIT"|"OTHER",
             frequency: "DAILY"|"WEEKLY"|"MONTHLY"|"ADHOC", isActive, createdAt,
             questions: { id?, section, text, type: "YES_NO"|"MCQ_SINGLE"|"MCQ_MULTI"|"TEXT"|"NUMBER"|"RATING"|"PHOTO",
                          options?: string[], correctOptions?: string[], required, weight, requiresPhoto, sortOrder,
                          minValue?, maxValue? }[] }
Assignment = { id, templateId, templateName, storeId, storeName, assigneeId, assigneeName, dueDate, status: "PENDING"|"SUBMITTED"|"OVERDUE"|"REDO"|"APPROVED", submissionId }
Submission = { id, assignmentId, templateId, templateName, storeId, storeName, submittedById, submittedByName, submittedAt,
               score, maxScore, scorePct, status: "SUBMITTED"|"APPROVED"|"REDO", reviewerComment, answers?: Answer[] }
Answer = { id, questionId, value: string /* MCQ_MULTI as JSON array string */, photoUrl, remark, score, maxScore, redo: boolean }
```
Scoring: YES_NO "YES" = full weight; MCQ_SINGLE/MULTI correct options = weight (if `correctOptions` is empty any answer scores full); RATING value/5 × weight; NUMBER within [minValue, maxValue] = weight; TEXT/PHOTO answered = weight.

## Trax: Tasks, tickets, documents, vendors

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/tasks?storeIds&status&assigneeId&mine=true` | `Task` |
| GET/PATCH/DELETE | `/api/tasks/:id` | |
| PATCH | `/api/tasks/:id/status` | `{ status }` |
| PATCH | `/api/tasks/:id/verify` | sets VERIFIED |
| GET/POST | `/api/tickets?storeIds&status&category&priority` | `Ticket` |
| GET/PATCH | `/api/tickets/:id` | GET includes `comments` |
| PATCH | `/api/tickets/:id/status` | `{ status }` |
| POST | `/api/tickets/:id/comments` | `{ body }` → `Comment` |
| GET/POST | `/api/documents?storeId&category` | POST multipart `file`, `title`, `category`, `storeId?` |
| GET | `/api/documents/:id/download` | file stream |
| DELETE | `/api/documents/:id` | |
| GET/POST | `/api/vendors` | `Vendor` |
| PATCH/DELETE | `/api/vendors/:id` | |
| GET/POST | `/api/vendor-visits?storeIds&vendorId&status&from&to` | `VendorVisit` |
| PATCH | `/api/vendor-visits/:id` | |
| PATCH | `/api/vendor-visits/:id/check-in` / `/check-out` | check-out body `{ rating?, notes? }` |
| POST | `/api/uploads` | multipart `file` (image) → `{ url }` (served from `/uploads/...`) |

```ts
Task   = { id, title, description, storeId, storeName, zoneId, type: "GENERAL"|"ZONE_ALLOCATION"|"FOLLOW_UP"|"VISUAL_MERCHANDISING",
           priority: "LOW"|"MEDIUM"|"HIGH"|"URGENT", status: "TODO"|"IN_PROGRESS"|"DONE"|"VERIFIED"|"CANCELLED",
           assigneeId, assigneeName, createdById, createdByName, dueAt, completedAt, verifiedAt, createdAt }
Ticket = { id, number /* "TKT-00001" */, title, description, storeId, storeName,
           category: "PLANOGRAM"|"INFRASTRUCTURE"|"CAMERA"|"NETWORK"|"MAINTENANCE"|"OTHER",
           priority: "LOW"|"MEDIUM"|"HIGH"|"URGENT", status: "OPEN"|"IN_PROGRESS"|"RESOLVED"|"CLOSED"|"REOPENED",
           assigneeId, assigneeName, reporterId, reporterName, alertId, slaDueAt, resolvedAt, createdAt, isSlaBreached,
           comments?: { id, userId, userName, body, createdAt }[] }
Document = { id, title, category: "SOP"|"CIRCULAR"|"PLANOGRAM"|"TRAINING"|"OTHER", storeId, storeName, fileName, mimeType, size, uploadedByName, createdAt }
Vendor = { id, name, category: "HOUSEKEEPING"|"SECURITY"|"MAINTENANCE"|"IT"|"SUPPLIER"|"OTHER", contactName, phone, email, isActive }
VendorVisit = { id, vendorId, vendorName, storeId, storeName, purpose, scheduledAt, checkInAt, checkOutAt,
                status: "SCHEDULED"|"CHECKED_IN"|"COMPLETED"|"MISSED"|"CANCELLED", rating, notes }
```
SLA by priority: URGENT 4h, HIGH 24h, MEDIUM 72h, LOW 168h.

## Reports

| Method | Path | Notes |
|---|---|---|
| GET | `/api/reports/export?type=&format=csv|xlsx&storeIds&from&to` | type ∈ `traffic, zones, conversion, queue, storeops, benchmark, checklists, alerts, tasks, tickets`; file download with `Content-Disposition` |
| GET/POST | `/api/reports/schedules` | `{ id, name, type, format, storeIds: number[], frequency: "DAILY"|"WEEKLY"|"MONTHLY", recipients: string, isActive, lastRunAt }` |
| PATCH/DELETE | `/api/reports/schedules/:id` | |
| POST | `/api/reports/schedules/:id/run` | `{ ok: true, file: string }` (sends an email when SMTP is configured, otherwise stores the file) |
