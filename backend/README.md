# Congruence Eye — Backend

NestJS 11 + TypeORM API for **Congruence Eye**, the in-store CCTV video-analytics and retail-operations
platform for Congruence stores (Traffic, Zones, Conversion, Queue, Store Ops, Trax checklists/tasks/tickets,
documents, vendors, alerts, reports and admin).

The REST contract is `../docs/API_CONTRACT.md` and the architecture and metric definitions are in
`../docs/ARCHITECTURE.md`. The API follows the contract exactly. Swagger UI is served at **`/api/docs`**
(JSON at `/api/docs-json`).

| | |
|---|---|
| Runtime | Node 22, NestJS 11, TypeORM 0.3, class-validator, JWT, @nestjs/schedule, multer, exceljs, nodemailer |
| Databases | **SQL Server 2022** (`DB_TYPE=mssql`, production) and **SQLite** (`DB_TYPE=sqlite`, dev and tests) |
| Entry points | `src/main.ts` (API), `src/seed/seed.ts` (demo data), `src/seed/smoke.ts` (full-stack smoke test) |

---

## Quick start (SQLite, no SQL Server needed)

```bash
cd backend
npm ci
SEED_RESET=true DB_TYPE=sqlite npm run seed     # builds and seeds ./data/dev.sqlite (~15 s)
DB_TYPE=sqlite PORT=3000 npm start              # http://localhost:3000/api   (docs: /api/docs)
```

The repository already ships a seeded `data/dev.sqlite`. Seed data is date-relative: the history ends
yesterday and today's raw events run up to the moment of seeding. Re-seed to move "today" forward.

Frontend and E2E settings (SQLite):

```
DB_TYPE=sqlite DB_PATH=./data/dev.sqlite PORT=3000 node dist/main
```

The Angular dev proxy must forward **`/api`** and **`/uploads`**. Uploaded files, checklist photos, generated
reports and documents are served from `/uploads/...`.

## SQL Server

There are two ways to create the schema:

1. **TypeORM sync on first boot**. Set `DB_SYNC=true` (for example in docker compose), start the API once and
   then run `npm run seed:prod` (or `npm run seed`). Set `DB_SYNC=false` afterwards.
2. **Scripts in `../database/`**:
   - `01_schema.sql` creates the `CongruenceEye` database and every table, primary key, unique constraint,
     index and foreign key. It is generated from the entities with `npm run ddl`, so all names match TypeORM.
   - `02_views.sql` creates the Power BI views `vw_daily_store_kpis`, `vw_zone_performance` and
     `vw_checklist_compliance`.
   - `03_seed_reference.sql` adds the settings, the `admin@congruence.in` user (password `Password@123`) and
     the two regions.

   Run the API with `DB_SYNC=false`. Use `npm run seed` with `SEED_RESET=true` for the full demo data set.
   This drops and recreates the tables through TypeORM.

```bash
DB_TYPE=mssql DB_HOST=localhost DB_PORT=1433 DB_USER=sa DB_PASSWORD='YourStrong!Passw0rd' \
DB_NAME=CongruenceEye DB_TRUST_CERT=true DB_SYNC=true npm start
```

All timestamps are stored in UTC (`datetime2`, default `SYSUTCDATETIME()`). `date` columns are store-local
`YYYY-MM-DD` strings (`varchar(10)`) and `hour` is 0..23 store-local. Store-local conversion uses
`Intl.DateTimeFormat` with `stores.timezone` (default `Asia/Kolkata`). Every query is portable: there are no
driver-specific SQL functions, paging uses TypeORM `skip`/`take`, and bulk inserts are chunked below the
SQL Server limit of 2100 parameters.

Docker: `docker build -t congruence-eye-backend .` builds a multi-stage `node:22-alpine` image that runs
`node dist/main`. To seed the database from the container, run `npm run seed:prod`.

## Environment variables

See `.env.example`. A `.env` file in the working directory is loaded automatically.

