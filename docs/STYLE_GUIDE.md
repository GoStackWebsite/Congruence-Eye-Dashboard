# Congruence Eye — Style guide (DS v2)

How to build screens with the design system described in `docs/DESIGN_SYSTEM.md`. Every component lives in
`frontend/src/app/shared/ds/` and is exported from `shared/ds/index.ts`; import the whole kit with:

```ts
import { DS } from '../../shared/ds';

@Component({ imports: [...DS], ... })
```

A living catalogue of every component in all its states is served at **`/_styleguide`** in development builds
(`npm start`). The route is swapped in by `angular.json` → `development.fileReplacements`
(`src/app/dev/dev.routes.ts` → `dev.routes.development.ts`), so production and demo builds don't contain it.

## Foundations

| Layer | File |
|---|---|
| Tokens (`--c-*`, radius, shadow, type scale; dark mode via `light-dark()`) | `src/styles/_tokens.scss` |
| Angular Material restyled (36px outlined fields, 8px buttons, small switches, menus, dialogs, datepicker, tabs, table, tooltips) | `src/styles/_material.scss` |
| Base & helpers (`.muted`, `.caption`, `.ellipsis`, `.row`, `.stack`) | `src/styles/_base.scss` |
| Shell (rail, module panel, top bar, global filter, tab bar) | `src/styles/_shell.scss` |
| DS component styles | `src/styles/_ds.scss` |
| Screens rebuilt on the DS (login, home, Trax dashboard, rule editor, zone concentration) | `src/styles/_screens.scss` |
| v1 page classes, re-skinned on the tokens (pages not yet rebuilt) | `src/styles/_legacy.scss` |

Rules of thumb: colour is for data and status only; 13px body, 4px grid, 16–20px card padding, 48px table rows;
shadows only on overlays (`--shadow-overlay`); numbers that drill down are link-blue and underlined; empty values are
`--`; status is always a pill.

Buttons outside Material forms use plain classes: `ce-btn ce-btn-primary | ce-btn-secondary | ce-btn-ghost |
ce-btn-danger`, size `ce-btn-sm`, icon button `ce-icon-btn` (`sm`). Search boxes: `<label class="ce-search">`.
Sentence inputs: `.ce-sentence` + `input.ce-inline-input` (`wide`, `xwide`).

Charts use the registered ECharts theme **`congruence`** / **`congruence-dark`** (`shared/charts/chart-theme.ts`):
hairline grid, 11px axis labels in `--c-text-3`, white tooltip card with the overlay shadow, square legend markers at
the top-left. Categorical order (validated with the dataviz palette checker, CVD ΔE ≥ 8 between neighbours):
`#2E90FA #F79009 #7A5AF8 #12B76A #EE46BC #6172F3 #36BFFA` (dark: same hues at the -600 step). Never a dual axis —
use `stackedGrids()` for two measures. Density tables use the blue sequential ramp; the concentration heatmap uses the
violet→red spectrum with transparency below threshold (`heat.ts` `spectrumColor`).

---

## ce-page
Page frame: optional breadcrumbs, title, description, "Last refreshed at", actions and tabs slots.
```html
<ce-page title="Checklist dashboard" description="Completion and compliance…" [lastRefreshed]="true">
  <ng-container pageActions>
    <button class="ce-btn ce-btn-secondary">Export</button>
    <a class="ce-btn ce-btn-primary" routerLink="/checklists/templates/new">Create checklist</a>
  </ng-container>
  <ce-tabs pageTabs [tabs]="tabs" [(value)]="tab" />
  …body…
</ce-page>
```
`[lastRefreshed]="true"` follows the global filter refresh time; pass a `Date` for page-specific data. `[breadcrumbs]="true"`
repeats the top-bar breadcrumbs above the title; `backLink` adds a back arrow.

## ce-card
```html
<ce-card title="Footfall & conversion" subtitle="29 Sep – 05 Oct" icon="monitoring" info="Metric definition…">
  <a cardActions class="ce-link-btn small" routerLink="/alerts">View all</a>
  <span cardBadge class="ce-count-badge">34</span>
  <ce-chart [options]="opts" height="320px" />
</ce-card>
<ce-card title="Rules" [flush]="true">…table without padding…</ce-card>
```

