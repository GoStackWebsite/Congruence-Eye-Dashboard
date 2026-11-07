# UI edge-case plan — Congruence Eye (frontend + end to end)

Owner: QA (frontend / E2E). Scope: every SPA route for every role, the client's "recheck all features and all
scenarios, also check edge cases and reconfirm", and "the UI must be professional, usable in stores". The plan is
executable: every row names the Playwright test that proves it (`e2e/tests/edge-*.spec.ts`, plus the existing feature
specs). **Status** is the result of the final `scripts/run-all-tests.sh` run on master (see the end of this file).

Roles: admin (SUPER_ADMIN), regional (REGIONAL_MANAGER), manager (STORE_MANAGER, T Nagar), auditor, staff.
Viewports: desktop 1440×900, tablet 768×1024, phone 390×844 (touch). Themes: light and dark.

How to run one area: `cd e2e && npx playwright test tests/edge-sweep.spec.ts` (servers start automatically; see
`e2e/global-setup.ts`). Screenshots for visual review: `E2E_SHOTS=true npx playwright test tests/edge-visual.spec.ts`
→ `docs/screenshots/qa/`.

## 1. Every route × role (sweep, accessibility, access)

Each route below is opened by every role that may see it (sweep) and by every role that may not (RBAC). For each:
**S1** renders its page root; **S2** zero console errors, page errors and failed / ≥ 400 requests; **S3** no `NaN`,
`Infinity`, `undefined`, `null`, `[object Object]` or `Invalid Date` in the rendered text; **S4** no horizontal page
overflow at 768×1024 and 390×844 (`scrollWidth ≤ clientWidth + 1`); **A1/A2** axe (WCAG 2.1 A/AA): no serious or
critical violation in light and dark (admin covers every route, staff the phone pages at 390×844); **P1** a role that may
not open it lands on its home page (staff → /tasks, others → /dashboard) without rendering the forbidden page.

| ID | Route | Page root | Allowed roles | Scenario | Expected | Test | Status |
|---|---|---|---|---|---|---|---|
| R01 | `/dashboard` | `page-dashboard` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R02 | `/live` | `page-live` | admin, regional, manager | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R03 | `/analytics/traffic` | `page-traffic` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R04 | `/analytics/demographics` | `page-demographics` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R05 | `/analytics/zones` | `page-zones` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R06 | `/analytics/heatmap` | `page-heatmap` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R07 | `/analytics/journey` | `page-journey` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R08 | `/analytics/conversion` | `page-conversion` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R09 | `/analytics/queue` | `page-queue` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R10 | `/analytics/store-ops` | `page-store-ops` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R11 | `/analytics/benchmark` | `page-benchmark` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R12 | `/traffic/image-directory` | `page-image-directory` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R13 | `/traffic/recap` | `page-recap` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R14 | `/alerts` | `page-alerts` | admin, regional, manager | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R15 | `/alerts/{alert}` | `page-alerts` | admin, regional, manager | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R16 | `/infra-health` | `page-infra-health` | admin, regional, manager | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R17 | `/ai-manager/summary` | `page-ai-summary` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R18 | `/ai-manager/detections` | `page-ai-detections` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R19 | `/ai-manager/open-close` | `page-ai-open-close` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R20 | `/ai-manager/rules` | `page-ai-rules` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R21 | `/ai-manager/rules/new` | `page-ai-rule-editor` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R22 | `/ai-manager/rules/{rule}` | `page-ai-rule-editor` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R23 | `/checklists` | `page-checklist-templates` | admin, regional, auditor | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R24 | `/checklists/templates/new` | `page-template-builder` | admin, regional, auditor | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R25 | `/checklists/templates/{template}` | `page-template-builder` | admin, regional, auditor | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R26 | `/checklists/dashboard` | `page-checklist-dashboard` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R27 | `/checklists/schedules` | `page-checklist-schedules` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R28 | `/checklists/assignments` | `page-checklist-assignments` | all 5 | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R29 | `/checklists/fill/{assignment}` | `page-checklist-fill` | all 5 | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R30 | `/checklists/submissions` | `page-checklist-submissions` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R31 | `/checklists/submissions/{submission}` | `page-submission-detail` | all 5 | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R32 | `/checklists/compliance` | `page-compliance` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others · empty store E1 | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac, edge-empty-store | PASS |
| R33 | `/tasks` | `page-tasks` | all 5 | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R34 | `/tickets` | `page-tickets` | all 5 | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R35 | `/tickets/{ticket}` | `page-ticket-detail` | all 5 | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R36 | `/documents` | `page-documents` | all 5 | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R37 | `/vendors` | `page-vendors` | admin, regional, manager | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R38 | `/reports` | `page-reports` | admin, regional, manager, auditor | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R39 | `/admin/stores` | `page-admin-stores` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R40 | `/admin/stores/1` | `page-admin-store` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R41 | `/admin/stores/1/cameras` | `page-admin-cameras` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R42 | `/admin/stores/1/zones` | `page-admin-store` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R43 | `/admin/stores/1/recorders` | `page-admin-store` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R44 | `/admin/stores/1/edge` | `page-admin-store` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R45 | `/admin/stores/1/staff` | `page-admin-store` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R46 | `/admin/regions` | `page-admin-regions` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R47 | `/admin/edge-devices` | `page-admin-edge-devices` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R48 | `/admin/users` | `page-admin-users` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R49 | `/admin/staff` | `page-admin-staff` | admin, regional, manager | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R50 | `/admin/alert-rules` | `page-admin-alert-rules` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R51 | `/admin/settings` | `page-admin-settings` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R52 | `/admin/audit-log` | `page-admin-audit-log` | admin | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |
| R53 | `/this-page-does-not-exist` | `page-not-found` | all 5 | S1–S4 per allowed role, A1/A2, P1 for the others | renders cleanly, no overflow, no serious/critical axe issue; forbidden → home | edge-sweep (role), edge-a11y, edge-rbac | PASS |