| Variable | Default | Notes |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | |
| `DB_TYPE` | `sqlite` | `mssql` or `sqlite` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `localhost`, `1433`, `sa`, –, `CongruenceEye` | SQL Server |
| `DB_ENCRYPT`, `DB_TRUST_CERT` | `false`, `true` | SQL Server TLS options |
| `DB_PATH` | `./data/dev.sqlite` | SQLite file; `:memory:` is used in tests |
| `DB_SYNC` | `true` for sqlite, `false` for mssql | TypeORM `synchronize` |
| `DB_LOGGING` | `false` | SQL logging |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | dev secret, `12h` | **Set `JWT_SECRET` in production** |
| `UPLOAD_DIR` | `./uploads` | snapshots, documents, photos, reports; served at `/uploads` |
| `CORS_ORIGIN` | any | comma-separated origins |
| `DISABLE_CRON` | `false` | turns off the background jobs (the tests set it to `true`) |
| `CAMERA_STALE_SEC` | `180` | a camera with no heartbeat for this long becomes OFFLINE (`0` turns this off) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | – | fallback when the SMTP fields in Settings are empty; email is skipped when no host is set |
| `AI_SERVICE_URL` | `http://localhost:8000` | ai-service used for AI-in-Checklist; the `aiServiceUrl` setting overrides it |
| `AI_CHECK_TIMEOUT_MS` | `20000` | timeout for ai-service calls; a timeout sets `aiResult.status` to `ERROR` |
| `FFMPEG_PATH` | npm `ffmpeg-static` | ffmpeg binary for recap videos (ffmpeg-static ships libx264) |
| `SEED_RESET`, `SEED_DAYS` | `false`, `90` | the seed drops and recreates the tables when `SEED_RESET=true` or the DB is empty |
| `RECORDER_SECRET` | dev key + a warning at boot | AES-256-GCM key material for DVR/NVR passwords (sha256 of the value). **Set it in production and keep it stable**: changing it makes stored recorder passwords unreadable (the edge then gets URLs without a password and an error is logged) |

## Seed data

`npm run seed` builds and then runs `node dist/seed/seed.js`; `npm run seed:prod` runs only the compiled
seed. Re-running is safe: the seed skips a database that already has data unless `SEED_RESET=true`.

- **Regions:** Chennai and Coimbatore.
- **Stores:** 1 T Nagar `CNG-TNR`, 2 Anna Nagar, 3 Phoenix Marketcity Velachery, 4 Adyar, 5 OMR Sholinganallur
  and 6 RS Puram (Coimbatore). Most open 10:00–21:30. Velachery closes at 22:00, OMR opens at 10:30 and
  RS Puram closes at 21:00.
- **Cameras and zones:** 5 cameras per store (Entrance, 3 floor ZONE cameras, Billing). 11 zones per store: an
  entry line, 7 sections, `Billing Counter 1` and `Billing Counter 2` (queue alert at 6 people or 300 s) and
  `Cash Desk Staff Area` (STAFF_ONLY).
- **Staff:** a roster of 8 per store.
- **History:** 90 days of hourly store and zone rollups and daily zone transitions. Patterns include
  weekends (+40%), an evening peak from 18:00 to 20:00, the Aadi sale, the pre-Diwali ramp and store size.
  Conversion runs 18–35% and ATV ₹1.5k–3.2k. There are about 112k POS bills that match the rollups exactly.
- **Recent activity:** heatmaps for the last 14 days, store-ops events (late openings and early closings, SOP
  breaches, unattended counters) and camera status intervals. One camera is currently OFFLINE (Adyar, Floor - First).
- **Today:** raw visitor events, queue snapshots and POS bills up to the moment of seeding, processed by the
  real pipeline (`VisitBuilderService`, then `AggregationService`). This feeds `/analytics/live`.
