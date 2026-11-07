# Congruence Eye — `data-testid` reference

Stable hooks for Playwright E2E tests. **Use `page.getByTestId(...)`** (Playwright's default attribute is `data-testid`). Never select by CSS class or text that may be translated or restyled.

## Conventions

| Pattern | Meaning | Example |
|---|---|---|
| `page-<name>` | Root `<section>` of every routed page (exactly one per page; the Reports page also embeds `page-report-schedules`) | `page-traffic` |
| `page-title` | The `<h1>` inside a page header | |
| `rail-<module>` | Icon-rail module button (`home`, `traffic`, `zone`, `revenue`, `trax`, `ai-manager`, `store-ops`, `reports`, `admin`; role-filtered). Clicking it opens that module in the panel (and, on desktop, navigates to its first page) | `rail-trax` |
| `nav-<id>` | Page link in the module panel (only the open module's pages are rendered) | `nav-traffic` |
| `nav-group-<id>` | Group inside the module panel (e.g. `trax-manage`) | |
| `nav-badge-<id>` | Count badge on a page link (open alerts, overdue checklists, open tickets) | `nav-badge-alerts` |
| `kpi-<id>` | KPI card root; contains `kpi-value` and (when compare is on and the API returned `changePct`) `kpi-change` | `kpi-footfall` |
| `chart-<id>` | ECharts container (canvas inside) | `chart-daily` |
| `table-<id>` | `<table>` element | `table-alerts` |
| `row-<entity>-<id>` | Table row / card for a record, `<id>` = database id | `row-alert-42` |
| `btn-<action>` | Buttons. Row-scoped buttons (`btn-edit`, `btn-delete`, `btn-ack` …) repeat per row — scope them: `page.getByTestId('row-alert-42').getByTestId('btn-ack')` | `btn-create-task` |
| `input-<field>` | Form inputs. In generic dialogs the suffix is the **API field name** (`input-storeId`, `input-dueDate`) | `input-email` |
| `filter-<name>` | Filter controls on list pages | `filter-alert-status` |
| `select-<name>` | Single-value pickers (store/camera/metric) | `select-heatmap-store` |
| `dialog-<entity>` | The `<form>` inside a dialog | `dialog-task` |
| `chip-<kind>` | Status chip; the chip also carries `data-value="<ENUM>"` for assertions | `chip-status` |
| `empty-state`, `loading`, `error-banner` | Shared empty / loading / error components | |

Material selects: click the `mat-select` with the testid (if Playwright reports that the `<mat-label>` "intercepts pointer events" on an empty select, use `click({ force: true })` — the label overlays the empty trigger), then pick the option with `page.getByRole('option', { name: '…' })`, or by testid where noted (`filter-store-option-<id>`, `filter-preset-<value>`, `<select-testid>-option-<storeId>`).

Dates in pages follow the global filter (`filter-range-preset`). Analytics endpoints are only called after the store list loads, so wait for `kpi-value` / a table row rather than for network idle (the SSE stream keeps a connection open).

---

## Global shell (every authenticated page)

| testid | Element |
|---|---|
| `sidenav` | Navigation wrapper: 64px icon rail (`rail-<module>`, `btn-help`, `rail-user`) + 224px module panel (`nav-group-*`, `nav-<id>`, `nav-badge-<id>`; Home also shows `shortcut-<id>` links) |
| `brand` | Logo link in the rail |
| `btn-collapse-nav` | "Expand menu" button in the top bar, shown while the module panel is collapsed (collapse is the panel's own button) |
| `btn-menu`, `btn-close-menu` | Hamburger / close of the slide-over menu (below 1024 px) |
| `topbar`, `breadcrumbs` | Top bar; breadcrumbs (Module › Group › Page › detail) |
| `btn-filters`, `filter-sheet`, `btn-filters-done` | Below 1024 px the global filter moves into a sheet opened from the top bar |
| `tabbar`, `tab-<home\|checklists\|tasks\|alerts\|tickets\|more>` | Bottom tab bar (below 768 px) |
| `global-filter` | Filter container (only on pages with analytics data: dashboard, analytics/*, traffic/*, ai-manager/* except rules, reports, checklists/dashboard, checklists/submissions, checklists/compliance) |
| `filter-stores`, `filter-store-option-<storeId>`, `filter-stores-clear` | Multi-store select (empty = all stores in the user's scope). Its panel also has `filter-store-search` (filters the list), `filter-store-all` and cluster chips `filter-cluster-region-<slug>` / `filter-cluster-format-<slug>` (select every store of a region / format). Only stores are `mat-option`s |
| `filter-range-preset`, `filter-preset-<today\|yesterday\|last7\|last30\|thisMonth\|custom>` | Period preset |
| `filter-date-range`, `filter-date-from`, `filter-date-to`, `filter-date-toggle` | Custom date range (typing/picking switches the preset to Custom) |
| `filter-compare` | "Compare with previous period" slide toggle |
| `filter-refresh`, `last-refreshed` | Reload current data; "Last refreshed" time (pages may also show `page-last-refreshed`) |
| `btn-theme-toggle` | Light/dark |
| `notif-bell`, `notif-count` | Bell; unread badge (absent when 0) |
| `notif-list`, `notif-item-<id>`, `notif-empty`, `notif-read-all` | Notification menu. Each item has `data-kind` = `alert` \| `ai-breach` \| `reminder` \| `overdue` \| `other`; clicking follows its deep link (`/alerts/:id`, `/ai-manager/detections?id=`, `/checklists/assignments/:id` → fill page) |
| `user-menu`, `user-email`, `user-role` | User menu trigger and its header |
| `btn-change-password`, `btn-logout` | User menu items |
| `dialog-change-password`, `input-current-password`, `input-new-password`, `input-confirm-password`, `error-mismatch`, `btn-save`, `btn-cancel` | Change password dialog |
| `dialog-confirm`, `btn-confirm`, `btn-cancel` | Any confirmation dialog |

### Nav ids (grouped by rail module: Home · Traffic · Zone · Revenue · Trax · AI Manager · Store Ops · Reports · Admin — see `NAV_MODULES` in `core/auth/permissions.ts`)
`nav-dashboard`, `nav-live`, `nav-infra-health`, `nav-traffic`, `nav-demographics`, `nav-zones`, `nav-heatmap`, `nav-journey`, `nav-conversion`, `nav-queue`, `nav-store-ops`, `nav-benchmark`, `nav-image-directory`, `nav-recap`, `nav-alerts`, `nav-checklist-dashboard`, `nav-checklist-templates`, `nav-checklist-assignments` (label "My checklists" for STAFF), `nav-checklist-schedules`, `nav-checklist-submissions`, `nav-compliance`, `nav-tasks` (label "My tasks" for STAFF), `nav-tickets`, `nav-documents`, `nav-vendors`, `nav-reports`, `nav-ai-detections`, `nav-ai-summary`, `nav-ai-open-close`, `nav-ai-rules`, `nav-admin-stores`, `nav-admin-regions`, `nav-admin-edge-devices`, `nav-admin-users`, `nav-admin-staff`, `nav-admin-alert-rules`, `nav-admin-settings`, `nav-admin-audit-log`.

---

## Pages

### `/login` — `page-login`
`form-login`, `input-email`, `input-password`, `btn-login`, `login-error` (shown on bad credentials: text "Invalid email or password"). Demo build only: `demo-logins` → `btn-demo-login-<admin|regional|manager|auditor|staff>`.

### `/dashboard` — `page-dashboard`
- Hero band tiles (footfall, transactions, conversion, revenue, atv, open-alerts) and a stat strip (the rest), all inside `kpi-grid`: `kpi-footfall`, `kpi-unique-visitors`, `kpi-billable-entities`, `kpi-transactions`, `kpi-conversion`, `kpi-revenue`, `kpi-atv`, `kpi-avg-dwell`, `kpi-engaged`, `kpi-bounce-rate`, `kpi-missed-opportunities`, `kpi-queue-wait`, `kpi-compliance`, `kpi-open-alerts` (each with `kpi-value`, optional `kpi-change`)
- `chart-daily`
- `dashboard-open-alerts`, `dashboard-alert-<id>`, `link-all-alerts`
- `dashboard-top-stores`, `dashboard-bottom-stores` (each store is an `<li>`)
- `dashboard-today-ops` → `dashboard-checklists-due`, `dashboard-open-close` → `dashboard-oc-<storeId>`; header links `link-reports`, `link-benchmark`
- `chart-daily` sits in a chart card: granularity `gran-daily` / `gran-weekly`, Download menu `btn-download-daily` → `btn-download-png-daily`, `btn-download-csv-daily`.

### `/live` — `page-live`
Phase B: `live-offline-banner` (some cameras offline), occupancy gauge inside `kpi-live-occupancy`; today's conversion shows `--` when there is no footfall yet.
`select-live-store` (+ `select-live-store-option-<id>`), `toggle-live-auto`, `btn-live-refresh`; KPIs `kpi-live-occupancy`, `kpi-live-today-footfall`, `kpi-live-last-hour`, `kpi-live-transactions`, `kpi-live-conversion`; `live-queues` → `queue-card-<zoneId>`; `live-cameras` → `camera-tile-<cameraId>` (each has `camera-snapshot` or `snapshot-missing`); `live-events`.

### `/analytics/traffic` — `page-traffic`
KPIs `kpi-footfall-in`, `kpi-unique-visitors`, `kpi-billable-entities`, `kpi-staff-excluded`, `kpi-avg-dwell`, `kpi-engaged`, `kpi-bounced`, `kpi-repeat-visitors`, `kpi-peak-hour`. Charts `chart-traffic-daily`, `chart-individuals-groups`, `chart-engagement`, `chart-repeat-new`, `chart-traffic-hourly`, `chart-traffic-dow`.
v2: `traffic-conversion-flow` → `chart-conversion-flow` (Footfall → Engagers → Billable entities → Conversion); `card-gender-dwell` (`gd-male`, `gd-female`, `gd-dwell`, `chart-gender-dwell`); `traffic-density` → `table-traffic-density` → `density-row-<hour>` → `density-cell-<hour>-<dow>` (dow 0 = Sun; columns Mon→Sun); `chart-hourly-bounced` (drop-off %, open hours only).
Phase B: every chart card has a Download menu `btn-download-<key>` → `btn-download-png-<key>` / `btn-download-csv-<key>` (key = chart testid without `chart-`, e.g. `traffic-daily`, `conversion-flow`) and, where it applies, granularity `gran-daily` / `gran-weekly`. `btn-download-csv-traffic-density` exports the density table. `chart-conversion-flow` is a left → right funnel (tooltip `<Stage>: N (x% of footfall)`).

### `/analytics/demographics` — `page-demographics`
`kpi-male`, `kpi-female`, `kpi-unknown`; `chart-gender`, `chart-age`, `chart-gender-by-age`.
Phase B: `kpi-dominant-age`, `card-age` → `age-list` → `age-<band>`, Gender & dwell card (`gd-male`, `gd-female`, `gd-dwell`).

### `/analytics/zones` — `page-zones`
`kpi-zones-hot`, `kpi-zones-warm`, `kpi-zones-dead`, `kpi-zones-visits`; `chart-zone-dwell`; `filter-zone-class` (toggle: All/Hot/Warm/Dead); `table-zones` → `row-zone-<zoneId>` with `chip-zone-class` (`data-value` HOT|WARM|DEAD). Columns now include Bounced, Concentration, Dominant age, Gender split.
v2 "Zone concentration summary" (reference 03): `zone-concentration-summary`, `select-concentration-store` (defaults to the store with the hottest zone), `concentration-overall` (overall store card; selects the store), `concentration-list` (tbody) → `concentration-zone-<zoneId>` (click selects the zone; dot carries `data-value` HOT/WARM/DEAD), `concentration-heatmap` (snapshot + smooth heatmap; selected zone outlined), `date-strip-all` / `date-strip-<YYYY-MM-DD>` (heatmap day), `btn-download-heatmap` (PNG), `link-add-zone` (admins), `heatmap-legend-concentration`, `concentration-metrics` → `metric-footfall|bounced|engagers|concentration|male|female|age|dwell`.

### `/analytics/heatmap` — `page-heatmap`
`select-heatmap-store` (+ `-option-<id>`), `select-heatmap-camera` (+ `select-heatmap-camera-option-<cameraId>`), `input-heatmap-opacity`, `heatmap-stage`, `heatmap-canvas` (1280×720 canvas over `camera-snapshot` / `snapshot-missing`), `heatmap-legend`.
Phase B: `btn-download-heatmap-png`, view summary `hm-peak`, `hm-hot-area`, `hm-coverage`, `hm-total`, camera list `heatmap-camera-<cameraId>`.

### `/analytics/journey` — `page-journey`
`select-journey-stores` (multi-select; `select-journey-stores-option-<storeId>`), `journey-highlights` → `journey-highlight-highestFootfall` | `-highestImpression` | `-highestBounced` | `-highestEngaged` | `-highestDwell`, `chart-journey-sankey`, `journey-top-links`.

### `/analytics/conversion` — `page-conversion`
KPIs `kpi-conversion`, `kpi-revenue`, `kpi-transactions`, `kpi-atv`, `kpi-items-per-bill`, `kpi-missed-opportunities`; `chart-funnel` (v2 order Footfall → Engagers → Billable entities → Conversion); `chart-customers-per-staff`; `conversion-segments` → `segment-bounced`, `segment-missed`, `segment-converted`; `chart-segments`, `chart-conversion-daily`, `chart-missed-staff`; `table-conversion-stores` → `row-conversion-<storeId>`.

### `/analytics/queue` — `page-queue`
KPIs `kpi-avg-queue-length`, `kpi-max-queue-length`, `kpi-avg-wait`, `kpi-max-wait`, `kpi-breaches`, `kpi-unattended`; `live-queues` → `queue-card-<zoneId>`; `chart-queue-hourly`; `table-queue-counters` → `row-counter-<zoneId>`.

### `/analytics/store-ops` — `page-store-ops`
Phase B: open/close rows with an issue carry class `row-late`; camera health rows sort by lowest uptime first.
KPIs `kpi-late-openings`, `kpi-early-closings`, `kpi-sop-breaches`, `kpi-camera-uptime`, `kpi-downtime`, `kpi-offline-cameras`; `filter-open-close` (All / Late-early only); `table-open-close` → `row-open-close-<storeId>-<date>` (late cells have `data-late="true"`, early closes `data-early="true"`); `table-camera-health` → `row-camera-health-<cameraId>`; `chart-staff-presence`; `storeops-events` → `storeops-event-<id>`.

### `/analytics/benchmark` — `page-benchmark`
`btn-export-csv` (client-side CSV of the current table order), `btn-export-xlsx` (server export), `toggle-benchmark-group` (`group-store` \| `group-region` \| `group-format` \| `group-city`), `select-benchmark-metric`, `chart-benchmark`, `table-benchmark` → `row-benchmark-<storeId>` (has a Format column). Grouped views: `chart-benchmark-groups`, `table-benchmark-groups` → `row-benchmark-group-<group>`.
Phase B: podium `benchmark-top-1|2|3`; league table columns sort by header click.

### `/alerts` — `page-alerts`
`btn-evaluate-alerts` (admins), `filter-alert-status` (default **Open**; on `/alerts/:id` the filter is cleared and that row gets `data-highlight="true"`), `filter-alert-severity`, `filter-alert-store`, `btn-refresh`, `table-alerts` → `row-alert-<id>` containing `chip-severity`, `chip-status`, `btn-ack`, `btn-resolve`, `btn-create-ticket` or `link-ticket`; `paginator-alerts`.
Phase B (ops): stat strip `kpi-alerts-open|critical|acknowledged|resolved`; filters are dropdown chips (same testids); `btn-clear-filters`, `alert-total`, `link-alert-rules` (admins); severity stripe + row checkbox → `alerts-bulkbar` with `btn-bulk-ack`, `btn-bulk-resolve`. Row click opens `drawer-alert` (`alert-evidence`, `btn-drawer-ack`, `btn-drawer-resolve`, `btn-drawer-ticket`). The Store column is the row's 3rd cell.

### `/checklists` (templates) — `page-checklist-templates`
`link-assignments`, `btn-create-template`, stat strip `kpi-tpl-total|published|draft|questions|ai`, status tabs `templates-tabs` (`tab-templates-all|published|draft`, `?status=`), `input-search` (ce-table search), `filter-template-category`, `btn-clear-filters`, `table-templates` → `row-template-<id>` with `link-template`, `btn-assign`, `btn-edit`, `btn-delete` (`btn-view` for read-only roles).

### `/checklists/templates/new` and `/checklists/templates/:id` — `page-template-builder`
Editor pattern. Sticky header: `btn-back`, `page-title`, `template-state` (Published/Draft pill, existing templates), `btn-toggle-preview` (phone preview `builder-preview`), `btn-save-template` (Publish). Sticky footer: `builder-summary` ("N questions · max score M"), `btn-cancel`, `btn-save-draft` (saves inactive), `btn-save` (Publish = active). `template-errors` (validation list; fields also show inline errors). Leaving with unsaved changes asks first (route guard + `beforeunload`).
Template fields: `input-template-name`, `input-template-category`, `input-template-description`, `input-template-frequency` (`input-template-active` was replaced by Save as draft / Publish).
Outline (left, ≥ 1024 px): `outline-sections` → `outline-section-<name>` (drag to reorder whole sections), `btn-outline-add-section`.
`btn-add-section`, `btn-add-question` (menu) → `btn-add-question-<YES_NO|MCQ_SINGLE|MCQ_MULTI|TEXT|NUMBER|RATING|PHOTO|VIDEO>`.
`question-list` → `section-<name>` labels and `question-<index>` cards (0-based position) each with: `drag-handle`, `btn-move-up`, `btn-move-down`, `btn-duplicate-question`, `btn-delete-question`, `input-question-text`, `input-question-section`, `input-question-weight`, `input-question-type` (type picker, `role=radiogroup`) → `qtype-<TYPE>`. MCQ only: `input-question-correct` = the options editor (rows `option-input-<i>`, `option-remove-<i>`, mark buttons with aria-label `Correct answer: <option>`), `btn-add-option`, `input-question-options` (quick entry, comma separated). NUMBER: `input-question-min`, `input-question-max`. `input-question-required`, `input-question-photo`, `input-question-task-on-fail`. Photo questions also: `input-question-ai-check` (None / Reference match / Uniform / grooming), and for Reference match `question-reference` with hidden `input-question-reference`, `btn-upload-reference`, `question-reference-thumb`. `questions-empty` when none.

### `/checklists/dashboard` — `page-checklist-dashboard`
Stat strip `trax-tiles`: `kpi-trax-active`, `kpi-trax-instances`, `kpi-trax-not-submitted`, `kpi-trax-open`, `kpi-trax-in-progress`, `kpi-trax-submitted`, `kpi-trax-completion`, `kpi-trax-compliance`, `kpi-trax-flags`. `trax-tabs` (`role="tab"` buttons `tab-trax-checklist|store|user`, synced to `?tab=`) → `table-trax-checklist` \| `table-trax-store` \| `table-trax-user` → `row-trax-<tab>-<id>` (Submitted / Flags are link numbers → submissions filtered; `btn-view` per row). `input-search-trax`, `btn-export-dashboard` (CSV of the active tab), Export menu `btn-export-menu` → `btn-export-performance-csv`, `btn-export-checklists-xlsx`, `btn-create-checklist`.

### `/checklists/schedules` — `page-checklist-schedules`
Stat strip `kpi-sched-active|paused|stores|today`, tabs `tab-schedules-all|active|paused`, `input-search-schedules`, table `table-schedules` → `row-checklist-schedule-<id>` with `btn-generate-schedule`, `btn-edit`, `btn-delete`.
`btn-create-checklist-schedule` / `btn-edit` open the editor **side panel** `dialog-checklist-schedule` (a ce-drawer, reference 06): `input-schedule-template`, `input-schedule-stores`, `input-schedule-frequency` ("For", segmented: `frequency-ONCE|DAILY|WEEKLY|MONTHLY`), `input-schedule-window-start` ("At") / `input-schedule-window-end` ("Ends"), `input-schedule-days` → `day-<0..6>` (WEEKLY), `input-schedule-day-of-month` (MONTHLY), `input-schedule-start` ("Starts from"), `input-schedule-repeat` ("Repeat every"), `toggle-schedule-date-range` ("Set defined date range"; click its `button[role=switch]`) → `input-schedule-end` ("Ends on", only while on), `schedule-preview` ("Occurs every … starting …"), accordions `acc-response` (`input-schedule-assignee` — empty = each store's manager, `input-schedule-reminder`) and `acc-advanced` (`input-schedule-active`), `schedule-errors`, `btn-cancel`, `btn-save` (inside the panel footer — scope to `dialog-checklist-schedule`).

### `/checklists/assignments` — `page-checklist-assignments`
`btn-create-assignment` → `dialog-assignment` with `input-templateId`, `input-storeId`, `input-assigneeId`, `input-dueDate`, `btn-save`. Stat strip `kpi-asg-due|overdue|redo|submitted|approved`. `toggle-mine` (segmented `toggle-mine-true` / `toggle-mine-false`, managers only), `filter-assignment-status`, `btn-clear-filters`, `input-search-assignments`, `table-assignments` → `row-assignment-<id>` with `chip-status` (`data-value`), `btn-fill` (assignee only; label "Redo" for REDO, "Resume" for IN_PROGRESS drafts), `btn-view-submission`. Rows are stacked cards below 768 px.
`/checklists/assignments?assign=<templateId>` opens the assign dialog pre-filled.

### `/checklists/fill/:assignmentId` — `page-checklist-fill` (also reached via `/checklists/assignments/:id`)
Mobile-first, **one question per screen**. Header: `btn-back`, `page-title`, `fill-due` (store time; overdue / due-soon wording), `fill-readonly` (already submitted). Banners `draft-banner` (a saved draft was resumed), `redo-banner` (REDO only; the page opens at the first redo question). Sticky progress `fill-progress`: `fill-answered`, `score-preview` (live client-side score; hidden below 768 px), section stepper chips `fill-section-<section>`.
Question outline (left panel ≥ 1024 px; below that in the `drawer-fill-outline` sheet opened by `btn-fill-outline`): per section `btn-save-section-<section>`, per question `fill-nav-<questionId>`, `fill-nav-review`.
Current card `question-<questionId>` (class `invalid` + child `question-error` with the message text; class `redo`). Answer inputs `input-answer-<questionId>`: YES_NO big buttons `answer-yes` / `answer-no` (class `checked`); MCQ_SINGLE native radio rows; MCQ_MULTI native checkbox rows; NUMBER `<input>` with − / + steppers; RATING star buttons `rating-1` … `rating-5`; TEXT `<textarea>`.
Photos: hidden `input-photo-<questionId>` (`accept="image/*"`, `capture="environment"`), `btn-upload-photo-<questionId>` (Take / Retake photo), `photo-preview-<questionId>`. VIDEO: hidden `input-video-<questionId>` (`accept="video/*"`), `btn-upload-video-<questionId>`, `video-preview-<questionId>`. `upload-error` (type / > 50 MB / failed upload). AI questions: `btn-ai-check-<questionId>` → `ai-result-<questionId>` (`data-status` = PASS \| FAIL \| ERROR \| SKIPPED; children `ai-status`, `ai-message`, `ai-issues`, `ai-annotated`, `ai-not-penalised` for ERROR). Remarks: `btn-remark-<questionId>` → `input-remark-<questionId>`.
Sticky actions: `btn-fill-prev`, `btn-save-draft`, `btn-fill-next` / `btn-fill-review` (last question) / `btn-fill-submit` (review screen).
Review screen `fill-review`: `fill-missing` + `review-missing-<questionId>` (tap to jump back), `btn-submit-checklist` (disabled while required answers are missing) → confirmation dialog (`btn-confirm`). After submit: `checklist-score-result` with `result-score-pct`, `result-score`, `result-flags` (when flagged), `btn-back-to-checklists`, `btn-view-submission`. Leaving with unsaved answers asks first.

### `/checklists/submissions` — `page-checklist-submissions`
Stat strip `kpi-sub-total|review|redo|avg|flags`, tabs `tab-submissions-all|review|redo|approved`, `filter-submission-template`, `filter-submission-status`, `btn-clear-deeplink`, `btn-clear-filters`, `input-search-submissions`, `btn-export-submissions` (CSV), `table-submissions` → `row-submission-<id>` (click opens detail) with `chip-status`, `btn-view`.

### `/checklists/submissions/:id` — `page-submission-detail`
`btn-back`, `kpi-submission-score`, `kpi-submission-flags`, `kpi-submission-status` (`chip-status`), `filter-answers-all` / `filter-answers-flagged`, `answer-<questionId>` (`data-flagged`) with `answer-value`, `answer-flagged`, `answer-video`, `answer-ai-result` (`data-status`, child `ai-status`; submitted photo, AI annotated image and the reference shown side by side), and `btn-answer-task` on flagged answers (managers) → `dialog-answer-task` (`input-title`, `input-assigneeId`, `input-dueAt`, `input-priority`, `btn-save`). Review (reviewers): `review-panel`, `btn-start-review`, `input-review-status` (`review-approve` / `review-redo`, class `checked`), `input-review-comment` (required for a redo), per-question `redo-flag-<questionId>` (ticking one switches the decision to REDO), `btn-submit-review`, `btn-cancel`.

### `/checklists/compliance` — `page-compliance`
`kpi-compliance-avg`, `kpi-compliance-submissions`, `kpi-compliance-overdue`, `kpi-compliance-below`, `chart-compliance` (+ `btn-download-compliance…`), `input-search-compliance`, `table-compliance` → `row-compliance-<storeId>`.

### `/tasks` — `page-tasks`
`toggle-task-view` (segmented `view-board` / `view-list`, remembered per browser), `btn-create-task` → **side panel** `dialog-task` (`input-title`, `input-description`, `input-storeId`, `input-type`, `input-zoneId` (ZONE_ALLOCATION only, required), `input-priority`, `input-assigneeId`, `input-startAt`, `input-dueAt` (store time), `btn-cancel`, `btn-save`), `btn-bulk-tasks` → side panel `dialog-bulk-task` (`input-storeIds`, `input-title`, `input-description`, `input-type`, `input-priority`, `input-assigneeId` (empty = each store's manager), `input-startAt`, `input-dueAt`, `btn-save`), stat strip `kpi-tasks-todo|progress|overdue|done|verified`, `input-search`, `filter-task-store`, `filter-task-priority`, `toggle-mine` (`toggle-mine-false` / `toggle-mine-true`), `btn-clear-filters`.
Board: `task-board` → `task-column-<TODO|IN_PROGRESS|DONE|VERIFIED|CANCELLED>` (drop target `.kanban-list`) → `task-card-<id>` (cdk drag source) with `btn-task-menu` → `btn-view-task`, `btn-move-<STATUS>`, `btn-verify-task`, `btn-edit`, `btn-delete`, `chip-priority`, and when present `task-starts`, `task-from-checklist`, `task-proof`.
Moving a task to DONE (any way) opens `dialog-complete-task`: hidden `input-proof-file` (image/video, ≤ 50 MB), `btn-upload-proof`, `proof-preview`, `input-remark`, `btn-complete-task`, `btn-cancel` (cancel reverts).
List: `table-tasks` → `row-task-<id>` with `chip-priority`, `select-task-status`, `btn-verify-task`, `btn-view-task`, `btn-edit`, `btn-delete` (column chooser `btn-columns`; "Created by" is off by default).
Task detail side panel `drawer-task`: `task-detail-status`, `task-detail-description`, `task-timeline`, `btn-detail-start`, `btn-detail-done`, `btn-detail-verify`.

### `/tickets` — `page-tickets`
`btn-create-ticket` → `dialog-ticket` (`input-title`, `input-description`, `input-storeId`, `input-category`, `input-priority`, `input-assigneeId` for managers, `btn-save`), stat strip `kpi-tickets-open|breached|risk|urgent|resolved`, `input-search`, `filter-ticket-status`, `filter-ticket-category`, `filter-ticket-priority`, `btn-clear-filters`, `table-tickets` → `row-ticket-<id>` (click opens detail) with `chip-priority`, `chip-status`, `sla-breached` (only when breached; otherwise an SLA countdown bar).

### `/tickets/:id` — `page-ticket-detail`
Two columns: conversation thread (`ticket-description`, `ticket-comments` → `comment-<id>`, `input-comment` (Ctrl+Enter posts), `btn-add-comment`) and the right panel (`ticket-status` pill, `sla-breached`, `ticket-status-actions` → `btn-status-<IN_PROGRESS|RESOLVED|CLOSED|REOPENED|OPEN>` (allowed next states only), properties). Header `btn-back`, `btn-edit-ticket` (managers) → `dialog-ticket`.

### `/traffic/image-directory` — `page-image-directory`
`filter-image-camera` (enabled when exactly one store is selected in the global filter), `filter-image-kind`, `image-total`, `image-gallery` → `image-item-<snapshotId>` (opens `dialog-lightbox`: `lightbox-image`, `btn-lightbox-prev`, `btn-lightbox-next` (also ←/→ keys), `btn-lightbox-download`, `btn-lightbox-close`), `paginator-images`.
Phase B: lightbox has a metadata panel (camera, store, time, kind); skeleton grid while loading.

### `/traffic/recap` — `page-recap`
`recap-generate` (STORE_MANAGER+): `select-recap-store`, `input-recap-date`, `btn-generate-recap`, `recap-error` (e.g. 422 "no snapshots"). `recap-player` → `recap-video` (HTML5 `<video>`), `recap-list` → `recap-<id>` (click to play) with `chip-recap-status`.
Phase B: summary strip `kpi-recap-total`, `kpi-recap-ready`, `kpi-recap-avg`, `recap-store-health` (when the role can read infra health), `btn-recap-download`.

### `/infra-health` — `page-infra-health`
`btn-refresh`, `btn-create-infra-ticket` → `dialog-ticket`. Tiles `kpi-infra-stores`, `kpi-infra-healthy`, `kpi-infra-degraded`, `kpi-infra-down`, `kpi-infra-cameras`, `kpi-infra-open-tickets`. `filter-health` (All / Down / Degraded / Good). `table-infra-health` → `row-infra-<storeId>` (`data-health` GOOD \| DEGRADED \| DOWN) with `chip-health`, `chip-edge`, `infra-issues`, `btn-create-ticket` (pre-filled infra ticket), `link-cameras` (admins). `table-infra-tickets` → `row-infra-ticket-<id>` with `link-ticket`; `link-all-tickets`.
Phase B (ops): `table-infra-health` is a NOC board of cards; each `row-infra-<storeId>` card also has `infra-cameras` (x / y with a mini uptime bar) and `link-store-tickets`; `input-search-infra`; `filter-health` is a ce-segmented (radios "All N" / "Down N" / …).

### AI Manager
- `/ai-manager/rules` — `page-ai-rules`: stat strip `kpi-ai-rules-total|published|draft|types`, `input-search-ai-rules`, `btn-create-ai-rule` (ADMIN, REGIONAL_MANAGER) → **full-page editor** `/ai-manager/rules/new` (`/ai-manager/rules/<id>` to edit/view) — `page-ai-rule-editor`: header `btn-back`, `rule-state` (Published/Draft), `btn-cancel`, `btn-save-draft` (saves inactive), `btn-save` (Publish = active); sections: `input-ai-rule-name`, `input-ai-rule-type`, `input-ai-rule-stores`, `input-ai-rule-zones` (detection areas; only zone types relevant to the detection type in the selected stores, e.g. SHELF for stock-out), `input-ai-rule-window-start`, `input-ai-rule-window-end`, `input-ai-rule-days` → `ai-day-<0..6>`, `ai-rule-params` → `input-param-<key>` (defaults pre-filled per type), `input-ai-rule-severity`, `input-ai-rule-channels`, `input-ai-rule-emails` (EMAIL; typed address is committed as a `recipient-<email>` chip on Enter/comma/blur/save), `ai-rule-errors`. STORE_OPEN_CLOSE uses sentence inputs: `toggle-buffer` + `input-param-toleranceMin`, `toggle-early-late` + `input-param-monitorBeforeOpenMin` / `input-param-monitorAfterCloseMin`. Assign stores: `input-ai-rule-auto-assign` (= all stores), `store-chip-<storeId>`, `table-rule-stores` → `row-rule-store-<id>`, `input-search-rule-stores`, `link-edit-store-time`. Table `table-ai-rules` → `row-ai-rule-<id>` with `toggle-ai-rule-active`, `btn-edit` (view for read-only roles), `btn-delete`.
- `/ai-manager/detections` — `page-ai-detections`: `toggle-detection-view` (`view-gallery` / `view-table`), `filter-detection-type`, `filter-detection-status`, `filter-detection-rule`; gallery `detection-gallery` → `detection-item-<id>`, table `table-detections` → `row-detection-<id>`; both with `chip-detection-status`, `chip-review`, `btn-review-valid`, `btn-review-false` (STORE_MANAGER+); evidence `dialog-detection` → `detection-evidence`; `paginator-detections`. `?id=<detectionId>` outlines that detection.
- `/ai-manager/summary` — `page-ai-summary`: `kpi-ai-total`, `kpi-ai-breached`, `kpi-ai-complied`, `kpi-ai-compliance`, `chart-ai-daily`, `table-ai-by-type` → `row-ai-type-<TYPE>`, `table-ai-by-store` → `row-ai-store-<storeId>`, `link-detections`.
- `/ai-manager/open-close` — `page-ai-open-close`: `kpi-oc-days`, `kpi-oc-breached`, `kpi-oc-late-open`, `kpi-oc-early-close`, `filter-oc-status`, `open-close-cards` → `oc-card-<storeId>-<date>` (`data-status` BREACHED \| COMPLIED) with `chip-detection-status`, `opening-snap` / `opening-snap-missing`, `closing-snap` / `closing-snap-missing`, `chip-open-status`, `chip-close-status` (On time / Late / Early / Missing); clicking a snap opens `dialog-snap`.
- Phase B (AI Manager): rules table adds `ai-rule-breaches` (7-day breaches, link-number → detections `?ruleId=&status=BREACHED`). Detections: stat strip `kpi-det-total|breached|complied|compliance`, `detection-total`, `btn-clear-filters`, `toggle-detection-view` is a ce-segmented (`view-gallery` / `view-table`); filters are dropdown chips (same testids); lightbox `dialog-detection` adds `btn-lightbox-prev|next`, `btn-lightbox-valid|false`, `btn-detection-download`; table row `btn-open-evidence`. The page reads `?type=`, `?status=`, `?ruleId=`. Summary: type tiles `row-ai-type-<TYPE>` sit inside `table-ai-by-type`; `input-search-ai-stores`. Open/close: `kpi-oc-on-time`, `btn-show-more` (12 cards per page); `filter-oc-status` is a ce-segmented; `dialog-snap` has `btn-close`.

### `/documents` — `page-documents`
`btn-upload-document` → **side panel** `dialog-document` (drop zone / `btn-choose-file`, hidden `input-file`, `document-file-error` (type / > 25 MB), `input-title` (pre-filled from the file name), `input-category`, `input-storeId`, `btn-cancel`, `btn-save`), `toggle-doc-view` (`view-grid` / `view-list`, remembered), category chips `filter-document-category` → `doc-cat-all`, `doc-cat-<SOP|CIRCULAR|PLANOGRAM|TRAINING|OTHER>`, `input-search`, `filter-document-store`, `btn-clear-filters`. Grid `document-grid` → cards `row-document-<id>`; list `table-documents` → `row-document-<id>`; both with `btn-download`, `btn-delete`.

### `/vendors` — `page-vendors` (tab 1) and `page-vendor-visits` (tab 2)
`vendor-tabs` (ce-tabs, `role="tab"` "Vendors" / "Visits" = `tab-vendors` / `tab-visits`, synced to `?tab=`).
Vendors (`page-vendors`): `btn-create-vendor` → `dialog-vendor` (`input-name`, `input-category`, `input-contactName`, `input-phone`, `input-email`, `input-isActive`), stat strip `kpi-vendors-active|inactive|visits|rating`, `input-search`, `btn-refresh`, `table-vendors` → `row-vendor-<id>` (status pill `data-value` YES/NO) with `btn-edit`, `btn-delete` (deactivates a vendor with visits).
Visits (`page-vendor-visits`): stat strip `kpi-visits-today|onsite|upcoming|missed`, `filter-visit-status`, `filter-visit-vendor`, `toggle-visit-view` (`view-visits-list` / `view-visits-calendar`), `btn-create-visit` → `dialog-visit` (`input-vendorId`, `input-storeId`, `input-purpose`, `input-scheduledAt`), `input-search-visits`, `table-vendor-visits` → `row-visit-<id>` with `chip-status`, rating stars (text ★★★★☆), `btn-check-in`, `btn-check-out` → `dialog-check-out` (`input-rating`, `input-notes`, `btn-save`), `btn-edit`, `btn-cancel-visit`. Week calendar `visit-calendar` → `visit-day-<YYYY-MM-DD>` → `visit-event-<id>`, `btn-week-prev`, `btn-week-next`.

### `/reports` — `page-reports`
`select-report-format` (`format-csv` / `format-xlsx`), `report-exports` → `report-card-<type>` with `btn-export-<traffic|zones|conversion|queue|storeops|benchmark|checklists|alerts|tasks|tickets>` (downloads for the current global filter).
POS import (STORE_MANAGER+): `pos-import`, hidden `input-pos-file`, `btn-import-pos`, `pos-import-result`.
Phase B: catalogue grouped by module; each card also has `btn-export-<type>-alt` (the other format) and `btn-schedule-<type>` (opens `dialog-schedule` pre-filled). Schedules are a ce-table inside `page-report-schedules` with `input-search`, `btn-refresh`; `dialog-schedule` is a right drawer (same inputs).
Schedules (embedded generic CRUD): `page-report-schedules`, `btn-create-schedule` → `dialog-schedule` (`input-name`, `input-type`, `input-format`, `input-frequency`, `input-storeIds`, `input-recipients`, `input-isActive`), `table-report-schedules` → `row-schedule-<id>` with `btn-run-schedule`, `btn-edit`, `btn-delete`.

### Admin — generic CRUD pages
All share: `page-<id>`, `btn-create-<entity>`, `input-search`, `btn-refresh`, `table-<id>`, `row-<entity>-<recordId>`, per-row `btn-edit` / `btn-delete`, dialog `dialog-<entity>` with `input-<apiField>` + `btn-save` / `btn-cancel`.
Phase B: the CRUD pages are ce-page + ce-table; `dialog-<entity>` is now a right-side drawer (`ce-entity-drawer`) with the same `input-<field>`, `btn-save`, `btn-cancel`, plus `form-error` (server error banner) and `error-<field>`. Stat strips: `kpi-stores-*`, `kpi-users-*`, `kpi-alert-rules-*`. Users: tabs `tab-all|managers|staff|inactive`. Alert rules: `toggle-alert-rule-active` per row. Store rows link to the store page.

| Route | page id | entity | Dialog inputs |
|---|---|---|---|
| `/admin/stores` | `page-admin-stores` | `store` | `code`, `name`, `regionId`, `city`, `format`, `address`, `timezone`, `openTime`, `closeTime`, `areaSqft`, `latitude`, `longitude`, `isActive`. Extra row button `btn-cameras` |
| `/admin/regions` | `page-admin-regions` | `region` | `name` |
| `/admin/users` | `page-admin-users` | `user` | `name`, `email`, `role`, `password` (create only), `storeIds` (hidden for ADMIN/SUPER_ADMIN), `isActive`. `btn-delete` = deactivate |
| `/admin/staff` | `page-admin-staff` | `staff` | `storeId`, `code`, `name`, `designation`, `shiftStart`, `shiftEnd`, `isActive`. Store filter `filter-staff-store` |
| `/admin/alert-rules` | `page-admin-alert-rules` | `alert-rule` | `name`, `storeId`, `metric` (incl. CHECKLIST_OVERDUE, CHECKLIST_NON_COMPLIANCE, AI_MANAGER_BREACH, EDGE_OFFLINE), `threshold`, `severity`, `channels`, `emails` (EMAIL), `webhookUrl` (WEBHOOK), `cooldownMin`, `autoTicket`, `isActive` |

### `/admin/stores/:id/cameras` — `page-admin-cameras`
**Store page** `/admin/stores/:id[/:tab]` (tab = overview | cameras | zones | recorders | edge | staff) — root `page-admin-store` (`page-admin-cameras` on the Cameras tab), `store-tabs` → `tab-store-<tab>`, `store-status`, `btn-back`, `btn-edit-store` → `dialog-store`. Overview: `store-overview`, `kpi-store-cameras|zones|recorders|edge|uptime`, `store-issues`. Zones tab: `store-zones`, `select-zone-camera`, `table-store-zones` → `row-store-zone-<id>`. Edge tab: the edge device list (`table-admin-edge-devices`, …). Staff tab: the roster list (`table-admin-staff`, …).
Cameras (phase B): `camera-source` ("DVR ch 3 · <recorder>") for recorder-linked cameras; `dialog-camera` adds `camera-test` → `btn-test-camera`, `camera-test-result` (`data-status`), `camera-test-snapshot`, `camera-test-unavailable` (no recorder backend yet). Zone editor adds `btn-redo-point`, `toggle-snap`, `toggle-labels`, `btn-refresh-snapshot`, and per layer `btn-toggle-zone` (show / hide).
**Recorders tab** (contract v3): `store-recorders` (`data-state` = loading | missing | error | ready), `recorders-missing` (404: "Recorder support needs a backend update"), `recorder-guide`, `btn-add-recorder`, `table-recorders` → `row-recorder-<id>` with `chip-recorder-status`, `recorder-last-checked`, `btn-channels`, `btn-edit`, `btn-delete` (409 → second confirm "Delete and unlink"). Drawer `dialog-recorder`: `input-recorder-brand` (`brand-option-<BRAND>`), `brand-help`, `input-recorder-kind`, `input-recorder-name`, `input-recorder-host`, `input-recorder-rtspPort`, `input-recorder-httpPort`, `input-recorder-username`, `input-recorder-password`, `input-recorder-channels`, `input-recorder-stream` (`stream-main` / `stream-sub`), `input-recorder-urlTemplate` (CUSTOM), `recorder-url-preview`, `error-<field>`, `form-error`, `discovered` → `discovered-list` → `discovered-<host>` with `btn-use-discovered`, `btn-save`, `btn-cancel`. Channels: `recorder-channels`, `btn-select-all-channels`, `btn-test-selected`, `btn-add-as-cameras` → `input-channels-type`, `input-channels-prefix`, `btn-confirm-add-cameras`; `channels-error`; `channel-grid` → `channel-<n>` (`data-status` = NONE | PENDING | RUNNING | OK | FAILED | EXPIRED) with `channel-select`, `channel-snapshot`, `channel-camera`, `channel-running`, `channel-status`, `channel-result`, `channel-error`.
`btn-back`, `btn-create-camera` → `dialog-camera` (`input-name`, `input-type`, `input-rtspUrl`, `input-isActive`), `table-admin-cameras` → `row-camera-<id>` with `btn-edit-zones`, `btn-edit`, `btn-delete`.
**Zone editor** (`zone-editor`, shown for the selected camera, defaults to the first): `zone-stage`, `zone-canvas` (SVG overlay — click to add points; coordinates are stored normalised 0..1), `zone-shape-<zoneId>` (existing zones), `draft-shape`, `draft-point-<index>` (drag to move), `direction-arrow` (ENTRY_LINE), `btn-new-zone`, `zone-list` → `zone-item-<zoneId>` (`btn-edit-zone`, `btn-delete-zone`), `zone-form` with `input-zone-name`, `input-zone-type`, `input-zone-direction` (ENTRY_LINE), `input-zone-engaged-dwell` (non-line), `input-zone-queue-length`, `input-zone-queue-wait` (QUEUE), `zone-reference` (SHELF: `btn-pick-reference` → `dialog-snapshot-picker` with `filter-picker-kind`, `picker-image-<snapshotId>`, `btn-select-snapshot`; then `zone-reference-thumb`, `zone-reference-id`), `input-zone-active`, `zone-points` ("N point(s)"), `zone-error`, `btn-undo-point`, `btn-clear-points`, `btn-cancel-zone`, `btn-save-zone`.
Tip: re-read `zone-canvas`'s bounding box right before clicking — the page can scroll when the form opens.

### `/admin/edge-devices` — `page-admin-edge-devices`
`filter-device-store`, `btn-create-edge-device` → `dialog-edge-device` (`input-name`, `input-storeId`, `btn-save`) → `dialog-api-key` with `api-key-value`, `btn-copy-api-key`, `btn-done`. `table-admin-edge-devices` → `row-edge-device-<id>` with `btn-rotate-key` (confirm → `dialog-api-key` again), `btn-delete`.
Phase B: `filter-device-store` is a store dropdown chip; `input-search-devices`; `dialog-api-key` adds `btn-download-env`.

### `/admin/settings` — `page-admin-settings`
`form-settings`, `input-companyName`, `input-currency`, `input-engagedStoreDwellSec`, `input-bounceSec`, `input-repeatWindowDays`, `input-aiServiceUrl`, `input-checklistReminderMinutes`, `btn-run-nudges` (admins), `input-alertEmailEnabled`, `input-smtpHost`, `input-smtpPort`, `input-smtpUser`, `input-smtpFrom`, `btn-save`.
Phase B: sections `set-general`, `set-metrics`, `set-ai`, `set-email` with an outline nav; sticky save bar with `btn-save` and `btn-discard`; `smtp-incomplete` warning when alert emails are on without SMTP host / from.

### `/admin/audit-log` — `page-admin-audit-log`
`filter-audit-user`, `filter-audit-entity`, `table-admin-audit-log` → `row-audit-<id>`, `paginator-audit`.
Phase B: `audit-total`, `btn-clear-filters`; a row opens `drawer-audit` with `audit-diff` (rows `data-kind` = changed | added | removed | same).

### Not found — `page-not-found`
`btn-home`.

---

## Role → landing page and guards

Unauthorised routes redirect to the role's home page (no error page): STAFF → `/tasks`, everyone else → `/dashboard`. Unauthenticated access redirects to `/login?returnUrl=…`. A session that expires mid-flow (any 401) redirects to `/login?returnUrl=<current page>&expired=1`, where `session-expired` explains it. See `README.md` for the full role → menu table.

## Design-system components (shared/ds)
- `ce-table`: `btn-clear-search` (filtered empty state); cells carry `data-label` / `data-col` / `data-m-hide` for the phone card layout; `table-total` ("N Total"), `input-table-search` (or the page's `searchTestId`), `btn-export` (or `exportTestId`), `btn-columns`, `table-bulkbar`, `<testId>-pager`; empty state `empty-state` with `data-kind` = `no-data` \| `filtered` \| `no-permission` \| `error`.
- `ce-tabs`: `tab-<value>` unless the tab defines its own testid; `ce-chip-list`: `chip-list-more`; `ce-drawer`: `drawer` (or `testId`), `btn-drawer-close`; `ce-page`: `page-title`, `page-last-refreshed`, `btn-page-back`.
- Dev build only: `/_styleguide` — `page-styleguide`.

## QA round 2 additions
- Shell: `offline-banner` (while `navigator.onLine` is false).
- Login: `session-expired` (after `AuthService.expire()`).
- Checklist fill: `local-draft-banner` (unsaved answers restored from this device).
- Compliance table: `score-none` (`--` for a store without submissions).
- AI Manager open / close: `oc-no-snaps` (card with the empty state when no snaps were received), `btn-show-store-days`.
- Tickets / infra health / ticket detail: the ticket forms are `ce-entity-drawer`s — `dialog-ticket`, `input-<key>`, `error-<key>`, `btn-save` (unchanged ids); submission detail "task from answer": `dialog-answer-task`.