Ids such as `{template}` / `{assignment}` are resolved from the seeded data per role (`e2e/support/routes.ts`).

## 2. Scenario tables

| ID | Screen / flow | Scenario | Expected | Test | Status |
|---|---|---|---|---|---|
| E1 | Every analytics / ops page with the global filter | A store created via the API (no cameras, zones, POS, checklists) is the only store selected | Each page shows an empty state; no NaN/null text; no blank or flat-zero chart; no console error | edge-empty-store › every data page shows an empty state… | PASS |
| E2 | Conversion, Traffic, Dashboard | Same empty store | Conversion %, ATV, items / bill, engaged / bounce / repeat %, avg dwell show `--` (zero denominator) | edge-empty-store › zero denominators render "--"… | PASS |
| E3 | Benchmark, Compliance | Same empty store | Ratios `--`; "Compare stores" / "Score by store" show the empty state instead of a flat 0 chart | edge-empty-store › every data page… | PASS |
| E4 | AI Manager › Store open / close | Store without open/close monitoring | One empty state "No opening or closing snaps received" + "Show the store-days", no wall of "No snap" cards | edge-empty-store › every data page… | PASS |
| E5 | Admin › Store › Cameras / Zones / Recorders / Edge / Staff | Empty store | Each tab shows its empty state, no bad text, no console error | edge-empty-store › store detail of the empty store… | PASS |
| N1 | Admin stores list + store detail + cameras + zones, users, checklists, template builder | 120-character names with Tamil text ("கான்க்ரூயன்ஸ் டி நகர்") at 1440 px | Text wraps or is clipped with an ellipsis **and** a tooltip (`title`) carries the full name; nothing leaves the viewport | edge-names-xss › 120-char Tamil names … at 1440px | PASS |
| N2 | Same | Same at 390 px | Same; no horizontal page overflow | edge-names-xss › … at 390px | PASS |
| N3 | Global filter / Traffic | Long store selected | No overflow, no console error | edge-names-xss › (both widths) | PASS |
| N4 | Zone editor | Long zone name drawn on the camera image | Label shortened with "…" (full name in the list / `<title>`) | edge-names-xss (SVG excluded, list checked) | PASS |
| X1 | Stores, store detail, users, checklists, template builder, tickets | Names / descriptions containing `<img src=x onerror=alert(1)>` | Shown as literal text; no `<img src="x">` in the DOM | edge-names-xss › XSS payloads… | PASS |
| X2 | Same + dashboard with the XSS store selected | Same | No `alert()` dialog fires | edge-names-xss › XSS payloads… | PASS |
| H1 | Checklist fill (staff, phone) | Token expires mid-checklist (API answers 401 on Save draft) | `/login?returnUrl=%2Fchecklists%2Ffill%2F<id>&expired=1`, "session expired" notice, no "leave without saving?" dialog blocking | edge-session › token expires mid-checklist… | PASS |
| H2 | Same | Sign in again | Back on the fill page; "Unsaved answers restored" banner; typed answers restored; saving the draft clears the device copy | edge-session › token expires mid-checklist… | PASS |
| H3 | Any page | Expired JWT in storage at start-up | `/login?returnUrl=<page incl. query>`; after sign-in the user lands on that page | edge-session › expired token at start-up… | PASS |
| H4 | Tickets | Token revoked (401 on a list call) | Login with returnUrl, back to /tickets after sign-in | edge-session › a 401 on any page… | PASS |
| U1 | Template builder | Edit name, navigate away | "Leave without saving?" — Cancel keeps page and edits, Leave navigates | edge-session › unsaved-changes guard… | PASS |
| U2 | AI rule editor (new + existing) | Edit name, navigate away; untouched rule | Prompt when edited; no prompt when untouched | edge-session › unsaved-changes guard… | PASS |
| U3 | Checklist fill | Answer, navigate away | Prompt; Cancel keeps the answer | edge-session › unsaved-changes guard… | PASS |
| D1 | Tasks › New task | Double-click Save while the POST is slow | Exactly one POST, one task | edge-forms › double-click on submit… | PASS |
| D2 | Tickets › New ticket (DS drawer) | Same | One POST, one ticket | edge-forms › double-click on submit… | PASS |
| D3 | Checklist fill › Submit | Double-tap Submit, double-tap Confirm | One confirmation dialog, one submission | edge-forms › double-click on submit… | PASS |
| F1 | Create drawers: store, region, edge device, user, staff, alert rule, camera, recorder, report schedule, task, ticket, infra ticket, vendor, assignment, checklist schedule | Save with empty required fields | Inline messages; nothing is posted | edge-forms › every create drawer blocks an empty submit… | PASS |
| F2 | Store | Code `x`, latitude 100, area 0, close 10:00 before open 21:00 | "Use 2–30 letters…", "Maximum 90", "Minimum 1", "Closing time must be after opening time"; no POST | edge-forms › range, pattern and cross-field rules… | PASS |
| F3 | User | Email `not-an-email`, password `123` | "Enter a valid email address", "At least 8 characters" | edge-forms › range, pattern… | PASS |
| F4 | Camera / Alert rule / Task / AI rule | RTSP `http://…`, threshold −5, due before start, empty rule name | "Must start with rtsp://", "Minimum 0", "Due time must be after the start time", rule error banner | edge-forms › range, pattern… | PASS |
| F5 | Any DS drawer | Escape while a select inside is open | Select closes, drawer and typed values stay; a second Escape closes the drawer | edge-forms › Escape closes an open select… ; ds.spec (ce-drawer) | PASS |
| L1 | Alerts | Page size 10 → last page → first page; filters with no result | Range label "N–N of N", Next disabled on the last page; "Clear filters" restores rows | edge-data › alerts and AI detections… | PASS |
| L2 | AI Manager › Detections (table view) | Last page and back | Same | edge-data › alerts and AI detections… | PASS |
| L3 | Submissions (client paging) | Next to the last page, back, sort by score twice, search with no result | Totals unchanged; filtered empty state with "Clear search" restores the list | edge-data › submissions and audit log… | PASS |
| L4 | POS | Import only (no POS list UI) | Covered by pos.spec (import, duplicates, errors) | pos.spec | PASS |
| M1 | Traffic, Tickets, Submissions, AI summary, Users | API answers 500 | Error state (`data-kind="error"`) with Retry; Retry recovers | edge-data › API failures… | PASS |
| M2 | Tasks, Alerts | Request aborted (network error) | Same | edge-data › API failures… | PASS |
| M3 | All above | While failing / recovering | No uncaught page error | edge-data › API failures… | PASS |
| O1 | Shell | Browser goes offline | Sticky "You're offline…" banner, also after in-app navigation | edge-data › offline… | PASS |
| O2 | Shell | Back online | Banner removed, "Back online" toast, data refreshed | edge-data › offline… | PASS |
| T1 | Global date filter | Custom range of 1 day | API from = to; KPIs equal the API; no NaN | edge-data › date filter: 1-day, 90-day… | PASS |
| T2 | Same | 90 days (seed has 30; compare on → empty previous period) | Same; no NaN / Infinity on Traffic and Dashboard | edge-data › date filter… | PASS |
| T3 | Same | Range crossing a month boundary | Daily series contains the 1st of the month | edge-data › date filter… ; › date filter typed… | PASS |
| T4 | Same | Dates typed as dd/mm/yyyy | Accepted (Indian format), Custom preset, analytics re-queried | edge-data › date filter typed in the range inputs… ; ds.spec (adapter) | PASS |
| T5 | Traffic daily chart | Range ending today | Today drawn as "(so far)" partial point; no false 0 | ds.spec (markPartialDay); analytics.spec | PASS |
| P2 | Menus | Every role | Menu lists exactly the role's pages (existing) and every link is allowed | rbac.spec (menus); edge-rbac | PASS |
| P3 | Direct URLs | Every role × every route (incl. detail routes) | Allowed → page; forbidden → home | edge-rbac | PASS |
| Q1 | Staff journey on a phone (390×844, touch) | Login → bottom tab Checklists → fill YES/NO, single, multi, number, rating, photo (camera capture) + AI uniform check PASS, video, text (Tamil) → Save draft → leave → resume (draft restored) → Submit (100 %) → task → Mark done with proof photo | Every step works by touch, no horizontal scrolling, server state matches | edge-mobile-staff | PASS |
| RC1 | Admin › Store › Recorders | Add a CP Plus recorder pointing at the repo's real RTSP test server | Channel-1 URL preview `rtsp://admin:****@127.0.0.1:<port>/cam/realmonitor?channel=1&subtype=0`; password never echoed by the API | edge-recorders | PASS |
| RC2 | Channels grid | Select all → Add as cameras → Test selected; the real edge prober (`ProbePoller`) runs against the RTSP server | Cameras "DVR ch 1/2" with masked URLs; both channels OK with 640×360; recorder ONLINE | edge-recorders | PASS |
| RC3 | Same | Recorder saved with a wrong password | Probe FAILED / AUTH; card shows "Wrong username or password for the DVR." | edge-recorders | PASS |
| A3 | Login page | Signed out, light and dark | No serious / critical axe violation | edge-a11y › login page… | PASS |
| V1 | Every route | Screenshots 1440 light, 1440 dark, 390 phone | Reviewed by QA for alignment, clipping, spacing, empty-looking cards, placeholder walls, awkward wrapping (fixes listed in docs/qa/FINDINGS.md) | edge-visual (opt-in) → docs/screenshots/qa/ | DONE |
| K1 | AI Manager › Detections (existing test) | Run at any hour of the day | Deterministic: today's 7 in-store types + yesterday's open/close | ai-manager.spec › detections… | PASS |