## ce-stat-tile
Variants `band` (Tango tinted header band), `compact` (icon + label + value + delta) and `strip` (inside ce-stat-strip).
With `id` the host is `data-testid="kpi-<id>"` and the value `data-testid="kpi-value"`; the delta is `kpi-change`.
```html
<ce-stat-tile variant="band" id="footfall" label="Footfall" [kpi]="kpis.footfall" [compare]="filter.compare()" link="/analytics/traffic" sub="Customer entries" />
<ce-stat-tile variant="band" label="Total store footfall" [value]="440">
  <div class="ce-stat-detail-title">K Series</div>
  <div class="ce-stat-detail">Zone with the highest footfall — <b>207</b></div>
</ce-stat-tile>
<ce-stat-tile variant="compact" icon="timer" label="Avg. dwell" format="duration" [value]="591" [loading]="busy" />
```
`format`: `number | inr | inrCompact | pct | duration | decimal`. `delta` + `deltaLabel` show a change without a Kpi.

## ce-stat-strip
```html
<ce-stat-strip label="Checklist summary">
  <ce-stat-tile variant="strip" id="trax-active" label="Active checklists" [value]="38" link="/checklists" />
  <span class="ce-stat-strip-sep"></span>
  <ce-stat-tile variant="strip" id="trax-flags" label="Total flags" [value]="35465" hint="…" />
</ce-stat-strip>
```
Becomes a 2-column grid on phones.

## ce-table
Declarative columns. Types: `text`, `number`, `link-number`, `link`, `pill`, `date`, `datetime`, `avatar`, `percent`,
`actions`, `custom`. Null/undefined/'' render `--`.
```ts
cols: CeColumn<Row>[] = [
  { key: 'name', header: 'Checklist name', type: 'link', link: (r) => ['/checklists/templates', r.id], sortable: true, locked: true },
  { key: 'assigned', header: 'Assigned to', type: 'number', sortable: true },
  { key: 'submitted', header: 'Submitted', type: 'link-number', click: (r) => this.open(r) },
  { key: 'status', header: 'Status', type: 'pill' },
  { key: 'owner', header: 'Created by', type: 'avatar' },
  { key: 'params', header: 'Settings', hidden: true, wrap: true },      // off until chosen in the column menu
  { key: 'action', header: 'Action', type: 'actions', value: () => '' },
];
```
```html
<ce-table [rows]="rows()" [columns]="cols" [loading]="busy" title="Checklist info" subtitle="Showing data on …"
          [searchable]="true" searchPlaceholder="Search by checklist" [exportable]="true" (exportClick)="exportCsv()"
          [columnChooser]="true" [selectable]="true" (selectionChange)="sel = $event"
          [rowClickable]="true" (rowClick)="open($event)" [pageSize]="25"
          testId="table-trax-checklist" [rowTestId]="rowId" [defaultSort]="{ key: 'submitted', dir: 'desc' }">
  <ng-template ceCell="action" let-r><button class="ce-icon-btn sm" (click)="view(r)"><mat-icon>visibility</mat-icon></button></ng-template>
  <button bulkActions class="ce-btn ce-btn-secondary ce-btn-sm">Assign task</button>
  <div tableFilters>…filter chips…</div>
  <a tableActions class="ce-btn ce-btn-primary">Create</a>
</ce-table>
```
Loading shows skeleton rows; no rows shows the empty state (`emptyTitle`/`emptyMessage`), a search with no hits shows
the "filtered" empty state. Header is sticky; pagination 10/25/50/100. `[bare]="true"` drops the outer card border.
Phase B additions (all optional): `wrap: true` lets a column wrap (cells are single-line with ellipsis by default),
`cellClass(row)` / `cellAttrs(row)` per cell, `[rowClass]="fn"` per row, `sortStart="asc"` for the first click,
header cells (`role="columnheader"`) sort on click, and `currentRows()` returns the rows in the displayed order (for
client CSV export).
QA additions: `date` columns accept full ISO timestamps (shown as the store-local day); long text / link / avatar cells
get a `title` tooltip with the full value; a search with no hits offers **Clear search** (`btn-clear-search`); the scroll
area is keyboard reachable. **Phones:** `[mobileCards]` (default `true`) turns every row into a stacked card below
768 px — the first cell is the card title, the others read "header … value" (`data-label` = `mobileLabel ?? header`);
mark secondary columns `mobileHide: true` to leave them out. Set `[mobileCards]="false"` only for dense matrices that
must keep their columns (they then scroll inside the card, never the page).

