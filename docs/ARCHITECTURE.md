# Congruence Eye — Architecture

An in-store CCTV video-analytics and retail-operations platform for Congruence stores. It is modeled on the module set of Tango Eye (Traffic, Zone, RevOp, StoreOps and Trax).

```
 CCTV cameras (RTSP)                                   Browser (Angular 22 SPA)
        │                                                        │  JWT, REST + SSE
        ▼                                                        ▼
 ┌──────────────────┐   X-Api-Key / REST   ┌────────────────────────────────────┐
 │  ai-service      │ ───────────────────► │  backend  (NestJS 11, TypeORM)     │
 │  Python 3.11+    │  events, queue,      │  /api/*                            │
 │  YOLO + ByteTrack│  heatmap, heartbeat, │  ingestion → visits → hourly       │
 │  per-store edge  │  storeops, snapshots │  rollups → analytics / alerts      │
 └──────────────────┘ ◄─────────────────── │  Trax: checklists, tasks, tickets  │
          GET /api/ingest/config           └──────────────┬─────────────────────┘
                                                          │ mssql (tedious)
                                                          ▼
                                               ┌─────────────────────┐
                                               │ SQL Server 2022     │
                                               └─────────────────────┘
```

## Folders

| Folder | What it is |
|---|---|
| `database/` | T-SQL scripts: `01_schema.sql`, `02_views.sql`, `03_seed_reference.sql` |
| `backend/` | NestJS API. Uses `DB_TYPE=mssql` in production and `DB_TYPE=sqlite` for fast local tests |
| `frontend/` | Angular SPA (standalone components, Angular Material, ECharts) |
| `ai-service/` | Python vision pipeline that runs one process per store (edge box or server) |
| `e2e/` | Playwright end-to-end tests across the full stack |
| `docs/` | Architecture, API contract and module guide |

## Module map (Tango Eye equivalent → Congruence Eye)

| Tango Eye | Congruence Eye module | Key features |
|---|---|---|
| Tango Traffic | Traffic | Footfall in/out with staff excluded, unique visitors, individuals vs groups, billable entities, engaged vs casual, bounce, repeat vs new, demographics (age band and gender), hourly/daily trends, peak hours, live occupancy |
| Tango Zone | Zones | Zone tagging (polygons on camera view), zone visits and dwell, zone demographics, heatmaps, hot/warm/dead zones, customer journey (zone-to-zone transitions) |
| Tango RevOp | Conversion | POS integration (API and CSV), conversion %, ATV, revenue, funnel (footfall → engaged → billed), bounced / missed opportunity / converted segmentation, staff accountability by hour |
| Queue | Queue | Billing queue length, wait time, counter open/unattended, threshold breaches |
| Tango StoreOps | Store Ops | Actual vs scheduled open/close, SOP breaches, camera and network downtime, uptime %, staff presence, edge device health |
| Tango Trax | Checklists & Audits | Templates (yes/no, MCQ single/multi, text, number, rating, photo), weighted scoring, sections, assignments, submissions, review with redo, compliance score per store |
| Tango Trax | Tasks | Assign, prioritise, schedule and verify; zone-allocation tasks |
| Tango Trax | Tickets | Ticketing (planogram, infrastructure, camera, network), SLA, comments, ticket from an alert |
| Tango Trax | Documents | SOP / circular document library with per-store targeting |
| Tango Trax VMS | Vendors | Vendor master, visit scheduling, check-in/out, rating |
| Platform | Alerts | Rule engine (queue, wait, camera offline, late open, early close, footfall drop, conversion drop, SOP breach, staff shortage), in-app + email + webhook, ack/resolve, live SSE stream |
| Platform | Reports & Benchmarking | Multi-store league table, compare with the previous period, CSV/XLSX export, scheduled email reports |
| Platform | Admin | Users and roles (RBAC), regions, stores, cameras, zones, edge devices and API keys, staff roster, settings, audit log |

## Data flow

1. The **AI service** pulls camera and zone configuration (`GET /api/ingest/config`) using its edge API key.
2. For each camera it detects people (YOLO), tracks them (ByteTrack) and emits:
   - `ENTRY` / `EXIT` when a track crosses an entry line (EXIT carries `dwellSec`)
   - `ZONE_ENTER` / `ZONE_EXIT` for section polygons (ZONE_EXIT carries `dwellSec`)
   - queue snapshots for queue zones (length, estimated wait, counter staffed)
   - heatmap grids (32×18 occupancy counts)
   - camera heartbeats and store-ops events (store opened/closed, counter unattended, SOP breach)
   - staff flag (uniform colour match or staff-only zone) and group id (people entering together)
   - optional demographics (age band and gender) and a re-identification hash `visitorId`
3. The **backend** stores raw events, builds `visits` (one row per customer visit), and recomputes `hourly_store_metrics`, `hourly_zone_metrics` and `zone_transitions` for the affected hours. Recomputation is idempotent.
4. **Analytics endpoints** read only the rollups, so dashboards stay fast over long ranges.
5. The **alert engine** evaluates rules after each ingest and every minute, then pushes alerts over SSE.

## Metric definitions

- **Footfall**: non-staff ENTRY events.
- **Billable entities**: individuals plus groups. A group of N people counts once.
- **Engaged**: a visit with any zone dwell ≥ that zone's `engagedDwellSec` (default 30 s), or a store dwell ≥ the `engagedStoreDwellSec` setting (default 300 s).
- **Bounced**: a visit that is not engaged and has store dwell < the `bounceSec` setting (default 60 s).
- **Conversion %**: transactions ÷ billable entities × 100.
- **Missed opportunities**: max(0, engaged billable entities − transactions).
- **Repeat visitor**: a `visitorId` seen at the same store in the previous 30 days.
- **Zone class**: HOT when visits ≥ 1.25 × the store's zone average, DEAD when ≤ 0.5 ×, otherwise WARM.
- **Compliance score**: average checklist submission % over the period.

All `date` and `hour` values are in store-local time (`stores.timezone`, default `Asia/Kolkata`).
