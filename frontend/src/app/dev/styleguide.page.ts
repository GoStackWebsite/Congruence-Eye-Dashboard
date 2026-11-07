import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Kpi } from '../core/models/api.models';
import { cartesian, stackedGrids } from '../shared/charts/chart-builders';
import { CeColumn, DS, MetricItem, STATUS_TONES, TabItem, Tone } from '../shared/ds';

interface DemoRow {
  id: number;
  name: string;
  frequency: string;
  owner: string;
  assigned: number;
  submitted: number | null;
  flags: number;
  status: string;
  due: string;
}

const ROWS: DemoRow[] = [
  { id: 1, name: 'Store Opening Checklist', frequency: 'Daily', owner: 'Priya Raman', assigned: 2412, submitted: 2247, flags: 166, status: 'SUBMITTED', due: '2026-10-05' },
  { id: 2, name: 'EOD Store Checklist', frequency: 'Daily', owner: 'Karthik S', assigned: 2405, submitted: 2215, flags: 242, status: 'IN_PROGRESS', due: '2026-10-05' },
  { id: 3, name: 'Visual Merchandising Audit', frequency: 'Weekly', owner: 'Meena Iyer', assigned: 240, submitted: null, flags: 0, status: 'OVERDUE', due: '2026-10-03' },
  { id: 4, name: 'Basic Hygiene and Cleanliness — a very long checklist name that must ellipsis', frequency: 'Daily', owner: 'Arun Kumar', assigned: 2543, submitted: 1554, flags: 989, status: 'PENDING', due: '2026-10-06' },
];