- **Alerts:** 13 alert rules (Camera offline and Edge box offline have autoTicket) and about 40 historical alerts with notifications.
- **Trax:** 4 checklist templates, about 850 assignments and about 800 scored submissions over 60 days, 30
  tasks, about 27 tickets with comments and SLA breaches, 6 vendors with 40 visits, 3 documents and 2 report
  schedules.

### Users (password for all: `Password@123`)

| Email | Role | Stores |
|---|---|---|
| admin@congruence.in | SUPER_ADMIN | all |
| regional@congruence.in | REGIONAL_MANAGER | Chennai stores (1–5) |
| manager.tnagar@congruence.in | STORE_MANAGER | T Nagar (1) |
| auditor@congruence.in | AUDITOR | all |
| staff.tnagar@congruence.in | STAFF | T Nagar (1) |
| ops.admin@congruence.in | ADMIN | all |
| manager.annanagar@ / manager.velachery@ / manager.adyar@ / manager.omr@ / manager.rspuram@congruence.in | STORE_MANAGER | stores 2–6 |

### Dev edge API keys

Each seeded store has an edge device with the deterministic key **`dev-edge-key-store-<storeId>`**
(`dev-edge-key-store-1` … `dev-edge-key-store-6`). Send it in the `X-Api-Key` header to `/api/ingest/*` and
`POST /api/pos/transactions`. Keys are stored as a sha256 hash plus an 8-character prefix. A new key from
`POST /api/edge-devices` or `rotate-key` is returned in plaintext only once.

