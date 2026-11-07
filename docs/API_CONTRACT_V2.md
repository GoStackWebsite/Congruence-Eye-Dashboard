# Congruence Eye — Contract v2 addendum (feature parity with the Tango Eye module overview + product deck)

This addendum is binding in addition to `API_CONTRACT.md`. Where it changes something in v1, v2 wins. Every feature below maps to a line in the client's "TangoEye Module Overview" or "Tango Eye Product Deck".

## Feature parity checklist (source → feature)

| # | Tango source | Feature | Where |
|---|---|---|---|
| T1 | Traffic: footfall analysis | done in v1 | analytics/traffic |
| T2 | Traffic: conversion flow chart Footfall → Engagers → Billable entities → Conversion | funnel order fixed (below) | analytics/conversion |
| T3 | Traffic: dwell time + demographics by age and gender | v1 + "gender & dwell" card | analytics/demographics |
| T4 | Traffic: **Recap video** (day summary < 2 min) | NEW | /api/recaps |
| T5 | Traffic: **Image Directory** for self-audit | NEW | /api/image-directory |
| T6 | Traffic: **Infra Health** (infra tracking + ticketing) | NEW page + auto tickets | /api/infra/health |
| T7 | Traffic: **Traffic Density** (hour × weekday matrix) | NEW | /api/analytics/traffic-density |
| T8 | Traffic: drop-off rate at time intervals | hourly bounced % | traffic.hourly gets `bouncedPct` |
| T9 | Traffic: store open/close time with snaps | v1 + opening/closing snapshot | ai-manager/open-close |
| T10 | Multi-user login dashboard | v1 | – |
| Z1 | Zone: heatmap, tagging, hot/dead zones | v1 | – |
| Z2 | Zone metrics: footfall, demographics, **bounced %**, avg dwell, **concentration %** | NEW fields | analytics/zones |
| Z3 | **Customer trajectory across stores** with highlight cards | NEW fields | analytics/journey |
| Z4 | **Stock-out alerts** (shelf ≥ 70 % empty) | NEW zone type SHELF + AI Manager STOCK_OUT | ai-manager |
| Z5 | Queue monitoring alerts | v1 | – |
| X1 | Trax: create/manage/assign checklists **and tasks across multiple stores** | bulk tasks + multi-store schedules | /api/tasks/bulk, schedules |
| X2 | Question types: descriptive, multiple choice, **image or video** capture | NEW type VIDEO | templates |
| X3 | **Smart scheduling** (repeat, time window, start/end) | NEW | /api/checklists/schedules |
| X4 | **Timely nudges** (reminders before due, breach alerts) | NEW cron + notifications + alerts | – |
| X5 | **Centralised compliance dashboard** (checklist / store / user performance) | NEW | /api/checklists/dashboard |
| X6 | **Resolve deviations in real time** (task from a checklist response) | NEW | /api/checklists/answers/:id/task |
| X7 | Section-wise saving (drafts), in-progress status | NEW | /api/checklists/assignments/:id/draft |
| A1 | **AI-in-Checklist**: compare upload vs approved reference image, flag mismatch, "image not clear" | NEW | ai-service + backend |
| A2 | **Staff uniform adherence** (groomed / not groomed, missing items) | NEW | ai-service + backend |
| M1 | **AI Manager** CCTV-driven checklists: rules with detection areas, schedule, stores, notify | NEW | /api/ai-manager/* |
| M2 | Mobile-phone usage detection | NEW detector | ai-service |
| M3 | Unattended customers | NEW detector | ai-service |
| M4 | Store hygiene (cleaning & mopping) | NEW detector | ai-service |
| M5 | Huddle-meeting tracking | NEW detector | ai-service |
| M6 | Store open/close with opening/closing snaps, On Time / Late / Early | NEW view | ai-manager/open-close |
| B1 | Benchmark across regions **and store formats** | NEW store.format + grouped benchmark | analytics/benchmark/groups |
| B2 | Customer-to-staff ratio by hour | NEW field | conversion.hourly.customersPerStaff |
| P1 | Mobile use for checklists | PWA manifest + service worker | frontend |

## Changes to existing shapes

- `Store` adds `format: "HIGH_STREET"|"MALL"|"AIRPORT"|"OUTLET"|"KIOSK"` (seed a mix).
- `Zone.type` adds `"SHELF"`. Zone adds optional `referenceSnapshotId: number|null` (the "full shelf" reference for SHELF zones).
- `Settings` adds `aiServiceUrl` (default env `AI_SERVICE_URL`, `http://localhost:8000`) and `checklistReminderMinutes` (default 60).
- `POST /api/ingest/snapshot`: multipart `cameraId`, `file`, optional `kind` (`PERIODIC` default | `EVENT` | `OPENING` | `CLOSING` | `AI_MANAGER` | `REFERENCE`) and optional `ts`. Response becomes `{ ok: true, snapshotId, url }`. Every snapshot is kept (table `snapshots`: id, storeId, cameraId, ts, kind, filePath, sizeBytes). `GET /api/cameras/:id/snapshot` still returns the latest one.
- `StoreOpsEvent` adds optional `snapshotId`.
- `GET /api/ingest/config` adds `aiManagerRules: AiManagerRule[]` (active rules that apply to this store).
- `/analytics/traffic` `hourly[]` adds `bouncedPct`.
- `/analytics/conversion` `funnel` is monotonic like Tango's Conversion Flow chart, in the order `{ footfall, engaged, billableEntities, transactions }`, labelled Footfall → Engagers → Billable entities → Conversion. Here `engaged` = engaged people and `billableEntities` = ENGAGED billable entities (engaged individuals + engaged groups counted once). KPIs and `totals.conversionPct` still use all billable entities. `hourly[]` adds `customersPerStaff` (billableEntities ÷ staffPresentAvg, 0 when no staff).
- `/analytics/zones` items add `bouncedPct` (zone visits with dwell < the zone's engagedDwellSec ÷ visits × 100), `concentrationPct` (zone engaged ÷ store footfall in range × 100), `dominantAgeBand`, `genderSplit: { malePct, femalePct }`. hourly_zone_metrics gets `bounced` and age band columns as needed.
- `/analytics/journey` accepts `storeIds` (several stores: zones merged by zone name) as well as `storeId`, and adds `totalFootfall` and
  `highlights: { highestFootfall, highestImpression, highestBounced, highestEngaged, highestDwell }`, each `{ zoneName, value, label }` (value: visits, % of footfall, bounced %, engaged %, avg dwell sec).
- `AlertRule.metric` adds `"CHECKLIST_OVERDUE"|"CHECKLIST_NON_COMPLIANCE"|"AI_MANAGER_BREACH"|"EDGE_OFFLINE"`; AlertRule adds `autoTicket: boolean` (when true, each new alert also opens a Ticket; CAMERA_OFFLINE / EDGE_OFFLINE → category CAMERA / NETWORK).
- Checklist question adds `referenceImageUrl?: string`, `aiCheck: "NONE"|"REFERENCE_MATCH"|"UNIFORM"` (default NONE), `createTaskOnFail: boolean`; type adds `"VIDEO"` (answer value = uploaded video url; scores like PHOTO). `/api/uploads` accepts images (jpeg/png/webp) and videos (mp4/webm/quicktime) up to 50 MB.
- `Answer` adds `aiResult: { status: "PASS"|"FAIL"|"ERROR"|"SKIPPED", score: number, message: string, issues: string[], annotatedUrl?: string } | null` and `flagged: boolean` (true when a YES_NO is NO, an MCQ is wrong, a NUMBER is out of range, or aiResult FAIL). An AI FAIL scores 0 for that question. `Submission` adds `flags: number`.
- `Assignment` adds `dueAt` (ISO), `windowStart` (ISO|null), `scheduleId|null`, status adds `"IN_PROGRESS"` (a draft exists) and `"OPEN"` alias is not used (PENDING = open).
- `Task` adds `startAt` (scheduled visibility), `checklistAnswerId|null`, `proofUrl|null`, `remark|null`. `PATCH /api/tasks/:id/status` body `{ status, proofUrl?, remark? }`.

## New endpoints

### Image directory & recap video
| Method | Path | Response |
|---|---|---|
| GET | `/api/image-directory?storeIds&cameraId&kind&from&to&page&pageSize` | **paged** `{ id, storeId, storeName, cameraId, cameraName, ts, kind, url }` newest first |
| GET | `/api/recaps?storeIds&from&to` | `Recap[]` |
| POST | `/api/recaps/generate` | body `{ storeId, date }` → `Recap` (synchronous; 422 with message when there are no snapshots) |
| GET | `/api/recaps/:id` | `Recap` |

`Recap = { id, storeId, storeName, date, status: "PENDING"|"READY"|"FAILED", url: string|null, durationSec, frameCount, error: string|null, createdAt }`.
Built with ffmpeg (npm `ffmpeg-static`) from that store-day's snapshots (all cameras, time order, each frame ~0.25 s, capped so the video is < 120 s, H.264 `yuv420p` mp4, `+faststart`, scaled to 1280 wide). A cron at 23:45 store-local builds yesterday's/today's recap for every store. The seed (or the simulator) must leave at least one READY recap for store 1.

### Infra health
`GET /api/infra/health?storeIds` →
```ts
{ totals: { stores, healthy, degraded, down, camerasOnline, camerasTotal, openInfraTickets },
  stores: { storeId, storeName, edgeStatus: "ONLINE"|"OFFLINE"|"NEVER", edgeLastSeenAt, edgeVersion,
            camerasOnline, camerasTotal, uptimePct7d, health: "GOOD"|"DEGRADED"|"DOWN", openTickets,
            issues: string[] }[] }
```
health: DOWN when edge OFFLINE or 0 cameras online; DEGRADED when some cameras offline or uptime < 95 %; else GOOD. Edge OFFLINE = no heartbeat for `CAMERA_STALE_SEC`. "Infra tickets" = tickets in categories CAMERA, NETWORK, INFRASTRUCTURE.

### Traffic density
`GET /api/analytics/traffic-density` (common params) → `{ cells: { dow /*0=Sun*/, hour, avgFootfall }[], max, hours: number[] }` covering store open hours.

### Grouped benchmark
`GET /api/analytics/benchmark/groups?groupBy=region|format|city` (common params) →
`{ group, stores, footfall, conversionPct, revenue, atv, avgDwellSec, bouncedPct, engagedPct, missedOpportunities }[]`. `/analytics/benchmark` rows also add `format`, `bouncedPct`, `engagedPct`.

### Trax v2
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/checklists/schedules` | `Schedule` |
| PATCH/DELETE | `/api/checklists/schedules/:id` | |
| POST | `/api/checklists/schedules/:id/generate` | generate today's assignments now → `{ created }` (idempotent per store+date) |
| POST | `/api/checklists/assignments/:id/draft` | `{ answers: [...] }` partial; status → IN_PROGRESS; `GET /assignments/:id` returns `draftAnswers` |
| GET | `/api/checklists/dashboard?storeIds&from&to` | `TraxDashboard` |
| POST | `/api/checklists/answers/:answerId/task` | `{ title?, assigneeId, dueAt, priority? }` → `Task` (type FOLLOW_UP, checklistAnswerId set) |
| POST | `/api/tasks/bulk` | `{ storeIds: number[], title, description?, type?, priority?, dueAt?, startAt?, assigneeId? }` → `Task[]` (assignee defaults to that store's first active STORE_MANAGER) |

```ts
Schedule = { id, templateId, templateName, storeIds: number[], assigneeId: number|null /* null = each store's manager */,
             frequency: "ONCE"|"DAILY"|"WEEKLY"|"MONTHLY", repeatEvery: number, daysOfWeek: number[] /*0=Sun, WEEKLY*/,
             dayOfMonth: number|null, windowStart: "HH:mm", windowEnd: "HH:mm", startDate, endDate: string|null,
             reminderMinutesBefore: number, isActive, lastGeneratedDate: string|null }
TraxDashboard = { activeChecklists, checklistInstances, notSubmitted, open, inProgress, submitted,
                  completionScorePct /* submitted ÷ instances */, complianceScorePct /* avg scorePct */, totalFlags,
                  byChecklist: { templateId, name, frequency, stores, assigned, submitted, flags, completionPct, compliancePct }[],
                  byStore: { storeId, storeName, assigned, submitted, flags, completionPct, compliancePct }[],
                  byUser: { userId, name, assigned, submitted, flags, completionPct, compliancePct }[] }
```
Nudges (cron every 5 min, also callable `POST /api/checklists/nudges/run` ADMIN+ → `{ reminders, overdue }`): an assignment due within `reminderMinutesBefore` that is not submitted → one "Reminder" notification to the assignee. Past due → status OVERDUE, notification to assignee + store manager, and CHECKLIST_OVERDUE rule evaluation. A submission with flags → CHECKLIST_NON_COMPLIANCE evaluation (threshold = flags count), plus auto tasks for `createTaskOnFail` questions.

### AI-in-Checklist (backend ↔ ai-service)
When a submission answer has a photo and its question has `aiCheck` ≠ NONE, the backend calls the ai-service synchronously (timeout 20 s; on error aiResult.status = ERROR and the answer is not penalised):
- `POST {aiServiceUrl}/ai/checklist/reference-match` multipart `image`, `reference` → `AiCheckResult`
- `POST {aiServiceUrl}/ai/checklist/uniform` multipart `image` (+ optional form field `uniformHsv` JSON) → `AiCheckResult`
`AiCheckResult = { status: "PASS"|"FAIL", score: 0..1, message, issues: string[], annotatedJpegBase64?: string }`. The backend saves the annotated image under uploads and returns its url as `aiResult.annotatedUrl`.
Also `POST /api/checklists/ai-check` (any role; multipart `image`, `type: REFERENCE_MATCH|UNIFORM`, optional `referenceUrl`) → `aiResult` so the fill page can preview the AI verdict before submitting.

### AI Manager (CCTV-driven checklists)
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/ai-manager/rules` | `AiManagerRule` (ADMIN, REGIONAL_MANAGER write) |
| PATCH/DELETE | `/api/ai-manager/rules/:id` | |
| GET | `/api/ai-manager/detections?storeIds&type&status&ruleId&from&to&page&pageSize` | **paged** `Detection` newest first |
| PATCH | `/api/ai-manager/detections/:id/review` | `{ reviewStatus: "VALID"|"FALSE_POSITIVE" }` |
| GET | `/api/ai-manager/summary?storeIds&from&to` | `{ byType: { type, breached, complied, compliancePct }[], byStore: { storeId, storeName, breached, complied, compliancePct }[], daily: { date, breached, complied }[] }` |
| GET | `/api/ai-manager/open-close?storeIds&from&to` | `{ storeId, storeName, date, scheduledOpen, scheduledClose, actualOpen, actualClose, openStatus: "ON_TIME"|"LATE"|"EARLY"|"MISSING"|"PENDING", closeStatus: "ON_TIME"|"LATE"|"EARLY"|"MISSING"|"PENDING" /* PENDING = today, no event yet, before scheduled time + tolerance; never a breach */, openingSnapUrl, closingSnapUrl, detectionStatus: "BREACHED"|"COMPLIED" }[]` (tolerance from the STORE_OPEN_CLOSE rule `params.toleranceMin`, default 10) |
| POST | `/api/ingest/detections` | edge: `{ detections: { ruleId?, type, cameraId, zoneId?, ts, status: "BREACHED"|"COMPLIED", details?, confidence?, snapshotId? }[] }` → `{ accepted }` |

```ts
AiManagerRule = { id, name, type: "MOBILE_USAGE"|"UNATTENDED_CUSTOMER"|"STORE_OPEN_CLOSE"|"HYGIENE_CLEANING"|"HUDDLE_MEETING"
                  |"UNIFORM_COMPLIANCE"|"STOCK_OUT"|"QUEUE_BREACH",
                  storeIds: number[] /* [] = all */, zoneIds: number[] /* detection areas; [] = whole frame */,
                  windowStart: "HH:mm", windowEnd: "HH:mm", daysOfWeek: number[],
                  params: Record<string, number|string|boolean>, severity, notifyChannels: ("IN_APP"|"EMAIL"|"WEBHOOK")[],
                  notifyEmails: string|null, isActive }
Detection = { id, ruleId, ruleName, type, storeId, storeName, cameraId, cameraName, zoneId, zoneName, ts,
              status: "BREACHED"|"COMPLIED", details, confidence, snapshotUrl, reviewStatus: "VALID"|"FALSE_POSITIVE"|null }
```
Default params: MOBILE_USAGE `{ minDurationSec: 20, staffOnly: true }`; UNATTENDED_CUSTOMER `{ minDurationSec: 120, staffRadius: 0.15 }`; STORE_OPEN_CLOSE `{ toleranceMin: 10 }`; HYGIENE_CLEANING `{ minCoveragePct: 60 }` (staff coverage of the floor area inside the window); HUDDLE_MEETING `{ minPeople: 3, minDurationMin: 5, radius: 0.2 }`; UNIFORM_COMPLIANCE `{ minNonCompliantSec: 60 }`; STOCK_OUT `{ emptyPct: 70 }`; QUEUE_BREACH `{ maxQueue: 5 }`.
Each BREACHED detection fires an AI_MANAGER_BREACH alert (implicit rule built from the AI Manager rule's severity/channels — no separate AlertRule needed) and an in-app notification "<Rule name> breach detected for store <code>" (the "Huddle Breach Alert" nudge). Window-based rules (HUDDLE_MEETING, HYGIENE_CLEANING) report one COMPLIED or BREACHED per store per window.

### Seed additions (backend)
Store formats; a SHELF zone per store; 3 AI Manager rules of each type spread across stores; ~30 days of detections (mix of BREACHED/COMPLIED) with snapshot images; 2 checklist schedules (Opening checklist DAILY 09:30–10:30 for all Chennai stores; VM audit WEEKLY Mon); a template "Signage & Marketing Rollout" with a PHOTO question `aiCheck: REFERENCE_MATCH` + reference image, and "Staff Grooming" with `aiCheck: UNIFORM`; dashboard data with flags; tasks created from deviations; snapshot JPEG images (generate simple synthetic store scenes — e.g. with `sharp` or by pre-rendered JPEGs from the ai-service simulator stored under backend/seed-assets/) for image directory and at least one READY recap for store 1 for yesterday.
