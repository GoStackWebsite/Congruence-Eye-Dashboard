# Congruence Eye — Frontend

Angular SPA for **Congruence Eye**, the in-store CCTV video analytics and store-operations platform for Congruence stores (Tango Eye module set: Traffic, Zones, RevOp/Conversion, Queue, Store Ops, Trax checklists/tasks/tickets/documents/vendors, Alerts, Reports, Admin).

- **Angular 21.2** (standalone components, signals, `@if`/`@for` control flow, zoneless change detection, functional guards/interceptors, lazy routes per feature)
- **Angular Material 21 (M3 theme)** with light/dark mode, **ECharts 6** via `ngx-echarts` (tree-shaken, lazy-loaded)
- Self-hosted fonts (Inter, Material Symbols) — works on store intranets without Google Fonts
- Unit tests with **Vitest** (Angular's `@angular/build:unit-test`, jsdom — no browser needed)
- **Installable PWA** (`@angular/pwa`): web manifest, branded icons and a service worker in production builds, so store staff can add it to their phone's home screen for checklists and tasks
- Implements `docs/API_CONTRACT.md` **and** the v2 addendum `docs/API_CONTRACT_V2.md` (Tango Eye feature parity)

> Why Angular 21 and not 22: Angular CLI 22 requires Node ≥ 22.22.3. The build machine has Node 22.22.0, so the latest compatible major (21.2) is used. The code uses no 22-only APIs; upgrading later is `ng update @angular/core@22 @angular/cli@22 @angular/material@22`.

## Quick start

```bash
npm install            # .npmrc sets legacy-peer-deps (works around an npm 10 peer-set resolver bug)
npm start              # ng serve on http://localhost:4200, proxying /api and /uploads → http://localhost:3000
npm test               # unit tests, single run (npm run test:watch for watch mode)
npm run build          # production build → dist/frontend/browser
```

Log in with a seed user (password `Password@123` for all): `admin@congruence.in`, `regional@congruence.in`, `manager.tnagar@congruence.in`, `auditor@congruence.in`, `staff.tnagar@congruence.in`.

### Backend / proxy

`proxy.conf.json` forwards `/api` and `/uploads` to `http://localhost:3000` (configured as the default for `ng serve`). Start the backend first, e.g.:

```bash
cd ../backend && DB_TYPE=sqlite DB_PATH=./data/dev.sqlite PORT=3000 node dist/main.js
```

### Environment

`src/environments/environment.ts` (production) and `environment.development.ts` (used by `ng serve` / `build:dev`):

| Key | Default | Purpose |
|---|---|---|
| `apiBaseUrl` | `/api` | REST base path (same origin; nginx / dev proxy forwards it) |
| `streamPath` | `/stream` | SSE endpoint → `GET /api/stream?token=<jwt>` |
| `notificationPollMs` | `60000` | Fallback polling of `/api/notifications` when SSE is unavailable |
| `liveRefreshMs` | `15000` | Live page auto-refresh |

## v2 features (API_CONTRACT_V2.md)

| Area | What the UI does |
|---|---|
| Traffic | Traffic density heat-table (hour × Mon–Sun, blue scale), hourly drop-off (bounced %) chart, conversion flow Footfall → Engagers → Billable entities → Conversion, "Gender & dwell time" card |
| Conversion | Flow chart in the v2 order; customers-per-staff by hour |
| Zones | Bounced %, concentration %, dominant age, gender split; "Zone concentration summary" with a heatmap thumbnail of the top zone's camera |
| Journey | Multi-store selection (zones merged by name) and 5 highlight cards above the sankey |
| Benchmark | Group by store / region / format / city (`/analytics/benchmark/groups`); format column |
| Image directory / Recap | Paged snapshot gallery with lightbox; recap list + HTML5 player + "Generate recap" (422 shown inline) |
| Infra health | Totals, per-store GOOD / DEGRADED / DOWN, issues, open infra tickets, one-click pre-filled infra ticket |
| Trax | Compliance dashboard (tiles + checklist/store/user tabs + export), smart schedules (frequency, repeat, days, window, start/end, stores, assignee, reminder, generate now), VIDEO questions, AI check (reference match with reference image upload / uniform), create-task-on-fail, section-wise drafts with resume, "Check with AI" preview (ERROR never blocks submission), flags + AI results + answer→task on submissions, bulk tasks across stores, `startAt`, completion proof + remark |
| AI Manager | Rules editor (type, detection areas filtered to relevant zone types of the chosen stores, window, days, per-type params with defaults, severity, notify), detections gallery/table with review, summary (type / store / daily), open/close cards with opening & closing snaps |
| Admin | Store format, SHELF zones with a reference snapshot picked from the image directory, new alert metrics + auto-ticket, AI service URL and checklist reminder settings, "run nudges now" |
| Notifications | Kind icons (alert, AI breach, reminder, overdue) and deep links: `/alerts/:id` (highlighted row), `/ai-manager/detections?id=`, `/checklists/assignments/:id` (→ fill page) |

## Design system v2 (Phase A)
- Spec: `../docs/DESIGN_SYSTEM.md`; usage with snippets: `../docs/STYLE_GUIDE.md`; living catalogue at `/_styleguide` (development build only).
- Global styles are split under `src/styles/` (tokens → Material restyle → base → shell → DS → legacy → screens). Components: `src/app/shared/ds/` (`import { DS } from 'shared/ds'`).
- Shell: 64px icon rail (modules Home · Traffic · Zone · Revenue · Trax · AI Manager · Store Ops · Reports · Admin, role-filtered from `NAV_MODULES`), 224px module panel with count badges (open alerts, overdue checklists, open tickets), 56px top bar with breadcrumbs, grouped store selector (All / Region / Format / stores), date presets + range, Compare, refresh + "Last refreshed". Below 1024px a slide-over menu and a filter sheet; below 768px a bottom tab bar.
- Rebuilt on the DS: login, home ("HQ morning view"), Trax checklist dashboard, AI Manager rule editor (full page `/ai-manager/rules/new|:id`), zone concentration summary. Other pages render inside the new shell with re-skinned v1 styles.
- Charts use the ECharts theme `congruence` / `congruence-dark` (palette validated for colour-blind separation).
- Screenshots: `../docs/screenshots/phase-a/`.

## PWA

`ng build` (production) emits `ngsw-worker.js` + `ngsw.json`; the service worker registers 30 s after the app is stable and is disabled in `ng serve`. `ngsw-config.json` prefetches the app shell and lazily caches icons/fonts only — `/api/**` and `/uploads/**` are never cached and are excluded from navigation fallback. `public/manifest.webmanifest` declares standalone display, theme colour and shortcuts to *My checklists* and *My tasks*. nginx serves `ngsw-worker.js`, `ngsw.json` and the manifest with `Cache-Control: no-cache` so updates roll out. Installing requires HTTPS (or `localhost`).

## Online demo (no backend)

`npm run build:demo` → `dist/demo/browser` (static files, relative URLs, hash routing, no service worker) plus `dist/demo/page.html` (inner page content only — title, stylesheet link, `<app-root>`, main script — for hosts that wrap pages in their own `<html>/<head>/<body>`).

- Everything demo-only sits behind the `demo` build configuration: `environment.demo.ts` and `src/app/demo/demo.providers.demo.ts` replace their normal counterparts, so `npm run build` contains no demo code.
- An in-browser backend (last HTTP interceptor) serves every `/api` call from responses captured from the real API (`src/demo-data/*.json`, fetched lazily per area). Captured dates are shifted to today (dates by whole days, timestamps by the exact time since capture). Analytics requests map to the captured preset (Today / Yesterday / Last 7 / Last 30 / This month; custom ranges → nearest length) and store scope (one store or all; subsets filter list-shaped results).
- Writes (tasks, alerts, tickets, checklists incl. drafts, submit with real scoring, AI-check preview, schedules, AI Manager rules, admin CRUD…) live in memory and reset on reload. Uploads become `blob:` URLs. Exports and document downloads open an in-app preview instead of downloading.
- Recorders and connection tests are simulated: a test answers PENDING → RUNNING → done after ~1.5 s, OK (1080p H.264) for every channel except the last channel of each recorder, which fails with AUTH; recorder status follows the results. The demo applies the contract v4 rules too (answer validation with `missingQuestionIds` / `invalidAnswers`, assignee scope, 409 on comments to closed tickets, template versions, `isLate`, audit before / after, 50 MB uploads, 204 for a camera without a snapshot).
- Sign in with the quick buttons on the login page (all seed users, password `Password@123`).
- Images are packed into `demo-data/media/pack-*.json` (base64) to stay under the host's file limit; the recap video is a real mp4.

Refresh the data from a built backend with `npm run capture:demo` (starts `backend/dist/main.js` on copies of `backend/data/dev.sqlite` and `backend/uploads`), then `npm run build:demo`. `node scripts/demo-sweep.mjs` then serves `dist/demo` like the host (page.html under a deep sub-path) and opens every route of `e2e/support/routes.ts` as admin, staff and auditor at 1440 and 390 px, plus a recorder connection test; any console error, failed request or HTTP ≥ 400 fails it.

## Docker

Multi-stage image: Node build → nginx serving the SPA with `/api` (including unbuffered SSE on `/api/stream`) and `/uploads` proxied to `backend:3000`, SPA fallback to `index.html`, long-cache for hashed assets.

```bash
docker build -t congruence-eye-frontend .
docker run -p 8080:80 --network <net-with-backend> congruence-eye-frontend
```

The upstream host name `backend` is set in `nginx.conf`; change it if your backend service is named differently.

## Architecture

```
src/app
├── core
│   ├── models/api.models.ts      TypeScript mirror of docs/API_CONTRACT.md (every request/response shape)
│   ├── auth/                     AuthService (JWT in localStorage), guards, interceptors, permissions + nav model
│   ├── services/                 ApiService (HTTP + downloads), AnalyticsApi, FilterService, LookupService,
│   │                             NotificationService (SSE + polling), ThemeService, loadOn() reactive loader
│   └── utils/                    query-param builder, dates/presets, INR formatting, checklist scoring,
│                                 template validation, zone geometry, heat colours, safe localStorage
├── shared                        pipes (inr, num, pct, duration, dt…), chart wrapper/theme/builders,
│                                 KPI card, status chip, empty/loading states, store picker, camera snapshot,
│                                 generic CRUD page + entity form dialog
├── layout                        shell (sidenav, top bar), global filter, notification bell, change password
└── features                      one folder per module, each lazy loaded
```

Key behaviours:

- **Global filter** (`FilterService`): store multi-select limited to the user's stores, period presets (Today, Yesterday, Last 7 days, Last 30 days, This month, Custom) and "compare with previous period". Signal based, persisted to `localStorage` (`ce.filter`, all access wrapped in try/catch). Every analytics page derives its query from `filter.params()`; structurally equal params never re-trigger requests. Store ids are sent as `storeIds=1,2,3`; an empty selection means "all stores in scope".
- **HTTP**: `authInterceptor` adds `Authorization: Bearer`; `errorInterceptor` logs out to `/login` on 401 and shows a snackbar for other errors (requests can opt out with `silent()`).
- **Notifications**: `EventSource('/api/stream?token=…')` listening for `alert`, `notification` and `live` events; on failure falls back to polling every 60 s and retries SSE every 5 min. Unread badge = unread items in the newest-100 list.
- **Camera snapshots** are fetched as blobs through `HttpClient` (the endpoint needs the bearer token), with a grey fallback stage on 404.
- **Charts** follow one palette (fixed categorical order, single-hue sequential ramp for magnitudes, reserved status colours with icon + label). Where two measures have different scales (e.g. footfall vs conversion %) they are drawn as two stacked grids sharing the x-axis instead of a dual-axis chart.
- **Formatting**: INR with en-IN lakh/crore grouping (`₹12,34,567`, compact `₹12.35 L`, `₹1.86 Cr`).

## Role → menu mapping

Defined in `src/app/core/auth/permissions.ts` (`PERMISSIONS`, `NAV`) and enforced by `permissionGuard` on every route; hidden menu items are also blocked by URL. Unauthorised routes redirect to the role's home page.

| Menu item / route | SUPER_ADMIN, ADMIN | REGIONAL_MANAGER | STORE_MANAGER | AUDITOR | STAFF |
|---|:-:|:-:|:-:|:-:|:-:|
| Dashboard `/dashboard` | ✓ | ✓ | ✓ | ✓ | |
| Live view `/live` | ✓ | ✓ | ✓ | | |
| Analytics `/analytics/*` (traffic, demographics, zones, heatmap, journey, conversion, queue, store ops, benchmark) | ✓ | ✓ | ✓ | ✓ | |
| Alerts `/alerts` (ack / resolve / ticket) | ✓ | ✓ | ✓ | | |
| Checklist templates `/checklists` (view + builder) | ✓ | ✓ | | ✓ | |
| Assignments `/checklists/assignments` | ✓ (assign) | ✓ (assign) | ✓ (assign) | ✓ (assign) | ✓ "My checklists" |
| Fill checklist `/checklists/fill/:id` | assignee | assignee | assignee | assignee | assignee |
| Submissions + review `/checklists/submissions` | ✓ | ✓ | ✓ | ✓ | own submission detail only |
| Compliance `/checklists/compliance` | ✓ | ✓ | ✓ | ✓ | |
| Tasks `/tasks` | ✓ create/verify | ✓ create/verify | ✓ create/verify | ✓ view/status | ✓ "My tasks" (status only) |
| Tickets `/tickets` | ✓ manage | ✓ manage | ✓ manage | create/comment | create/comment |
| Documents `/documents` | ✓ upload | ✓ upload | ✓ upload | view/download | view/download |
| Vendors `/vendors` (vendors + visits) | ✓ | ✓ | ✓ | | |
| Reports `/reports` (exports, schedules) | ✓ | ✓ | ✓ (+ POS import) | ✓ | |
| Admin: stores (+ cameras & zone editor), regions, edge devices, users, alert rules, settings, audit log | ✓ | | | | |
| Admin: staff roster `/admin/staff` | ✓ | ✓ | ✓ | | |
| **v2** Infra health `/infra-health` (+ infra tickets) | ✓ | ✓ | ✓ | | |
| **v2** Image directory `/traffic/image-directory`, Recap video `/traffic/recap` | ✓ | ✓ | ✓ (+ generate recap) | ✓ (view) | |
| **v2** Checklist dashboard `/checklists/dashboard` | ✓ | ✓ | ✓ | ✓ | |
| **v2** Checklist schedules `/checklists/schedules` | ✓ | ✓ | ✓ | ✓ | |
| **v2** AI Manager detections / summary / open-close | ✓ | ✓ | ✓ (+ review) | ✓ (view) | |
| **v2** AI Manager rules `/ai-manager/rules` | ✓ edit | ✓ edit | view | view | |

Landing page after login: STAFF → `/tasks`; everyone else → `/dashboard`. The server remains the authority: store scoping (`user.storeIds`) and write permissions are enforced by the API; the UI hides what a role can't do.

## Testing

- `npm test` runs Vitest once in jsdom (no browser required). v2 adds specs for the V2 API service (paths, params, multipart + silent AI check), density matrix, AI Manager param defaults/validation, schedule summary/validation/payload, notification kinds/deep links, conversion-flow order, VIDEO scoring, AI-check template rules, dashboard performance rows, journey highlights, zone concentration ranking, infra health sorting, recap ordering, the completion-proof dialog and the image lightbox. v1 specs cover: auth service + interceptors (login, bearer header, 401 → logout, session restore/expiry), filter service (presets, persistence, scope limiting, throwing storage), query-param builder, INR formatting/pipes, date presets, checklist score preview (all contract scoring rules), template validation, zone-editor coordinate normalisation and payloads, sankey cycle removal, CSV export, SLA logic, task move rules, KPI card, status chip, empty state and the login page.
- E2E (Playwright) lives in `../e2e`. All stable selectors are documented in **[TESTIDS.md](./TESTIDS.md)**.