Heartbeat staleness: a camera is marked OFFLINE after `CAMERA_STALE_SEC` without a heartbeat. This check
only applies to stores whose edge device has reported at least once, so a seeded demo store with no live
edge box keeps its recorded status.

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | compiles to `dist/` |
| `npm start` | `node dist/main` |
| `npm run start:dev` | runs from TypeScript sources with ts-node |
| `npm run seed` / `seed:prod` | builds and seeds / seeds from `dist` |
| `npm test` | unit tests (time helpers, checklist scoring, aggregation + visit builder) |
| `npm run test:e2e` | e2e tests (Jest + supertest, a fresh app per file on SQLite `:memory:` with a light seed) |
| `npm run smoke` | runs the full seed into `data/smoke.sqlite`, boots the real app and calls every analytics, list and export endpoint (checks that values are non-zero and plausible) |
| `npm run lint` | type-checks `src` and `test` |
| `npm run perf` | QA §9 bench: p50/p95 of every analytics endpoint over 90 days × all stores (target < 800 ms) and the big paged lists (< 500 ms) against a running seeded backend (`BASE_URL`, default http://localhost:3400) |
| `npm run ddl` | regenerates `../database/01_schema.sql` from the entities (create plus add-missing-columns upgrade) |
| `npx ts-node -T scripts/gen-recorder-url-vectors.ts` | regenerates the RTSP URL vectors shared with the ai-service (`src/modules/recorders/recorder-url.vectors.json`) |

## How it works

```
edge (X-Api-Key) ─► /api/ingest/events ─► visitor_events ─► VisitBuilder ─► visits
                     /api/ingest/queue  ─► queue_snapshots           │
                     /api/pos/*         ─► pos_transactions          ▼
                                             AggregationService.recompute(store, date, hours)
                                             ─► hourly_store_metrics / hourly_zone_metrics / zone_transitions
                                                     │
                     analytics endpoints read rollups only (plus small raw reads for live, store ops and heatmap)
```

- **Visits:** one `visits` row per non-staff or staff `ENTRY`, matched by `visitorId`. `EXIT` closes the
  visit and sets `dwellSec`. `ZONE_EXIT` events inside the visit window update `maxZoneDwellSec` and the
  zone-engaged flag.
  - **Engaged:** zone dwell ≥ the zone's `engagedDwellSec`, or store dwell ≥ `engagedStoreDwellSec`.
  - **Bounced:** not engaged and store dwell < `bounceSec`.
  - **Repeat:** the same `visitorId` at the store on an earlier day within `repeatWindowDays`.
  - **Auto-close:** a cron closes visits with no EXIT after 3 h.
- **Rollups:** recomputation is idempotent (delete and insert per store/date/hour inside a transaction). It
  runs after every ingest batch (events, queue, POS) for the affected hours. A cron also runs it every 5
  minutes for the current hour. Writes are serialised by an in-process lock (per store on SQL Server,
  global on SQLite).
  - **Groups** with 2 or more members count once, in the hour of the first member. Billable entities are
    individuals plus groups.
  - **Engagement** is stored twice: `engaged` counts people and `engagedEntities` counts billable entities.
- **Alerts:** the engine evaluates every contract metric after each ingest and every minute, with a cooldown
  per rule and store. STORE_OPEN_LATE and STORE_CLOSE_EARLY fire at most once per day. Delivery:
  - in-app notifications to admins and to the regional and store managers of the store;
  - email via nodemailer when SMTP is configured;
  - a webhook POST (fire-and-forget, 5 s timeout);
  - SSE at `GET /api/stream?token=<jwt>` with events `alert`, `notification`, `live` and a 25 s `ping`.
- **Security:**
  - A global JWT guard (opt out with `@Public()`) and `@Roles()`.
  - `StoreScopeService` scopes every query: lists filter silently and single-store requests return 403.
  - The edge API-key guard covers `/api/ingest/*`.
  - An audit interceptor records every create, update and delete (passwords and keys are masked) plus
    logins.
- **Reports:** every report type exports as CSV (UTF-8 BOM) or XLSX. Report schedules run hourly from 07:00
  Asia/Kolkata (DAILY every day, WEEKLY on Monday, MONTHLY on the 1st). Files are written to
  `UPLOAD_DIR/reports` and emailed when SMTP is configured.

## Contract v3 — DVR / NVR recorders (`../docs/API_CONTRACT_V3_RECORDERS.md`)

Code: `src/modules/recorders` (entities `recorders`, `probes`, `discovered_devices`; camera columns `recorderId`, `channel`,
`streamProfile`).

| Area | Endpoints / behaviour |
|---|---|
| Brands | `GET /api/recorders/brands` (any user): HIKVISION, CP_PLUS, DAHUA, UNIVIEW, GODREJ, HONEYWELL, TIANDY, GENERIC_ONVIF, CUSTOM with `defaultRtspPort`, `mainTemplate`, `subTemplate`, `notes`. CUSTOM has empty templates (the recorder's own `urlTemplate` is used). |
| Recorders | `GET/POST /api/recorders?storeId`, `GET/PATCH/DELETE /api/recorders/:id`. Writes: SUPER_ADMIN, ADMIN, or STORE_MANAGER for their own store (REGIONAL_MANAGER, AUDITOR and STAFF are read-only, 403). Validation: host IPv4/IPv6/hostname (stored lower-case), ports 1–65535, channels 1–64, CUSTOM `urlTemplate` must start with `rtsp://` and contain `{channel}` (ignored and stored as null for other brands), same host + RTSP port twice in a store → 409. `DELETE` → 409 while active cameras are linked; `?unlinkCameras=true` unlinks them (their `rtspUrl` becomes empty) and deletes the recorder and its probes. |
| Passwords | Write-only. AES-256-GCM with a random IV (`v1:` + base64(iv, tag, ciphertext)), key = sha256(`RECORDER_SECRET`). Never returned to a browser: responses carry `hasPassword`, and the audit log masks `password`. PATCH: omit (or `""`) keeps the password, `null` clears it. |
| Cameras | `Camera` adds `recorderId`, `channel`, `streamProfile`. `POST /api/recorders/:id/generate-cameras { channels, type?, namePrefix? }` creates `"<namePrefix or Channel> <n>"` cameras, idempotent per channel. Cameras can also be linked with `POST/PATCH /api/cameras` (`recorderId`, `channel`, `streamProfile`; `recorderId: null` unlinks). A channel can be linked to one active camera (409), must be ≤ the recorder's `channels` (400) and the recorder must belong to the camera's store (400). Soft-deleting a camera frees its channel. A linked camera's `rtspUrl` column **stores the masked URL** (`rtsp://admin:****@10.0.0.20:554/Streaming/Channels/301`); it is recomputed when the recorder's host, port, login, brand or template changes. `GET /api/ingest/config` (edge only) returns the real URL plus `recorder { id, brand, kind, host, rtspPort, httpPort, stream }` and, for GENERIC_ONVIF, `onvif { host, httpPort, username, password }`. |
| URL templates | `recorder-url.ts`: `{user}` and `{pass}` are URL-encoded with `encodeURIComponent` (`p@ss:w/rd#1` → `p%40ss%3Aw%2Frd%231`), `{channel}` is 1-based without padding (Hikvision `{channel}01` → channel 3 = `301`), IPv6 hosts are bracketed, an empty password gives `user@host`. The ai-service mirror is tested against the same vectors (`recorder-url.vectors.json`). |
| Probes | `POST /api/cameras/:id/test` → `Probe`, `POST /api/recorders/:id/test { channels? }` → `Probe[]` (every channel by default; same roles as recorder writes). If no edge device of the store has been seen within `CAMERA_STALE_SEC` (or ever), the probe is returned `FAILED` / `EDGE_OFFLINE` straight away. `GET /api/probes/:id`, `GET /api/probes?storeId&recorderId&cameraId` (newest 50). A PENDING or RUNNING probe older than 60 s becomes `EXPIRED` (on every probe read and in the every-minute cron). |
| Edge | `GET /api/ingest/probes` claims the store's PENDING probes (→ RUNNING, an atomic conditional update) and returns `{ id, rtspUrl (real), cameraId, recorderId, channel, brand, streamProfile, onvif }`. `POST /api/ingest/probes/:id` takes multipart `result` (JSON string) + optional `file` (JPEG, saved as `/uploads/probes/<store>/probe-<id>-<rand>.jpg`) or a plain JSON body; 404 for another store's probe, 409 once the probe is OK/FAILED/EXPIRED. `FAILED` without an `errorCode` is stored as `OTHER`; credentials echoed in `error` are redacted. |
| Recorder status | After every result: the latest OK/FAILED result of each channel (≤ `channels`; EDGE_OFFLINE and EXPIRED are ignored) → all OK `ONLINE`, none OK `OFFLINE`, otherwise `PARTIAL`; nothing tested `UNKNOWN`. `lastCheckedAt` = newest of those results. |
| Discovery | `POST /api/ingest/discovered` with `{ devices: [...] }` or a bare array of `{ host, port|rtspPort, httpPort?, brandGuess?, onvif? }`, upserted per store + host + RTSP port. `GET /api/recorders/discovered?storeId` → `{ host, rtspPort, httpPort, brandGuess, onvif, seenAt }[]` newest first. |

v3 seed: each store gets one recorder linked to its 5 cameras (Entrance = ch 1 on the main stream, floors ch 2–4 and
Billing ch 5 on the sub stream): T Nagar Hikvision DVR (PARTIAL: ch 1–5 OK with an entrance snapshot on ch 1, ch 6
NOT_FOUND), Anna Nagar CP Plus DVR (OFFLINE: AUTH failure), Velachery Dahua NVR 16ch (ONLINE), Adyar Hikvision DVR
(UNKNOWN: an EDGE_OFFLINE test), OMR CP Plus DVR and RS Puram CUSTOM hybrid recorder (UNKNOWN). Recorder passwords are
`Cong@<SHORT>#2026` (for example `Cong@TNR#2026`), login `admin`. Five discovered devices for T Nagar, Anna Nagar and
Velachery. `02_views.sql` adds `vw_recorder_health`.

### Contract v3 interpretations

- Recorder writes and connection tests are allowed for SUPER_ADMIN, ADMIN and STORE_MANAGER (own store). "ADMIN+" in
  the contract is read as ADMIN and SUPER_ADMIN, as in v1, so REGIONAL_MANAGER is read-only here.
- `POST /generate-cameras`, `POST /test` and `POST /api/cameras/:id/test` answer 201 (NestJS default for POST);
  the edge endpoints answer 200.
- EXPIRED probes keep `errorCode: null` with `error: "No result from the store's AI box within 60 s"`. EDGE_OFFLINE
  probes have `error: "The store's AI box is offline"`.
- A camera without a recorder is tested with its own `rtspUrl`; one with no URL and no recorder gives 400.
- Claimed probes and `/api/ingest/config` carry extra edge-only fields (`brand`, `streamProfile`, `onvif`, `recorder`).

## Contract v2 (`../docs/API_CONTRACT_V2.md`)

All v2 shape changes and endpoints are implemented. The main pieces:

| Area | Endpoints / behaviour | Code |
|---|---|---|
| Snapshots | `POST /api/ingest/snapshot` (`kind`, `ts`) keeps every snapshot in the `snapshots` table and in `UPLOAD_DIR/snapshots/<store>/<date>/`. It returns `{ ok, snapshotId, url }`. | `modules/media` |
| Image directory | `GET /api/image-directory` (paged, newest first) | `media.controller.ts` |
| Recaps | `POST /api/recaps/generate`, `GET /api/recaps[/:id]`. Videos are H.264 yuv420p mp4 with `+faststart`, 1280 wide, 0.25 s per snapshot and under 120 s, built with `ffmpeg-static`. A cron runs every 15 min: it builds today's recap from 23:45 store-local and fills in yesterday's if it is missing. | `recaps.service.ts` |
| Infra health | `GET /api/infra/health`. Health is DOWN when the edge device is OFFLINE or no camera is online. It is DEGRADED when some cameras are offline or the 7-day uptime is below 95%. Otherwise it is GOOD. | `analytics/infra.service.ts` |
| Analytics | `traffic-density` and `benchmark/groups` (region / format / city).<br>Zones add `bouncedPct`, `concentrationPct`, `dominantAgeBand` and `genderSplit`.<br>Journey accepts multiple `storeIds` and adds `highlights`.<br>Traffic `hourly.bouncedPct` and conversion `hourly.customersPerStaff` are added. | `analytics.service.ts` |
| Alerts | New metrics `CHECKLIST_OVERDUE`, `CHECKLIST_NON_COMPLIANCE`, `AI_MANAGER_BREACH` and `EDGE_OFFLINE`.<br>With `autoTicket`, an alert opens a ticket (CAMERA, NETWORK or OTHER). If an open ticket already exists for the same store and issue, the alert is linked to it instead. | `alert-engine.service.ts` |
| Trax | Schedules with `/generate` (idempotent per schedule, store and date), drafts, the dashboard, follow-up tasks from answers, bulk tasks.<br>Nudges run every 5 min and on `POST /api/checklists/nudges/run`. | `checklists/*`, `tasks/*` |
| AI-in-Checklist | PHOTO questions with `aiCheck` call `{aiServiceUrl}/ai/checklist/reference-match` or `/uniform` (multipart, 20 s timeout).<br>`FAIL` gives the question 0 points and flags it; `ERROR` does not penalise the answer. Annotated images are stored under `/uploads/ai/`.<br>The submit flow is unchanged otherwise; `POST /api/checklists/ai-check` returns a preview. | `ai-check.service.ts` |
| AI Manager | Rules, detections (paged), review, summary, open-close, `POST /api/ingest/detections`.<br>Each BREACHED detection raises an AI_MANAGER_BREACH alert (no AlertRule needed) and sends the notification "&lt;rule&gt; breach detected for store &lt;code&gt;". | `modules/ai-manager` |

v2 seed additions:
- **Stores and zones:** store formats (HIGH_STREET, MALL, OUTLET) and a SHELF zone per store with a reference snapshot.
- **Images:** about 940 synthetic CCTV JPEGs rendered with `sharp` from SVG scenes (floor, racks, people, timestamp). They cover periodic snapshots, opening and closing snaps linked to store-ops events, and AI Manager evidence.
- **Recap:** a READY recap for T Nagar yesterday, about 59 s long.
- **AI Manager:** 24 rules (3 per type) and about 30 days of detections, with breach alerts and notifications for the last 48 h.
- **Edge health:** the Adyar edge box is OFFLINE, so the store shows DOWN in infra health and has a NETWORK ticket.
- **Trax:** 2 checklist schedules, the "Signage & Marketing Rollout" (REFERENCE_MATCH) and "Staff Grooming" (UNIFORM) templates with AI results, flags on every submission, and deviation tasks.

Upgrading a v1 SQL Server database: re-run `01_schema.sql`, which now also adds missing columns, then `02_views.sql`. Alternatively, boot once with `DB_SYNC=true`.

### Contract interpretations

- `GET /api/analytics/zones` returns **SECTION** zones (the HOT/WARM/DEAD comparison only makes sense
  between sections). Queue counters are reported by `/analytics/queue` `byCounter`.
- In traffic, `engaged` and `bounced` count visits (people) and `casual = footfallIn − engaged`. The
  conversion funnel `engaged` and `missedOpportunities` use **engaged billable entities**, so a group counts
  once.
- Overview `openAlerts` is the current count of OPEN alerts in scope and has no `previous` value. All other
  KPIs include `previous` and `changePct` when `compare=true`. When the previous value is 0, `changePct` is
  100, or 0 if both values are 0.
- `DELETE` on stores, cameras, zones and checklist templates deactivates the record (`isActive=false`) so
  history is kept. Regions (409 if they still have stores), staff, edge devices, tasks, documents and report
  schedules are deleted outright. A vendor that has visits is deactivated instead of deleted.
- In the POS CSV import, a `ts` without a UTC offset is read as store-local time.
- `/api/analytics/heatmap`, `/journey` and `/live` use the first store in scope when `storeId` is omitted.
- v2 zones:
  - `genderSplit` percentages are shares of the visitors whose gender is known, so they add up to 100 (both are 0 when no gender is known).
  - `concentrationPct` divides engaged visits by the footfall of the zone's own store.
  - `dominantAgeBand` is null when no age is known.
- v2 journey with several stores: zones are merged by name, and the node id is the lowest zone id with that name.
  - `highestImpression` = the zone's unique visitors ÷ total footfall.
  - Highlights only consider SECTION zones that had visits.
- `customersPerStaff` = Σ billable entities ÷ Σ `staffPresentAvg` over the hour's rows. It is 0 when there is no staff.
- Trax dashboard: `notSubmitted` counts OVERDUE assignments and `open` counts PENDING ones. Instances are the assignments whose due date falls in the range.
- An assignment with no `dueAt` gets 23:59 store-local on its `dueDate`. A reminder is sent once (`remindedAt`).
- Overdue processing notifies the assignee and the store managers only for deadlines missed in the last 24 h. It also runs when assignments are listed.
- `aiCheck` is only allowed on PHOTO questions. `REFERENCE_MATCH` requires `referenceImageUrl`. Without a reference image the result is `SKIPPED`.
- Tasks with a future `startAt` are hidden from `GET /api/tasks?mine=true` until that time. Managers still see them in normal lists.
- AI Manager:
  - Window rules (HUDDLE_MEETING, HYGIENE_CLEANING) accept only the first detection per rule, store and date.
  - The summary leaves out detections reviewed as FALSE_POSITIVE.
  - In open-close, `detectionStatus` is BREACHED when the open or close is LATE or EARLY, or when a past day is MISSING.
- Seeded settings rows leave out `aiServiceUrl`, so `AI_SERVICE_URL` (for example a docker hostname) applies.
