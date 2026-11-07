import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Heatmap, Overview, Zone, ZoneAnalytics } from '../../core/models/api.models';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { ApiService, saveBlob, silent } from '../../core/services/api.service';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { addDays, parseIsoDate, shortDate, toIsoDate } from '../../core/utils/dates';
import { formatDuration, formatNumber, formatPct } from '../../core/utils/format';
import { spectrumColor } from '../../core/utils/heat';
import { toSvgPoints } from '../../core/utils/zone-geometry';
import { DateStripComponent, GradientLegendComponent, MetricItem, MetricListComponent, ProgressComponent } from '../../shared/ds';
import { TitleCasePipe } from '@angular/common';
import { DurationPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { SnapshotComponent } from '../../shared/ui/snapshot.component';
import { paintHeatmapSmooth } from './heatmap.page';

/** Picks the zones of one store ordered by concentration (desc). Exported for tests. */
export function concentrationRanking(rows: ZoneAnalytics[], storeId: number | null): ZoneAnalytics[] {
  return rows
    .filter((z) => (storeId === null || z.storeId === storeId) && z.type !== 'ENTRY_LINE')
    .sort((a, b) => (b.concentrationPct ?? 0) - (a.concentrationPct ?? 0));
}

/** Most frequent dominant age band across zones, weighted by visits. */
export function dominantAge(rows: ZoneAnalytics[]): string | null {
  const w = new Map<string, number>();
  for (const z of rows) if (z.dominantAgeBand) w.set(z.dominantAgeBand, (w.get(z.dominantAgeBand) ?? 0) + z.visits);
  let best: string | null = null;
  let max = -1;
  for (const [k, v] of w) if (v > max) [best, max] = [k, v];
  return best;
}

/** Share (%) of the hottest cell in a heatmap grid — the top of the legend scale. */
export function maxSharePct(h: Heatmap | null | undefined): number {
  if (!h?.grid?.length) return 0;
  const sum = h.grid.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  return sum > 0 ? (Math.max(...h.grid) / sum) * 100 : 0;
}

/**
 * Zone › Concentration summary (reference 03): left — overall store card (footfall, avg dwell, engagers rate) and
 * the zone table (Footfall actuals / Dwell average / Concentration = zone engagers ÷ store footfall × 100);
 * centre — camera snapshot with the concentration heatmap, day strip, gradient legend and Download; right — the
 * metric list of the selected zone (or the whole store).
 */
@Component({
  selector: 'ce-zone-concentration',
  imports: [FormsModule, RouterLink, MatFormFieldModule, MatSelectModule, MatIconModule, MatTooltipModule, SnapshotComponent, DateStripComponent, GradientLegendComponent, MetricListComponent, ProgressComponent, PctPipe, DurationPipe, NumPipe, TitleCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="zc" data-testid="zone-concentration-summary">
      <!-- left: overall store + zone table -->
      <div class="zc-left">
        <div class="zc-head">
          <div>
            <h2 class="ce-card-title">
              Zone concentration summary
              <mat-icon class="ce-info" matTooltip="Concentration = people who engaged in the zone ÷ store footfall × 100. Higher means the zone pulls shoppers in." aria-label="About concentration">info</mat-icon>
            </h2>
            <p class="ce-card-sub">Analyse hotspots and dead zones of your store</p>
          </div>
        </div>
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="zc-store">
          <mat-icon matPrefix aria-hidden="true">storefront</mat-icon>
          <mat-select [ngModel]="storeId()" (ngModelChange)="pickStore($event)" data-testid="select-concentration-store" aria-label="Store">
            @for (s of stores(); track s.id) {
              <mat-option [value]="s.id">{{ s.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <button type="button" class="zc-overall" [class.selected]="selectedZoneId() === null" (click)="selectedZoneId.set(null)" data-testid="concentration-overall">
          <span class="zc-thumb">
            <ce-snapshot [cameraId]="overallCameraId()" alt="Store camera" />
          </span>
          <span class="zc-overall-body">
            <span class="zc-overall-stats">
              <span class="zc-dash"><b>{{ storeFootfall() | num }}</b><small>Footfall</small></span>
              <span class="zc-dash"><b>{{ storeDwellText() }}</b><small>Avg dwell time</small></span>
            </span>
            <span class="zc-overall-name">Overall store</span>
            <ce-progress [value]="engagersRate()" [gradient]="true" label="Engagers rate" [valueText]="engagersRate() === null ? '--' : (engagersRate()! | pct: 0)" info="Share of store footfall that engaged in at least one zone" />
          </span>
        </button>

        <div class="zc-table-wrap">
          <table class="zc-table">
            <thead>
              <tr>
                <th class="c-zone">Zone</th>
                <th class="r c-ff"><span class="th-tip" matTooltip="Footfall (actuals): visitors who entered the zone">Footfall</span></th>
                <th class="r c-dw"><span class="th-tip" matTooltip="Average dwell time in the zone">Dwell</span></th>
                <th class="r c-cc">
                  <span class="th-tip" matTooltip="Concentration = zone engagers ÷ store footfall × 100">Conc.<mat-icon class="ce-info" aria-label="Concentration = zone engagers ÷ store footfall × 100">info</mat-icon></span>
                </th>
              </tr>
            </thead>
            <tbody data-testid="concentration-list">
              @for (z of ranking(); track z.id) {
                <tr [class.selected]="selectedZoneId() === z.id" (click)="selectedZoneId.set(z.id)" [attr.data-testid]="'concentration-zone-' + z.id" tabindex="0" (keydown.enter)="selectedZoneId.set(z.id)">
                  <td class="c-zone">
                    <span class="zc-zone-cell">
                    <span class="zc-dot" [class]="'zc-dot c-' + z.classification" [attr.data-value]="z.classification" [attr.title]="(z.classification | titlecase) + ' zone'" role="img" [attr.aria-label]="(z.classification | titlecase) + ' zone'"></span>
                    <span class="zc-zone-name" [title]="z.name">{{ z.name }}</span>
                    </span>
                  </td>
                  <td class="r">{{ z.visits | num }}</td>
                  <td class="r">{{ z.avgDwellSec | duration }}</td>
                  <td class="r"><span class="zc-conc">{{ z.concentrationPct ?? 0 | pct: 0 }}</span></td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="zc-empty">No zones for this store yet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="zc-key caption" aria-hidden="true">
          <span><span class="zc-dot c-HOT"></span>Hot</span><span><span class="zc-dot c-WARM"></span>Warm</span><span><span class="zc-dot c-DEAD"></span>Dead</span>
          <span class="zc-key-note">vs the store's zone average</span>
        </div>
      </div>

      <!-- centre: heatmap -->
      <div class="zc-center">
        <div class="zc-head">
          <div>
            <h3 class="zc-title">
              {{ selectedZone()?.name ?? 'Overall store' }}
              <mat-icon class="ce-info" matTooltip="Where shoppers spent time on this camera view, as a share of all dwell on it" aria-label="About the heatmap">info</mat-icon>
            </h3>
            <p class="ce-card-sub">
              Store concentration heatmap
              @if (canEditZones() && storeId()) {
                · <a [routerLink]="['/admin/stores', storeId(), 'cameras']" style="text-decoration: underline" data-testid="link-add-zone">Add new zone</a>
              }
            </p>
          </div>
          <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="download()" [disabled]="!heat.data()" data-testid="btn-download-heatmap"><mat-icon>download</mat-icon> Download</button>
        </div>
        <ce-date-strip [days]="days()" [value]="day()" (valueChange)="day.set($event)" allLabel="All days" label="Heatmap day" />
        <div class="media-stage zc-stage" data-testid="concentration-heatmap" #stage>
          <ce-snapshot [cameraId]="cameraId()" alt="Camera view with heatmap" />
          <canvas #canvas width="640" height="360"></canvas>
          @if (zonePolygon()) {
            <svg class="overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" style="pointer-events: none">
              <polygon [attr.points]="zonePolygon()" fill="rgba(255,255,255,0.06)" stroke="#ffffff" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" />
            </svg>
          }
          @if (heat.loading()) {
            <span class="stage-msg">Loading heatmap…</span>
          } @else if (!heat.data() && cameraId()) {
            <span class="stage-msg">No heatmap for this selection</span>
          }
          <span class="zc-stage-tag">{{ storeName() }} · {{ dayLabel() }}</span>
        </div>
        <ce-gradient-legend title="Dwell intensity (% of the hottest spot)" [ticks]="ticks()" data-testid="heatmap-legend-concentration" />
      </div>

      <!-- right: metrics -->
      <div class="zc-right">
        <div class="zc-right-head">
          <span class="zc-period">{{ day() ? 'Daily' : 'Period' }}</span>
          <span class="caption">{{ selectedZone() ? 'Zone' : 'Store' }} metrics</span>
        </div>
        <ce-metric-list [items]="metrics()" data-testid="concentration-metrics" />
      </div>
    </div>
  `,
})
export class ZoneConcentrationComponent {
  protected readonly filter = inject(FilterService);
  private readonly analytics = inject(AnalyticsApi);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly rows = input.required<ZoneAnalytics[]>();
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');

  readonly storeId = signal<number | null>(null);
  readonly selectedZoneId = signal<number | null>(null);
  readonly day = signal<string | null>(null);
  readonly canEditZones = computed(() => this.auth.can('adminMaster'));

  readonly stores = computed(() => {
    const m = new Map<number, string>();
    for (const z of this.rows()) m.set(z.storeId, z.storeName);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });
  readonly storeName = computed(() => this.stores().find((s) => s.id === this.storeId())?.name ?? '');
  readonly ranking = computed(() => concentrationRanking(this.rows(), this.storeId()));
  readonly maxConc = computed(() => Math.max(1, ...this.ranking().map((z) => z.concentrationPct ?? 0)));
  readonly selectedZone = computed(() => this.ranking().find((z) => z.id === this.selectedZoneId()) ?? null);

  /** Days of the global range (latest 14) for the day strip. */
  readonly days = computed(() => {
    const r = this.filter.range();
    const out: string[] = [];
    let d = parseIsoDate(r.to);
    const from = parseIsoDate(r.from);
    while (d >= from && out.length < 14) {
      out.unshift(toIsoDate(d));
      d = addDays(d, -1);
    }
    return out;
  });
  readonly dayLabel = computed(() => {
    const d = this.day();
    if (!d) {
      const r = this.filter.range();
      return r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} – ${shortDate(r.to)}`;
    }
    return shortDate(d);
  });
  private readonly query = computed(() => {
    const p = this.filter.params();
    const d = this.day();
    return d ? { ...p, from: d, to: d } : p;
  });

  private readonly storeZones = loadOn(
    () => this.storeId(),
    (id) => this.api.get<Zone[]>('/zones', { storeId: id }, silent()).pipe(catchError(() => of([] as Zone[]))),
  );
  private readonly overview = loadOn(
    () => {
      const id = this.storeId();
      const p = this.query();
      return id ? { from: p.from, to: p.to, storeIds: [id] } : null;
    },
    (p) => this.analytics.overview(p).pipe(catchError(() => of(null as Overview | null))),
  );
  private readonly focusZone = computed(() => {
    const target = this.selectedZone() ?? this.ranking()[0];
    return target ? (this.storeZones.data() ?? []).find((z) => z.id === target.id) ?? null : null;
  });
  readonly overallCameraId = computed(() => {
    const top = this.ranking()[0];
    return (top && (this.storeZones.data() ?? []).find((z) => z.id === top.id)?.cameraId) ?? (this.storeZones.data() ?? [])[0]?.cameraId ?? null;
  });
  readonly cameraId = computed(() => this.focusZone()?.cameraId ?? this.overallCameraId());
  readonly zonePolygon = computed(() => {
    if (this.selectedZoneId() === null) return null;
    const z = this.focusZone();
    return z?.polygon?.length ? toSvgPoints(z.polygon, 1000, 1000) : null;
  });
  readonly heat = loadOn(
    () => {
      const s = this.storeId();
      const c = this.cameraId();
      return s && c ? { s, c, p: this.query() } : null;
    },
    ({ s, c, p }) => this.analytics.heatmap(s, c, p).pipe(catchError(() => of(null))),
  );
  /** Legend: intensity relative to the hottest spot of the view (0–100 %). */
  readonly ticks = computed(() => (this.heat.data() ? ['0', '25', '50', '75', '100'] : ['0', '100']));

  readonly storeFootfall = computed(() => this.overview.data()?.kpis?.footfall?.value ?? null);
  readonly storeDwellText = computed(() => {
    const v = this.overview.data()?.kpis?.avgDwellSec?.value;
    return v === null || v === undefined ? '--' : formatDuration(v);
  });
  readonly engagersRate = computed<number | null>(() => this.overview.data()?.kpis?.engagedPct?.value ?? null);

  readonly metrics = computed<MetricItem[]>(() => {
    const z = this.selectedZone();
    const dash = '--';
    if (z) {
      const male = z.genderSplit?.malePct ?? (z.male + z.female ? (z.male / (z.male + z.female)) * 100 : null);
      const female = z.genderSplit?.femalePct ?? (z.male + z.female ? (z.female / (z.male + z.female)) * 100 : null);
      return [
        { icon: 'directions_walk', label: 'Total footfall', value: formatNumber(z.visits), testId: 'metric-footfall' },
        { icon: 'u_turn_left', label: 'Bounced footfall', value: z.bouncedPct === undefined ? dash : formatNumber(Math.round((z.visits * z.bouncedPct) / 100)), testId: 'metric-bounced' },
        { icon: 'touch_app', label: 'Engagers', value: formatNumber(z.engaged), testId: 'metric-engagers' },
        { icon: 'center_focus_strong', label: 'Concentration', value: z.concentrationPct === undefined ? dash : formatPct(z.concentrationPct, 0), testId: 'metric-concentration' },
        { icon: 'man', label: 'Male', value: male === null ? dash : formatPct(male, 0), tone: 'male', testId: 'metric-male' },
        { icon: 'woman', label: 'Female', value: female === null ? dash : formatPct(female, 0), tone: 'female', testId: 'metric-female' },
        { icon: 'cake', label: 'Age range', value: z.dominantAgeBand ?? dash, tone: 'neutral', testId: 'metric-age' },
        { icon: 'timer', label: 'Avg dwell time', value: formatDuration(z.avgDwellSec), testId: 'metric-dwell' },
      ];
    }
    const k = this.overview.data()?.kpis;
    const zones = this.ranking();
    const m = zones.reduce((s, x) => s + x.male, 0);
    const f = zones.reduce((s, x) => s + x.female, 0);
    const ff = k?.footfall?.value ?? null;
    // unique engaged visitors of the store (engaged % of footfall). Summing zone `engaged` would count a shopper
    // once per zone they engaged in and can exceed footfall.
    const rate = k?.engagedPct?.value;
    const engagers = ff === null || rate === null || rate === undefined ? null : Math.round((ff * rate) / 100);
    return [
      { icon: 'directions_walk', label: 'Total footfall', value: ff === null ? dash : formatNumber(ff), testId: 'metric-footfall' },
      { icon: 'u_turn_left', label: 'Bounced footfall', value: ff === null || k?.bounceRatePct?.value == null ? dash : formatNumber(Math.round((ff * k.bounceRatePct.value) / 100)), testId: 'metric-bounced' },
      { icon: 'touch_app', label: 'Engagers', value: engagers === null ? dash : formatNumber(engagers), testId: 'metric-engagers' },
      { icon: 'center_focus_strong', label: 'Concentration', value: this.engagersRate() === null ? dash : formatPct(this.engagersRate(), 0), testId: 'metric-concentration' },
      { icon: 'man', label: 'Male', value: m + f ? formatPct((m / (m + f)) * 100, 0) : dash, tone: 'male', testId: 'metric-male' },
      { icon: 'woman', label: 'Female', value: m + f ? formatPct((f / (m + f)) * 100, 0) : dash, tone: 'female', testId: 'metric-female' },
      { icon: 'cake', label: 'Age range', value: dominantAge(zones) ?? dash, tone: 'neutral', testId: 'metric-age' },
      { icon: 'timer', label: 'Avg dwell time', value: this.storeDwellText(), testId: 'metric-dwell' },
    ];
  });

  constructor() {
    // default store: the one holding the hottest zone (falls back to the first store)
    effect(() => {
      const list = this.stores();
      const cur = this.storeId();
      if (!list.length || (cur !== null && list.some((s) => s.id === cur))) return;
      const hottest = concentrationRanking(this.rows(), null)[0];
      this.storeId.set(hottest?.storeId ?? list[0].id);
    });
    effect(() => {
      const h = this.heat.data();
      const el = this.canvas()?.nativeElement;
      const ctx = el?.getContext?.('2d');
      if (!el || !ctx) return;
      if (!h) ctx.clearRect(0, 0, el.width, el.height);
      else paintHeatmapSmooth(ctx, h, el.width, el.height, 0.78, (v, max, a) => spectrumColor(v, max, a));
    });
  }

  pickStore(id: number): void {
    this.storeId.set(id);
    this.selectedZoneId.set(null);
  }

  barPct(z: ZoneAnalytics): number {
    return ((z.concentrationPct ?? 0) / this.maxConc()) * 100;
  }

  /** Snapshot + heatmap composited into one PNG. */
  download(): void {
    const heat = this.canvas()?.nativeElement;
    const img = this.stage()?.nativeElement.querySelector('img') as HTMLImageElement | null;
    if (!heat) return;
    const out = document.createElement('canvas');
    out.width = 1280;
    out.height = 720;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#6b6b6b';
    ctx.fillRect(0, 0, out.width, out.height);
    if (img?.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, out.width, out.height);
    ctx.drawImage(heat, 0, 0, out.width, out.height);
    const name = `heatmap_${this.storeName().replace(/\s+/g, '-').toLowerCase()}_${this.day() ?? `${this.filter.range().from}_${this.filter.range().to}`}.png`;
    out.toBlob((b) => b && saveBlob(b, name), 'image/png');
  }
}
