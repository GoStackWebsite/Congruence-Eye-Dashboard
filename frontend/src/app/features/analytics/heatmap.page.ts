import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSliderModule } from '@angular/material/slider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Camera, Heatmap } from '../../core/models/api.models';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { saveBlob } from '../../core/services/api.service';
import { FilterService } from '../../core/services/filter.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { addDays, parseIsoDate, shortDate, toIsoDate } from '../../core/utils/dates';
import { formatNumber, formatPct, humanize } from '../../core/utils/format';
import { HEAT_RAMP, cellValue, heatColor, spectrumColor } from '../../core/utils/heat';
import { DS, MetricItem } from '../../shared/ds';
import { NumPipe } from '../../shared/pipes';
import { SnapshotComponent } from '../../shared/ui/snapshot.component';
import { StorePickerComponent } from '../../shared/ui/store-picker.component';

/** Paints a heatmap grid onto a canvas of the given pixel size. Exported for testing. */
export function paintHeatmap(
  ctx: CanvasRenderingContext2D,
  h: Heatmap,
  w: number,
  ht: number,
  alpha: number,
  color: (v: number, max: number, alpha: number) => string | null = heatColor,
): number {
  ctx.clearRect(0, 0, w, ht);
  const cw = w / h.width;
  const ch = ht / h.height;
  const max = h.max || Math.max(0, ...h.grid);
  let painted = 0;
  for (let y = 0; y < h.height; y++) {
    for (let x = 0; x < h.width; x++) {
      const c = color(cellValue(h.grid, h.width, x, y), max, alpha);
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw), Math.ceil(ch));
      painted++;
    }
  }
  return painted;
}

/**
 * Smooth variant used by the concentration summary: the grid is rendered at its own resolution, then scaled up with
 * bilinear smoothing and a blur so hotspots read as soft blobs (cells below the colour threshold stay transparent).
 */