## ce-tabs / ce-segmented
```html
<ce-tabs [tabs]="[{ value: 'checklist', label: 'Checklist performance', count: 6 }, …]" [(value)]="tab" queryParam="tab" />
<ce-segmented [options]="[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }]" [(value)]="gran" />
```
Tabs use `role="tab"` and arrow keys; `queryParam` syncs the selection to the URL.

## ce-pill and STATUS_TONES
```html
<ce-pill value="BREACHED" />            <!-- red, "Breached" -->
<ce-pill value="ON_TIME" size="sm" />   <!-- green, "On time" -->
<ce-pill tone="brand" label="Beta" icon="auto_awesome" />
```
All status colours come from `STATUS_TONES` in `shared/ds/status-tones.ts` (also used by the legacy `<ce-chip>`).
Add new statuses there, never inline.

## ce-chip-list
```html
<div class="ce-tag-box">
  <ce-chip-list [items]="stores" [max]="12" (remove)="removeStore($event)" testIdPrefix="store-chip-" />
</div>
```
Items: `{ id, label, badge?, title? }`; overflow collapses into "+N more".

## ce-form-section, ce-toggle-row, sentence inputs
```html
<ce-form-section title="Rule settings" anchor="sec-settings" info="…" description="…">
  <ce-toggle-row label="Set buffer time" helper="When enabled, alerts are paused during the buffer period" [(checked)]="buffer">
    <div class="ce-sentence">
      <span>If store open time exceeds by</span>
      <input class="ce-inline-input" type="number" [(ngModel)]="tolerance" />
      <span>minutes</span>
    </div>
  </ce-toggle-row>
</ce-form-section>
```

## ce-info-banner
```html
<ce-info-banner>Store open and close detections use each store's own timings.</ce-info-banner>
<ce-info-banner tone="warning" title="Partial data">2 cameras offline.</ce-info-banner>
```
Tones: `info | warning | success | danger` (danger has `role="alert"`).

## ce-empty-state
```html
<ce-empty-state kind="no-data" />
<ce-empty-state kind="filtered" />
<ce-empty-state kind="no-permission" />
<ce-empty-state kind="error"><button class="ce-btn ce-btn-secondary ce-btn-sm" (click)="reload()">Retry</button></ce-empty-state>
<ce-empty-state icon="smart_toy" title="No AI checklists" message="Create one to start…" [compact]="true" />
```

## ce-skeleton
```html
<ce-skeleton kind="tiles" [count]="5" />  <ce-skeleton kind="chart" height="320px" />
<ce-skeleton kind="table" [count]="6" />  <ce-skeleton kind="text" [count]="3" />
```

## ce-drawer
```html
<ce-drawer [(open)]="showTask" title="Task info" subtitle="#TASK-903" size="lg">
  …details…
  <button drawerFooter class="ce-btn ce-btn-primary">Save</button>
</ce-drawer>
```
480px (`lg` 640px), full screen on phones, Esc and backdrop close it. Escape is ignored while something on top of the
drawer handles it (an open mat-select / menu / autocomplete / dialog — `defaultPrevented` or an attached CDK overlay),
so closing a dropdown never discards the form.

## ce-entity-drawer (forms)
`shared/ds/entity-drawer.component.ts`: create / edit form in a `ce-drawer` built from `AdminField`s (the shared
`FieldDef` plus `validate(value, all)`, `group`, `helper`, `pattern` + `patternMessage`, `maxLength`, `tz`). Testids:
`dialog-<entity>`, `input-<key>`, `error-<key>`, `form-error`, `btn-save`, `btn-cancel`. Inline validation, server errors
on their field (`mapServerError`, e.g. 409 → `code`), Save locked while the request runs (a double click posts once).
`datetime` fields are store time (Asia/Kolkata), never the browser zone. `UiService.form()` (legacy generic form) opens
as the same right-hand side sheet (`.ce-side-sheet`). Toolbar store filter: `ce-store-chip-filter`.
Editors with unsaved work implement `HasUnsavedChanges` and use `unsavedChangesGuard` (`shared/ds/unsaved-changes.guard.ts`);
the guard never blocks the redirect to /login when the session has expired.

## ce-metric-list
```ts
metrics: MetricItem[] = [{ icon: 'directions_walk', label: 'Total footfall', value: '21' }, { icon: 'man', label: 'Male', value: '62%', tone: 'male' }];
```
```html
<ce-metric-list [items]="metrics" />
```