/** Dev-only living style guide: every DS component in its states (route /_styleguide, non-production builds). */
@Component({
  selector: 'ce-styleguide-page',
  imports: [FormsModule, MatIconModule, MatTooltipModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule, MatCheckboxModule, ...DS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-styleguide">
      <ce-page title="Design system" description="Congruence Eye DS v2 — components and states (docs/STYLE_GUIDE.md)" [lastRefreshed]="true" [breadcrumbs]="true">
        <ng-container pageActions>
          <button class="ce-btn ce-btn-secondary" type="button"><mat-icon>ios_share</mat-icon> Export</button>
          <button class="ce-btn ce-btn-primary" type="button"><mat-icon>add</mat-icon> Create</button>
        </ng-container>
        <ce-tabs pageTabs [tabs]="pageTabs" [(value)]="pageTab" />

        <ce-card title="Buttons & inputs" subtitle="36px controls, 8px radius" info="Material is restyled; .ce-btn for plain buttons">
          <div class="sg-row">
            <button class="ce-btn ce-btn-primary" type="button">Primary</button>
            <button class="ce-btn ce-btn-secondary" type="button">Secondary</button>
            <button class="ce-btn ce-btn-ghost" type="button">Ghost</button>
            <button class="ce-btn ce-btn-danger" type="button">Danger</button>
            <button class="ce-btn ce-btn-primary" type="button" disabled>Disabled</button>
            <button class="ce-btn ce-btn-secondary ce-btn-sm" type="button"><mat-icon>tune</mat-icon> Small</button>
            <button class="ce-icon-btn" type="button" aria-label="Refresh"><mat-icon>refresh</mat-icon></button>
            <label class="ce-search"><mat-icon>search</mat-icon><input placeholder="Search by checklist" /></label>
          </div>
          <div class="sg-row" style="margin-top: 14px">
            <mat-form-field appearance="outline" subscriptSizing="dynamic" style="width: 220px"><mat-label>Text field</mat-label><input matInput placeholder="Type here" /></mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" style="width: 200px">
              <mat-label>Select</mat-label>
              <mat-select [(ngModel)]="selectValue"><mat-option value="a">Daily</mat-option><mat-option value="b">Weekly</mat-option></mat-select>
            </mat-form-field>
            <mat-slide-toggle [(ngModel)]="toggleValue">Compare</mat-slide-toggle>
            <mat-checkbox [(ngModel)]="toggleValue">Auto assign</mat-checkbox>
            <ce-segmented [options]="segOptions" [(value)]="seg" />
          </div>
        </ce-card>

        <ce-card title="Stat tiles" subtitle="band · compact · strip, with delta and loading">
          <div class="sg-grid-4">
            <ce-stat-tile variant="band" label="Total store footfall" [value]="440" [kpi]="kpiUp" [compare]="true" link="/dashboard">
              <div class="ce-stat-detail-title">K Series</div>
              <div class="ce-stat-detail">Zone with the highest footfall — <b>207</b></div>
            </ce-stat-tile>
            <ce-stat-tile variant="band" label="Conversion" format="pct" [kpi]="kpiDown" [compare]="true" hint="Transactions ÷ billable entities" />
            <ce-stat-tile variant="compact" icon="directions_walk" label="Footfall in" [kpi]="kpiUp" [compare]="true" />
            <ce-stat-tile variant="compact" icon="timer" label="Avg. dwell" [loading]="true" />
          </div>
          <ce-stat-strip style="margin-top: 14px">
            <ce-stat-tile variant="strip" label="Active checklists" [value]="38" link="/checklists" />
            <ce-stat-tile variant="strip" label="Checklist instances" [value]="48186" />
            <span class="ce-stat-strip-sep"></span>
            <ce-stat-tile variant="strip" label="Not submitted" [value]="35135" />
            <ce-stat-tile variant="strip" label="Completion score" format="pct" [value]="27" [delta]="0" deltaLabel="vs last day" />
            <ce-stat-tile variant="strip" label="Total flags" [value]="35465" [delta]="1.2" deltaLabel="vs last day" />
          </ce-stat-strip>
        </ce-card>

        <ce-card title="Pills" subtitle="STATUS_TONES — one map for every status">
          <div class="sg-row">
            @for (s of statuses; track s) {
              <ce-pill [value]="s" />
            }
          </div>
          <div class="sg-row" style="margin-top: 10px">
            @for (t of tones; track t) {
              <ce-pill [tone]="t" [label]="t" />
            }
            <ce-pill tone="brand" label="With icon" icon="auto_awesome" />
          </div>
        </ce-card>

        <ce-table
          [rows]="tableState() === 'empty' ? [] : rows"
          [columns]="cols"
          [loading]="tableState() === 'loading'"
          title="Checklist info"
          subtitle="ce-table: link-number, pill, avatar, date, sort, search, export, columns, selection"
          [searchable]="true"
          [exportable]="true"
          [columnChooser]="true"
          [selectable]="true"
          [rowClickable]="true"
          [pageSize]="10"
          testId="sg-table"
          [rowTestId]="rowId"
        >
          <div tableFilters class="sg-row" style="margin-top: 6px">
            <ce-segmented [options]="tableStates" [value]="tableState()" (valueChange)="tableState.set($any($event))" />
          </div>
          <button bulkActions type="button" class="ce-btn ce-btn-secondary ce-btn-sm">Assign task</button>
          <ng-template ceCell="action" let-r>
            <button type="button" class="ce-icon-btn sm" aria-label="View" matTooltip="View"><mat-icon>visibility</mat-icon></button>
          </ng-template>
        </ce-table>

        <div class="sg-grid-2">
          <ce-form-section title="Schedule" info="Section with sentence inputs" description="ce-form-section + ce-toggle-row + ce-info-banner">
            <ce-info-banner>Store open and close detections use each store's opening and closing times.</ce-info-banner>
            <ce-toggle-row label="Set buffer time" helper="When enabled, alerts are paused during the buffer period" [(checked)]="toggleValue">
              <div class="ce-sentence"><span>If store open time exceeds by</span><input class="ce-inline-input" type="number" value="5" /><span>minutes</span></div>
            </ce-toggle-row>
            <div class="ce-tag-box"><ce-chip-list [items]="chips()" [max]="5" (remove)="removeChip($event)" /></div>
          </ce-form-section>
          <ce-card title="Banners & empty states">
            <div class="stack">
              <ce-info-banner tone="info">Info: the camera at Adyar is reconnecting.</ce-info-banner>
              <ce-info-banner tone="warning" title="Partial data">2 cameras offline — numbers may be low.</ce-info-banner>
              <ce-info-banner tone="success">Rule published to 6 stores.</ce-info-banner>
              <ce-info-banner tone="danger">Couldn't save the rule.</ce-info-banner>
            </div>
            <div class="sg-grid-2" style="margin-top: 10px">
              <ce-empty-state kind="no-data" [compact]="true" />
              <ce-empty-state kind="filtered" [compact]="true" />
              <ce-empty-state kind="no-permission" [compact]="true" />
              <ce-empty-state kind="error" [compact]="true"><button class="ce-btn ce-btn-secondary ce-btn-sm" type="button">Retry</button></ce-empty-state>
            </div>
          </ce-card>
        </div>

        <div class="sg-grid-3">
          <ce-card title="Metric list">
            <ce-metric-list [items]="metrics" />
          </ce-card>
          <ce-card title="Date strip, progress, legend, avatars">
            <ce-date-strip [days]="days" [(value)]="day" />
            <div class="stack" style="margin-top: 14px">
              <ce-progress [value]="85" [gradient]="true" label="Engagers rate" valueText="85%" info="Gradient variant" />
              <ce-progress [value]="62" label="Completion" valueText="62%" />
              <ce-gradient-legend title="Percentage" [ticks]="[0, 12, 20, 27, 35]" />
              <div class="sg-row">
                @for (n of people; track n) {
                  <ce-avatar [name]="n" [size]="32" />
                }
              </div>
            </div>
          </ce-card>
          <ce-card title="Skeletons">
            <div class="stack">
              <ce-skeleton kind="tiles" [count]="2" />
              <ce-skeleton kind="chart" height="90px" />
              <ce-skeleton kind="text" [count]="2" />
            </div>
          </ce-card>
        </div>

        <div class="sg-grid-2-1">
          <ce-card title="Chart · congruence theme" icon="monitoring" info="Hairline grid, 11px axis labels, square legend top-left">
            <ce-chart [options]="chart" height="300px" />
          </ce-card>
          <ce-card title="Drawer" subtitle="480 / 640 px, full screen on phones">
            <button type="button" class="ce-btn ce-btn-secondary" (click)="drawer.set(true)" data-testid="sg-open-drawer">Open drawer</button>
            <ce-chart [options]="chart2" height="200px" />
          </ce-card>
        </div>
        <ce-drawer [(open)]="drawer" title="Task info" subtitle="#TASK-903 · Hustlr tray" testId="sg-drawer">
          <ce-metric-list [items]="metrics.slice(0, 4)" />
          <button drawerFooter type="button" class="ce-btn ce-btn-secondary" (click)="drawer.set(false)">Close</button>
          <button drawerFooter type="button" class="ce-btn ce-btn-primary">Save</button>
        </ce-drawer>
      </ce-page>
    </section>
  `,
  styles: `
    .sg-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .sg-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .sg-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
    .sg-grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .sg-grid-2-1 { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; }
    @media (max-width: 1023.98px) { .sg-grid-2, .sg-grid-3, .sg-grid-4, .sg-grid-2-1 { grid-template-columns: 1fr; } }
  `,
})
export class StyleguidePage {
  readonly pageTabs: TabItem[] = [
    { value: 'components', label: 'Components', count: 22 },
    { value: 'tokens', label: 'Tokens' },
    { value: 'patterns', label: 'Patterns' },
  ];
  readonly pageTab = signal('components');
  readonly segOptions: TabItem[] = [
    { value: 'checklist', label: 'Checklist' },
    { value: 'task', label: 'Task' },
  ];
  readonly seg = signal('checklist');
  readonly tableStates: TabItem[] = [
    { value: 'data', label: 'Data' },
    { value: 'loading', label: 'Loading' },
    { value: 'empty', label: 'Empty' },
  ];
  readonly tableState = signal<'data' | 'loading' | 'empty'>('data');
  selectValue = 'a';
  toggleValue = true;
  readonly drawer = signal(false);
  readonly day = signal<string | null>(null);
  readonly days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];
  readonly people = ['Rohit Verma', 'Maverik', 'Raj', 'Jasmine K', 'Olivia Rhye', 'Phoenix Baker'];
  readonly statuses = ['ON_TIME', 'EARLY', 'LATE', 'BREACHED', 'COMPLIED', 'OPEN', 'OVERDUE', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'CRITICAL', 'OFFLINE', 'DRAFT'];
  readonly tones: Tone[] = ['good', 'warning', 'serious', 'critical', 'info', 'neutral'];
  readonly toneCount = Object.keys(STATUS_TONES).length;
  readonly kpiUp: Kpi = { value: 12480, previous: 11530, changePct: 8.2 };
  readonly kpiDown: Kpi = { value: 26.4, previous: 27.9, changePct: -5.4 };
  readonly chips = signal(['LKST-895', 'LKST-896', 'LKST-897', 'LKST-898', 'LKST-899', 'LKST-900', 'LKST-901'].map((x) => ({ id: x, label: x })));
  removeChip(id: string | number): void {
    this.chips.update((c) => c.filter((x) => x.id !== id));
  }
  readonly rows = ROWS;
  readonly rowId = (r: DemoRow) => `sg-row-${r.id}`;
  readonly cols: CeColumn<DemoRow>[] = [
    { key: 'name', header: 'Checklist name', type: 'link', link: () => '/_styleguide', sortable: true, locked: true },
    { key: 'frequency', header: 'Scheduled', sortable: true },
    { key: 'owner', header: 'Created by', type: 'avatar', sortable: true },
    { key: 'assigned', header: 'Assigned to', type: 'number', sortable: true },
    { key: 'submitted', header: 'Submitted', type: 'link-number', sortable: true, click: () => undefined },
    { key: 'flags', header: 'Flags', type: 'link-number', sortable: true, click: () => undefined },
    { key: 'status', header: 'Status', type: 'pill', sortable: true },
    { key: 'due', header: 'Due on', type: 'date', sortable: true, sub: '(store time)' },
    { key: 'action', header: 'Action', type: 'actions', value: () => 'x', align: 'center' },
  ];
  readonly metrics: MetricItem[] = [
    { icon: 'directions_walk', label: 'Total footfall', value: '21' },
    { icon: 'u_turn_left', label: 'Bounced footfall', value: '5' },
    { icon: 'touch_app', label: 'Engagers', value: '16' },
    { icon: 'center_focus_strong', label: 'Concentration', value: '76%' },
    { icon: 'man', label: 'Male', value: '62%', tone: 'male' },
    { icon: 'woman', label: 'Female', value: '38%', tone: 'female' },
    { icon: 'cake', label: 'Age range', value: '20–30', tone: 'neutral' },
    { icon: 'timer', label: 'Avg dwell time', value: '14 mins' },
  ];
  readonly chart = stackedGrids(
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    {
      title: 'Footfall & transactions',
      fmt: 'number',
      series: [
        { name: 'Footfall', type: 'bar', data: [420, 380, 460, 510, 640, 820, 760] },
        { name: 'Transactions', type: 'bar', data: [110, 96, 120, 140, 170, 230, 205] },
      ],
    },
    { title: 'Conversion %', fmt: 'pct', series: [{ name: 'Conversion %', type: 'line', data: [26.2, 25.3, 26.1, 27.5, 26.6, 28.0, 27.0] }] },
  );
  readonly chart2 = cartesian(['Below 12', '13–19', '20–30', '31–45', '46–59', '60+'], [{ name: 'Share %', type: 'bar', data: [1, 1, 45, 43, 7, 4] }], 'pct', { horizontal: true });
}