export function paintHeatmapSmooth(
  ctx: CanvasRenderingContext2D,
  h: Heatmap,
  w: number,
  ht: number,
  alpha: number,
  color: (v: number, max: number, alpha: number) => string | null,
): number {
  ctx.clearRect(0, 0, w, ht);
  const doc = ctx.canvas.ownerDocument;
  const small = doc?.createElement('canvas');
  const sctx = small?.getContext('2d');
  if (!small || !sctx) return paintHeatmap(ctx, h, w, ht, alpha, color);
  small.width = h.width;
  small.height = h.height;
  const max = h.max || Math.max(0, ...h.grid);
  let painted = 0;
  for (let y = 0; y < h.height; y++) {
    for (let x = 0; x < h.width; x++) {
      const c = color(cellValue(h.grid, h.width, x, y), max, alpha);
      if (!c) continue;
      sctx.fillStyle = c;
      sctx.fillRect(x, y, 1, 1);
      painted++;
    }
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if ('filter' in ctx) ctx.filter = `blur(${Math.max(2, Math.round(w / h.width / 2.5))}px)`;
  ctx.drawImage(small, 0, 0, w, ht);
  ctx.restore();
  return painted;
}

@Component({
  selector: 'ce-heatmap-page',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule, MatSliderModule, MatIconModule, MatTooltipModule, ...DS, StorePickerComponent, SnapshotComponent, NumPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-heatmap">
      <ce-page title="Heatmap" description="Where shoppers spend time on each camera view (32 × 18 occupancy grid)" [lastRefreshed]="true">
        <ng-container pageActions>
          <ce-store-picker [(value)]="storeId" testId="select-heatmap-store" />
          <mat-form-field subscriptSizing="dynamic" style="width: 230px">
            <mat-label>Camera</mat-label>
            <mat-select [ngModel]="cameraId()" (ngModelChange)="cameraId.set($event)" data-testid="select-heatmap-camera">
              @for (c of cameras(); track c.id) {
                <mat-option [value]="c.id" [attr.data-testid]="'select-heatmap-camera-option-' + c.id">{{ c.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </ng-container>

        @if (!cameras().length && camerasLoaded()) {
          <ce-card><ce-empty-state kind="no-data" icon="videocam_off" title="No cameras for this store" message="Add cameras under Admin › Stores › Cameras." /></ce-card>
        } @else {
          <div class="an-grid-2-1">
            <ce-card [title]="camera()?.name ?? 'Camera'" icon="blur_on" [subtitle]="storeName() + ' · ' + dayLabel()" info="Occupancy of each cell of the camera view (people detected per sample). Colour runs from violet (little time) to red (most time); empty cells stay transparent.">
              <button cardActions type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="download()" [disabled]="!heat.data()" data-testid="btn-download-heatmap-png"><mat-icon>download</mat-icon> Download</button>
              <ce-date-strip [days]="days()" [value]="day()" (valueChange)="day.set($event)" allLabel="All days" label="Heatmap day" />
              <div class="media-stage hm-stage" data-testid="heatmap-stage" #stage>
                <ce-snapshot [cameraId]="cameraId()" alt="Camera snapshot under heatmap" />
                <canvas #canvas width="1280" height="720" data-testid="heatmap-canvas" aria-label="Heatmap overlay"></canvas>
                @if (heat.loading()) {
                  <span class="stage-msg">Loading heatmap…</span>
                } @else if (heat.error()) {
                  <span class="stage-msg">Couldn't load the heatmap · <button type="button" class="ce-link-btn" style="color: #fff" (click)="heat.reload()">Retry</button></span>
                } @else if (heat.data() && !heat.data()!.max) {
                  <span class="stage-msg">No occupancy recorded for this period</span>
                }
              </div>
              <div class="hm-legend-row">
                <ce-gradient-legend title="Time spent" [ticks]="['Low', '', '', '', 'High']" />
                <div class="caption" data-testid="heatmap-legend">Low → High · peak cell {{ heat.data()?.max ?? 0 | num }} detections</div>
              </div>
            </ce-card>
            <ce-card title="View summary" icon="analytics" subtitle="Selected camera and period" info="Peak cell = the busiest cell's detections; coverage = share of the view with at least 10 % of the peak activity.">
              <ce-metric-list [items]="metrics()" data-testid="heatmap-metrics" />
              <div class="hm-opacity">
                <span class="ce-field-label">Overlay opacity</span>
                <mat-slider min="0.2" max="1" step="0.05" style="width: 100%">
                  <input matSliderThumb [ngModel]="alpha()" (ngModelChange)="alpha.set($event)" data-testid="input-heatmap-opacity" aria-label="Overlay opacity" />
                </mat-slider>
              </div>
              <div class="ce-field-label" style="margin-top: 6px">Cameras</div>
              <div class="hm-cams" data-testid="heatmap-camera-list">
                @for (c of cameras(); track c.id) {
                  <button type="button" class="hm-cam" [class.active]="c.id === cameraId()" (click)="cameraId.set(c.id)" [attr.data-testid]="'heatmap-camera-' + c.id">
                    <span class="material-symbols-outlined" aria-hidden="true">videocam</span>
                    <span class="ellipsis" [title]="c.name">{{ c.name }}</span>
                    <span class="caption">{{ type(c.type) }}</span>
                  </button>
                }
              </div>
            </ce-card>
          </div>
        }
      </ce-page>
    </section>
  `,
})
export class HeatmapPage {
  private readonly api = inject(AnalyticsApi);
  private readonly filter = inject(FilterService);
  private readonly lookup = inject(LookupService);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');

  readonly storeId = signal<number | null>(null);
  readonly cameraId = signal<number | null>(null);
  readonly cameras = signal<Camera[]>([]);
  readonly camerasLoaded = signal(false);
  readonly alpha = signal(0.7);
  readonly day = signal<string | null>(null);
  readonly ramp = HEAT_RAMP;

  readonly camera = computed(() => this.cameras().find((c) => c.id === this.cameraId()) ?? null);
  readonly storeName = computed(() => this.lookup.storeName()(this.storeId()));
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
    const r = this.filter.range();
    return d ? shortDate(d) : r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} – ${shortDate(r.to)}`;
  });

  readonly heat = loadOn(
    () => {
      const s = this.storeId();
      const c = this.cameraId();
      const p = this.filter.params();
      const d = this.day();
      return s && c ? { s, c, p: d ? { ...p, from: d, to: d } : p } : null;
    },
    ({ s, c, p }) => this.api.heatmap(s, c, p),
  );

  readonly metrics = computed<MetricItem[]>(() => {
    const h = this.heat.data();
    const total = h ? h.grid.reduce((s, v) => s + (v > 0 ? v : 0), 0) : null;
    const active = h ? h.grid.filter((v) => v > h.max * 0.1).length : null;
    let hot = '--';
    if (h?.max) {
      const i = h.grid.indexOf(h.max);
      const x = i % h.width;
      const y = Math.floor(i / h.width);
      const col = x < h.width / 3 ? 'left' : x < (2 * h.width) / 3 ? 'centre' : 'right';
      const row = y < h.height / 3 ? 'back' : y < (2 * h.height) / 3 ? 'middle' : 'front';
      hot = `${row} ${col}`;
    }
    return [
      { icon: 'local_fire_department', label: 'Peak cell', value: h ? formatNumber(h.max) : '--', testId: 'hm-peak' },
      { icon: 'my_location', label: 'Hottest area', value: hot, tone: 'neutral', testId: 'hm-hot-area' },
      { icon: 'grid_on', label: 'Coverage', value: h && active !== null ? formatPct((active / h.grid.length) * 100, 0) : '--', testId: 'hm-coverage' },
      { icon: 'groups', label: 'Detections', value: total === null ? '--' : formatNumber(total), testId: 'hm-total' },
    ];
  });

  constructor() {
    effect((onCleanup) => {
      const s = this.storeId();
      this.camerasLoaded.set(false);
      if (!s) return;
      const sub = this.lookup.cameras(s).subscribe((cams) => {
        this.cameras.set(cams);
        this.camerasLoaded.set(true);
        const pref = cams.find((c) => c.type === 'ZONE') ?? cams[0];
        if (!cams.some((c) => c.id === this.cameraId())) this.cameraId.set(pref?.id ?? null);
      });
      onCleanup(() => sub.unsubscribe());
    });
    effect(() => {
      const h = this.heat.data();
      const el = this.canvas()?.nativeElement;
      const a = this.alpha();
      const ctx = el?.getContext?.('2d');
      if (!el || !ctx) return;
      if (!h) {
        ctx.clearRect(0, 0, el.width, el.height);
        return;
      }
      paintHeatmapSmooth(ctx, h, el.width, el.height, a, (v, max, al) => spectrumColor(v, max, al, 0.1));
    });
  }

  type(t: string): string {
    return humanize(t);
  }

  protected readonly hasData = computed(() => !!this.heat.data()?.max);

  /** Snapshot + heatmap composited into one PNG. */
  download(): void {
    const heat = this.canvas()?.nativeElement;
    const img = this.stage()?.nativeElement.querySelector('img') as HTMLImageElement | null;
    if (!heat) return;
    const out = document.createElement('canvas');
    out.width = heat.width;
    out.height = heat.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#6b6b6b';
    ctx.fillRect(0, 0, out.width, out.height);
    if (img?.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, out.width, out.height);
    ctx.drawImage(heat, 0, 0);
    const r = this.filter.range();
    const name = `heatmap_${(this.camera()?.name ?? 'camera').replace(/\W+/g, '-').toLowerCase()}_${this.day() ?? `${r.from}_${r.to}`}.png`;
    out.toBlob((b) => b && saveBlob(b, name), 'image/png');
  }
}