## 3. New Playwright tests

| Spec | Tests | Categories |
|---|---|---|
| edge-sweep | 5 (one per role, every route) | S1–S4 render, console / network, bad text, overflow 768 / 390 |
| edge-a11y | 6 | A1–A3 axe light + dark (admin, staff phone, login) |
| edge-rbac | 5 | P1–P3 direct URL per role, menu links |
| edge-empty-store | 3 | E1–E5 empty store, zero denominators |
| edge-names-xss | 3 | N1–N4 long Tamil names (1440 / 390), X1–X2 XSS |
| edge-session | 4 | H1–H4 session expiry, U1–U3 unsaved-changes guards |
| edge-forms | 4 | D1–D3 double submit, F1–F5 validation, drawer Escape |
| edge-data | 6 | L1–L3 paging / sorting / search, M1–M3 failures, O1–O2 offline, T1–T4 dates |
| edge-mobile-staff | 1 | Q1 phone staff journey |
| edge-recorders | 1 | RC1–RC3 recorders with the real RTSP server + edge prober |
| edge-visual | 6 (opt-in, skipped in the suite) | V1 screenshots |

38 new tests run in the suite (plus 6 opt-in screenshot tests); unit tests added for the DS (drawer Escape, phone
cards, ISO dates, tones, zero denominators, partial day, date typing).

## 4. Final run (scripts/run-all-tests.sh, master, 2026-10-06)

| Suite | Result | Tests |
|---|---|---|
| backend build | PASS | build |
| frontend build | PASS | build |
| backend unit | PASS | 62 passed |
| backend e2e | PASS | 151 passed |
| frontend unit | PASS | 200 passed |
| ai-service | PASS | 217 passed |
| playwright e2e | PASS | 129 passed, 0 failed, 1 flaky, 6 skipped (opt-in screenshots) |

The one flaky test (ai-manager.spec "rule editor…", passed on retry) read the detection-area options before the
selected store's zones had loaded; the spec now waits for the list to settle (re-run alone: PASS).