## ce-date-strip
```html
<ce-date-strip [days]="['2026-11-28', '2026-11-29']" [(value)]="day" allLabel="All days" />
```

## ce-progress / ce-gradient-legend
```html
<ce-progress [value]="85" [gradient]="true" label="Engagers rate" valueText="85%" info="…" />
<ce-gradient-legend title="Dwell intensity (%)" [ticks]="[0, 25, 50, 75, 100]" />
```

## ce-avatar
```html
<ce-avatar name="Arun Kumar" [size]="28" />
```
Initials with a colour derived from the name (the same person always gets the same colour).

## ce-chart
```html
<ce-chart [options]="stackedGrids(cats, top, bottom)" height="320px" testId="chart-daily" ariaLabel="Daily footfall" />
```
Theme-aware (re-created on light/dark switch). Build options with `shared/charts/chart-builders.ts`
(`cartesian`, `stackedGrids`, `donut`, `conversionFlowChart`, `conversionFunnelChart`). `chartReady` emits the ECharts
instance; `toDataUrl()` returns a PNG data URL. Horizontal category labels are truncated (110px on phones, 260px otherwise).

## ce-chart-card
Chart card for analytics pages: ce-card + ce-chart with an info tooltip, optional granularity control, Download menu
(PNG via ECharts `getDataURL`, CSV derived from the series or the `csv` input) and loading / empty / error states.
```html
<ce-chart-card title="Daily footfall" [subtitle]="rangeLabel()" info="Metric definition…" [options]="opts()"
               [hasData]="rows().length > 0" [loading]="data.loading()" [error]="data.error()" (retry)="data.reload()"
               [granularities]="[{ value: 'daily', label: 'Daily', testId: 'gran-daily' }, { value: 'weekly', label: 'Weekly', testId: 'gran-weekly' }]"
               [(granularity)]="gran" chartTestId="chart-traffic-daily" height="300px">
  <mat-select chartActions …>…</mat-select>   <!-- extra header controls -->
  <div class="flow-legend">…</div>            <!-- content under the chart -->
</ce-chart-card>
```
Download testids: `btn-download-<key>`, `btn-download-png-<key>`, `btn-download-csv-<key>` (key = `chartTestId` without
`chart-`, else the slugified title). `emptyKind` is an `EmptyKind`: `filtered` (default, "No results for these
filters"), `no-data` ("No data yet"), `no-permission` or `error`; `emptyTitle` / `emptyMessage` override the copy.
Charts whose every value is 0 for an empty base should pass `[hasData]="false"` (show the empty state, never a flat
zero chart); a running day in a daily series is drawn as a partial "so far" point (`markPartialDay`).

---

## Shell
`layout/shell.component.ts`: 64px navy rail (`rail-<module>`), 224px module panel (`nav-<page>` links grouped, count
badges `nav-badge-<page>` from `NavCountsService`), 56px top bar (breadcrumbs from `BreadcrumbService`, global filter,
theme, bell, user menu). Modules and groups are declared in `core/auth/permissions.ts` (`NAV_MODULES`) and filtered by
role. Detail routes add breadcrumb context with route data `{ crumb: 'Editor', navId: 'ai-rules' }`.
Below 1280px the panel becomes a flyout; below 1024px rail + panel are a slide-over (`btn-menu`) and the filters move
into a sheet (`btn-filters`); below 768px a bottom tab bar appears (Home, Checklists, Tasks, Alerts, More).

## Page patterns
- **Analytics**: `ce-page` → band/compact tiles → 2/3 + 1/3 chart cards → detail `ce-table`.
- **Management list**: `ce-stat-strip` → `ce-tabs` → `ce-table` (search, Export, Create) → row opens an editor/drawer.
- **Editor**: sticky header with Save as draft / Publish, 260px outline, stacked `ce-form-section`s (see the AI checklist editor).
- **States**: loading (skeleton), empty (no data / filtered / no permission), error (retry), `--` for missing values
  and for ratios over an empty base (0 footfall → conversion `--`, never 0 % / NaN), ellipsis with `title` for long
  names, offline banner (`offline-banner`, shell), session expiry → `/login?returnUrl=…&expired=1`.
- **Status tones**: every status (incl. `TODO`, recorder `PARTIAL`, probe `RUNNING` / `OK` / `FAILED` / `EXPIRED`) is in
  `STATUS_TONES` / `STATUS_LABELS`; pages never pass ad-hoc colours.
