import { ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Camera, Direction, Point, SnapshotImage, Zone, ZoneType } from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { addPoint, centroid, normalisePoint, toSvgPoints, validateZoneGeometry } from '../../core/utils/zone-geometry';
import { DS } from '../../shared/ds';
import { HumanizePipe } from '../../shared/pipes';
import { SnapshotPickerDialog } from '../../shared/ui/snapshot-picker.dialog';
import { SnapshotComponent } from '../../shared/ui/snapshot.component';
import { UiService } from '../../shared/ui/ui.service';
import { useOpsStyles } from '../../shared/ds/ops.styles';

/** Zone type colours: the DS categorical series (never colour alone — the legend and layer list name the type). */
export const ZONE_COLORS: Record<ZoneType, string> = {
  ENTRY_LINE: '#F79009',
  SECTION: '#2E90FA',
  QUEUE: '#12B76A',
  STAFF_ONLY: '#7A5AF8',
  SHELF: '#EE46BC',
};
export const ZONE_TYPE_HELP: Record<ZoneType, string> = {
  ENTRY_LINE: 'Counts people crossing the door line',
  SECTION: 'Visits, dwell and engagement in an area',
  QUEUE: 'Billing queue length and wait',
  STAFF_ONLY: 'Back-office / counter area for staff',
  SHELF: 'Stock-out checks against a full-shelf photo',
};
const ZONE_TYPES: ZoneType[] = ['ENTRY_LINE', 'SECTION', 'QUEUE', 'STAFF_ONLY', 'SHELF'];
const DIRECTIONS: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
/** SVG user-space size; normalised coordinates are multiplied by this. */
export const VB = 1000;
/** Snapping: 1 % grid, and existing vertices within 1.5 % of the frame. */
export const SNAP_GRID = 0.01;
export const SNAP_RADIUS = 0.015;

export interface ZoneDraft {
  id: number | null;
  name: string;
  type: ZoneType;
  polygon: Point[];
  inDirection: Direction | null;
  engagedDwellSec: number;
  queueAlertLength: number | null;
  queueAlertWaitSec: number | null;
  referenceSnapshotId: number | null;
  isActive: boolean;
}

export function emptyDraft(type: ZoneType = 'SECTION'): ZoneDraft {
  return { id: null, name: '', type, polygon: [], inDirection: type === 'ENTRY_LINE' ? 'DOWN' : null, engagedDwellSec: 30, queueAlertLength: null, queueAlertWaitSec: null, referenceSnapshotId: null, isActive: true };
}

/** Builds the API payload for a zone draft (only fields relevant to its type). */
export function zonePayload(d: ZoneDraft, storeId: number, cameraId: number): Partial<Zone> {
  const p: Partial<Zone> = {
    storeId,
    cameraId,
    name: d.name.trim(),
    type: d.type,
    polygon: d.polygon.map((pt) => [pt[0], pt[1]] as Point),
    engagedDwellSec: Number(d.engagedDwellSec) || 0,
    isActive: d.isActive,
  };
  p.inDirection = d.type === 'ENTRY_LINE' ? (d.inDirection ?? 'DOWN') : null;
  p.queueAlertLength = d.type === 'QUEUE' && d.queueAlertLength !== null && (d.queueAlertLength as unknown) !== '' ? Number(d.queueAlertLength) : null;
  p.referenceSnapshotId = d.type === 'SHELF' ? (d.referenceSnapshotId ?? null) : null;
  p.queueAlertWaitSec = d.type === 'QUEUE' && d.queueAlertWaitSec !== null && (d.queueAlertWaitSec as unknown) !== '' ? Number(d.queueAlertWaitSec) : null;
  return p;
}

/** Arrow (in SVG user space) from the midpoint of an entry line in its "in" direction. */
export function directionArrow(points: Point[], dir: Direction | null): { x1: number; y1: number; x2: number; y2: number } | null {
  if (points.length !== 2 || !dir) return null;
  const [a, b] = points;
  const mx = ((a[0] + b[0]) / 2) * VB;
  const my = ((a[1] + b[1]) / 2) * VB;
  const len = 80;
  const d = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] }[dir];
  return { x1: mx, y1: my, x2: mx + d[0] * len, y2: my + d[1] * len };
}

/** Snaps a normalised point to the nearest candidate vertex within `radius`, else to the grid (clamped to 0..1). */
export function snapPoint(p: Point, candidates: Point[], grid = SNAP_GRID, radius = SNAP_RADIUS): Point {
  let best: Point | null = null;
  let bestD = radius;
  for (const c of candidates) {
    const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  if (best) return [best[0], best[1]];
  const r = (v: number) => Math.min(1, Math.max(0, Math.round(v / grid) * grid));
  return [Number(r(p[0]).toFixed(4)), Number(r(p[1]).toFixed(4))];
}

/**
 * Zone editor: toolbar (new zone, undo / redo, clear, snapping, labels, refresh), the camera view with the zones
 * drawn on it (click to add points, drag points to move), a layer list with show/hide, a zone type colour legend
 * and the zone form. Ctrl+Z / Ctrl+Shift+Z undo and redo point edits; Esc cancels the draft.
 */
@Component({
  selector: 'ce-zone-editor',
  imports: [FormsModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatTooltipModule, SnapshotComponent, ...DS, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { '(keydown)': 'onKey($event)' },
  template: `
    <div class="zone-editor ops-ze" data-testid="zone-editor">
      <div class="ops-stack" style="gap: 0">
        <div class="ops-ze-toolbar" role="toolbar" aria-label="Zone drawing tools">
          <button type="button" class="ops-tb-btn" (click)="newZone()" data-testid="btn-new-zone"><mat-icon>add</mat-icon> New zone</button>
          <span class="ops-tb-sep" aria-hidden="true"></span>
          <button type="button" class="ops-tb-btn" (click)="undo()" [disabled]="!canUndo()" matTooltip="Undo (Ctrl+Z)" data-testid="btn-undo-point"><mat-icon>undo</mat-icon> Undo</button>
          <button type="button" class="ops-tb-btn" (click)="redo()" [disabled]="!redoStack().length" matTooltip="Redo (Ctrl+Shift+Z)" aria-label="Redo" data-testid="btn-redo-point"><mat-icon>redo</mat-icon></button>
          <button type="button" class="ops-tb-btn" (click)="clearPoints()" [disabled]="!draft()?.polygon?.length" data-testid="btn-clear-points"><mat-icon>ink_eraser</mat-icon> Clear</button>
          <span class="ops-tb-sep" aria-hidden="true"></span>
          <button type="button" class="ops-tb-btn" [class.on]="snap()" (click)="snap.set(!snap())" [attr.aria-pressed]="snap()" matTooltip="Snap to a 1% grid and to nearby corners" data-testid="toggle-snap"><mat-icon>grid_4x4</mat-icon> Snap</button>
          <button type="button" class="ops-tb-btn" [class.on]="labels()" (click)="labels.set(!labels())" [attr.aria-pressed]="labels()" matTooltip="Show zone names on the view" data-testid="toggle-labels"><mat-icon>label</mat-icon> Labels</button>
          <button type="button" class="ops-tb-btn" (click)="refresh.set(refresh() + 1)" matTooltip="Reload the camera snapshot" aria-label="Reload snapshot" data-testid="btn-refresh-snapshot"><mat-icon>refresh</mat-icon></button>
          <span class="ops-spacer"></span>
          <span class="caption" aria-live="polite">{{ hint() }}</span>
        </div>
        <div class="media-stage" data-testid="zone-stage">
          <ce-snapshot [cameraId]="camera().id" [alt]="camera().name" [refresh]="refresh()" [neverSeen]="!camera().lastHeartbeatAt" />
          <svg
            #svg
            class="overlay"
            [attr.viewBox]="'0 0 ' + vb + ' ' + vb"
            preserveAspectRatio="none"
            (click)="onStageClick($event)"
            (pointermove)="onPointerMove($event)"
            (pointerup)="endDrag()"
            (pointerleave)="endDrag()"
            data-testid="zone-canvas"
            role="application"
            aria-label="Camera view. Click to add zone points; drag a point to move it."
          >
            <defs>
              <marker id="ze-arrowhead" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" [attr.fill]="color('ENTRY_LINE')" />
              </marker>
            </defs>
            @for (z of shownZones(); track z.id) {
              @if (z.type === 'ENTRY_LINE') {
                <polyline class="zone-shape" [attr.points]="svgPoints(z.polygon)" [attr.stroke]="color(z.type)" fill="none" opacity="0.8" (click)="select(z, $event)" [style.pointer-events]="draft() ? 'none' : 'auto'" style="cursor: pointer" [attr.data-testid]="'zone-shape-' + z.id" />
              } @else {
                <polygon class="zone-shape" [attr.points]="svgPoints(z.polygon)" [attr.stroke]="color(z.type)" [attr.fill]="color(z.type)" fill-opacity="0.18" opacity="0.85" (click)="select(z, $event)" [style.pointer-events]="draft() ? 'none' : 'auto'" style="cursor: pointer" [attr.data-testid]="'zone-shape-' + z.id" />
              }
              @if (labels()) {
                <text class="zone-label" pointer-events="none" [attr.x]="label(z.polygon)[0]" [attr.y]="label(z.polygon)[1]" text-anchor="middle"><title>{{ z.name }}</title>{{ shortLabel(z.name) }}</text>
              }
            }
            @if (draft(); as d) {
              @if (d.type === 'ENTRY_LINE' || d.polygon.length < 3) {
                <polyline class="zone-shape" [attr.points]="svgPoints(d.polygon)" [attr.stroke]="color(d.type)" fill="none" stroke-dasharray="12 6" data-testid="draft-shape" />
              } @else {
                <polygon class="zone-shape" [attr.points]="svgPoints(d.polygon)" [attr.stroke]="color(d.type)" [attr.fill]="color(d.type)" fill-opacity="0.3" data-testid="draft-shape" />
              }
              @if (arrow(); as a) {
                <line [attr.x1]="a.x1" [attr.y1]="a.y1" [attr.x2]="a.x2" [attr.y2]="a.y2" [attr.stroke]="color('ENTRY_LINE')" stroke-width="4" vector-effect="non-scaling-stroke" marker-end="url(#ze-arrowhead)" data-testid="direction-arrow" />
              }
              @for (p of d.polygon; track $index) {
                <circle
                  [attr.cx]="p[0] * vb"
                  [attr.cy]="p[1] * vb"
                  r="9"
                  fill="#fff"
                  [attr.stroke]="color(d.type)"
                  stroke-width="3"
                  vector-effect="non-scaling-stroke"
                  style="cursor: move"
                  (pointerdown)="startDrag($index, $event)"
                  (click)="$event.stopPropagation()"
                  [attr.data-testid]="'draft-point-' + $index"
                />
              }
            }
          </svg>
        </div>
        <div class="ops-ze-legend" aria-label="Zone type colours">
          @for (t of types; track t) {
            <span [matTooltip]="help[t]"><i [style.background]="color(t)"></i>{{ t | humanize }}</span>
          }
        </div>
      </div>

      <div class="ops-stack">
        <div>
          <div class="ops-row" style="margin-bottom: 8px">
            <h3 class="ops-section-title" style="margin: 0">Zones on {{ camera().name }}</h3>
            <span class="ce-count-badge">{{ zones().length }}</span>
          </div>
          <ul class="ops-layers" data-testid="zone-list" aria-label="Zone layers">
            @for (z of zones(); track z.id) {
              <li [class.active]="draft()?.id === z.id" [class.hidden-layer]="hidden().has(z.id)" [attr.data-testid]="'zone-item-' + z.id">
                <span class="ops-layer-swatch" [style.background]="color(z.type)" aria-hidden="true"></span>
                <span class="ops-layer-name">
                  <span class="ops-ellipsis" [title]="z.name">{{ z.name }}</span>
                  <small>{{ z.type | humanize }}{{ z.isActive ? '' : ' · inactive' }}</small>
                </span>
                <button type="button" class="ce-icon-btn sm" (click)="toggleHidden(z.id)" [matTooltip]="hidden().has(z.id) ? 'Show on view' : 'Hide on view'" [attr.aria-label]="(hidden().has(z.id) ? 'Show ' : 'Hide ') + z.name" data-testid="btn-toggle-zone">
                  <mat-icon>{{ hidden().has(z.id) ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
                <button type="button" class="ce-icon-btn sm" (click)="select(z)" matTooltip="Edit" aria-label="Edit zone" data-testid="btn-edit-zone"><mat-icon>edit</mat-icon></button>
                <button type="button" class="ce-icon-btn sm" (click)="remove(z)" matTooltip="Delete" aria-label="Delete zone" data-testid="btn-delete-zone"><mat-icon>delete</mat-icon></button>
              </li>
            } @empty {
              <li class="empty">{{ loading() ? 'Loading zones…' : 'No zones yet. Click the view or “New zone”.' }}</li>
            }
          </ul>
        </div>

        @if (draft(); as d) {
          <div class="ops-ze-form" data-testid="zone-form">
            <div class="ops-row">
              <span class="ops-layer-swatch" [style.background]="color(d.type)" aria-hidden="true"></span>
              <span class="ops-strong">{{ d.id ? 'Edit zone' : 'New zone' }}</span>
              <span class="ops-spacer"></span>
              <span class="caption" data-testid="zone-points">{{ d.polygon.length }} point(s){{ d.type === 'ENTRY_LINE' ? ' — needs exactly 2' : ' — needs 3 or more' }}</span>
            </div>
            <div class="ops-form-grid">
              <div class="ops-field full">
                <label class="ce-field-label" for="ze-name">Zone name</label>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                  <input id="ze-name" matInput [ngModel]="d.name" (ngModelChange)="patch({ name: $event })" placeholder="e.g. Sarees, Main door" maxlength="80" data-testid="input-zone-name" />
                </mat-form-field>
              </div>
              <div class="ops-field">
                <label class="ce-field-label">Type</label>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                  <mat-select [ngModel]="d.type" (ngModelChange)="setType($event)" data-testid="input-zone-type" aria-label="Zone type">
                    @for (t of types; track t) {
                      <mat-option [value]="t"><span class="ops-layer-swatch" [style.background]="color(t)" style="display: inline-block; margin-right: 8px; vertical-align: -1px"></span>{{ t | humanize }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              </div>
              @if (d.type === 'ENTRY_LINE') {
                <div class="ops-field">
                  <label class="ce-field-label">“In” direction</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                    <mat-select [ngModel]="d.inDirection" (ngModelChange)="patch({ inDirection: $event })" data-testid="input-zone-direction" aria-label="In direction">
                      @for (dir of directions; track dir) {
                        <mat-option [value]="dir">{{ dir | humanize }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                </div>
              } @else {
                <div class="ops-field">
                  <label class="ce-field-label" for="ze-dwell">Engaged dwell (s)</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                    <input id="ze-dwell" matInput type="number" min="0" [ngModel]="d.engagedDwellSec" (ngModelChange)="patch({ engagedDwellSec: $event })" data-testid="input-zone-engaged-dwell" />
                  </mat-form-field>
                </div>
              }
              @if (d.type === 'QUEUE') {
                <div class="ops-field">
                  <label class="ce-field-label" for="ze-ql">Alert at queue length</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                    <input id="ze-ql" matInput type="number" min="0" [ngModel]="d.queueAlertLength" (ngModelChange)="patch({ queueAlertLength: $event })" data-testid="input-zone-queue-length" />
                  </mat-form-field>
                </div>
                <div class="ops-field">
                  <label class="ce-field-label" for="ze-qw">Alert at wait (s)</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                    <input id="ze-qw" matInput type="number" min="0" [ngModel]="d.queueAlertWaitSec" (ngModelChange)="patch({ queueAlertWaitSec: $event })" data-testid="input-zone-queue-wait" />
                  </mat-form-field>
                </div>
              }
              @if (d.type === 'SHELF') {
                <div class="full ops-stack" style="gap: 8px" data-testid="zone-reference">
                  <div class="ops-help">Reference “full shelf” snapshot — stock-out detection compares against it.</div>
                  <div class="ops-row">
                    @if (refUrl()) {
                      <img class="ops-thumb" [src]="refUrl()" alt="Reference snapshot" data-testid="zone-reference-thumb" />
                    }
                    <span class="caption" data-testid="zone-reference-id">{{ d.referenceSnapshotId ? 'Snapshot #' + d.referenceSnapshotId : 'None selected' }}</span>
                    <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="pickReference()" data-testid="btn-pick-reference"><mat-icon>photo_library</mat-icon> Choose from image directory</button>
                  </div>
                </div>
              }
              <div class="full">
                <mat-checkbox [ngModel]="d.isActive" (ngModelChange)="patch({ isActive: $event })" data-testid="input-zone-active">Active</mat-checkbox>
              </div>
            </div>
            <div class="caption">{{ help[d.type] }}</div>
            @if (error()) {
              <div class="ops-inline-error" role="alert" data-testid="zone-error">{{ error() }}</div>
            }
            <div class="ops-ze-form-foot">
              <span class="ops-spacer"></span>
              <button type="button" class="ce-btn ce-btn-ghost" (click)="cancel()" data-testid="btn-cancel-zone">Cancel</button>
              <button type="button" class="ce-btn ce-btn-primary" (click)="save()" [disabled]="saving()" data-testid="btn-save-zone">{{ saving() ? 'Saving…' : 'Save zone' }}</button>
            </div>
          </div>
        } @else {
          <ce-info-banner>Select a zone to edit it, or click on the camera view to start a new one.</ce-info-banner>
        }
      </div>
    </div>
  `,
})
export class ZoneEditorComponent {
  protected readonly opsCss = useOpsStyles();
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly dialog = inject(MatDialog);
  readonly refUrl = signal<string | null>(null);
  readonly camera = input.required<Camera>();
  readonly storeId = input.required<number>();
  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');

  readonly vb = VB;
  readonly types = ZONE_TYPES;
  readonly help = ZONE_TYPE_HELP;
  readonly directions = DIRECTIONS;
  readonly zones = signal<Zone[]>([]);
  readonly loading = signal(false);
  readonly draft = signal<ZoneDraft | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly dragIndex = signal<number | null>(null);
  readonly snap = signal(true);
  readonly labels = signal(true);
  readonly refresh = signal(0);
  readonly hidden = signal<Set<number>>(new Set());
  /** Undo / redo stacks of polygon states for the current draft. */
  readonly undoStack = signal<Point[][]>([]);
  readonly redoStack = signal<Point[][]>([]);
  private justDragged = false;
  private dragStart: Point[] | null = null;

  readonly shownZones = computed(() => this.zones().filter((z) => z.id !== this.draft()?.id && !this.hidden().has(z.id)));
  readonly canUndo = computed(() => this.undoStack().length > 0 || (this.draft()?.polygon.length ?? 0) > 0);
  readonly arrow = computed(() => {
    const d = this.draft();
    return d?.type === 'ENTRY_LINE' ? directionArrow(d.polygon, d.inDirection) : null;
  });
  readonly hint = computed(() => {
    const d = this.draft();
    if (!d) return 'Select a zone or click the view to start one';
    if (d.type === 'ENTRY_LINE') return d.polygon.length < 2 ? `Click ${2 - d.polygon.length} more point(s) for the door line` : 'Drag points to adjust';
    return d.polygon.length < 3 ? `Click to add points (${d.polygon.length}/3 minimum)` : 'Click to add points · drag to adjust';
  });

  constructor() {
    effect(() => {
      const cam = this.camera();
      this.draft.set(null);
      this.hidden.set(new Set());
      this.load(cam.id);
    });
  }

  load(cameraId: number): void {
    this.loading.set(true);
    this.api.get<Zone[]>('/zones', { storeId: this.storeId(), cameraId }).subscribe({
      next: (z) => {
        this.zones.set(z.filter((x) => x.cameraId === cameraId));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  color(t: ZoneType): string {
    return ZONE_COLORS[t];
  }
  svgPoints(p: Point[]): string {
    return toSvgPoints(p, VB, VB);
  }
  label(p: Point[]): [number, number] {
    const c = centroid(p);
    return [c[0] * VB, c[1] * VB];
  }

  toggleHidden(id: number): void {
    const s = new Set(this.hidden());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.hidden.set(s);
  }

  private resetHistory(): void {
    this.undoStack.set([]);
    this.redoStack.set([]);
  }

  private pushHistory(prev: Point[]): void {
    this.undoStack.update((s) => [...s.slice(-49), prev.map((p) => [p[0], p[1]] as Point)]);
    this.redoStack.set([]);
  }

  newZone(): void {
    this.error.set(null);
    this.refUrl.set(null);
    this.resetHistory();
    this.draft.set(emptyDraft('SECTION'));
  }

  select(z: Zone, ev?: Event): void {
    ev?.stopPropagation();
    this.error.set(null);
    this.refUrl.set(null);
    this.resetHistory();
    this.draft.set({
      id: z.id,
      name: z.name,
      type: z.type,
      polygon: (z.polygon ?? []).map((p) => [p[0], p[1]] as Point),
      inDirection: z.inDirection ?? (z.type === 'ENTRY_LINE' ? 'DOWN' : null),
      engagedDwellSec: z.engagedDwellSec ?? 30,
      queueAlertLength: z.queueAlertLength ?? null,
      queueAlertWaitSec: z.queueAlertWaitSec ?? null,
      referenceSnapshotId: z.referenceSnapshotId ?? null,
      isActive: z.isActive,
    });
  }

  patch(p: Partial<ZoneDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...p } : d));
  }

  setType(type: ZoneType): void {
    this.draft.update((d) => {
      if (!d) return d;
      const polygon = type === 'ENTRY_LINE' && d.polygon.length > 2 ? d.polygon.slice(0, 2) : d.polygon;
      return { ...d, type, polygon, inDirection: type === 'ENTRY_LINE' ? (d.inDirection ?? 'DOWN') : null };
    });
  }

  private box() {
    const r = this.svg()!.nativeElement.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  /** Vertices to snap to: other zones' corners and the draft's own (except the one being moved). */
  private snapTargets(exclude: number | null): Point[] {
    const d = this.draft();
    const own = (d?.polygon ?? []).filter((_, i) => i !== exclude);
    return [...this.shownZones().flatMap((z) => z.polygon ?? []), ...own];
  }

  private place(ev: MouseEvent, exclude: number | null): Point {
    const p = normalisePoint(ev.clientX, ev.clientY, this.box());
    return this.snap() ? snapPoint(p, this.snapTargets(exclude)) : p;
  }

  onStageClick(ev: MouseEvent): void {
    if (this.justDragged) {
      this.justDragged = false;
      return;
    }
    if (!this.draft()) this.newZone();
    const p = this.place(ev, null);
    const cur = this.draft()!;
    this.pushHistory(cur.polygon);
    this.draft.set({ ...cur, polygon: addPoint(cur.type, cur.polygon, p) });
    this.error.set(null);
  }

  startDrag(i: number, ev: PointerEvent): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.dragStart = this.draft()?.polygon.map((p) => [p[0], p[1]] as Point) ?? null;
    this.dragIndex.set(i);
  }

  onPointerMove(ev: PointerEvent): void {
    const i = this.dragIndex();
    if (i === null) return;
    this.justDragged = true;
    const p = this.place(ev, i);
    this.draft.update((d) => (d ? { ...d, polygon: d.polygon.map((pt, idx) => (idx === i ? p : pt)) } : d));
  }

  endDrag(): void {
    if (this.dragIndex() !== null && this.dragStart && this.justDragged) this.pushHistory(this.dragStart);
    this.dragStart = null;
    this.dragIndex.set(null);
  }

  pickReference(): void {
    this.dialog
      .open(SnapshotPickerDialog, {
        data: { storeId: this.storeId(), cameraId: this.camera().id, title: 'Reference (full shelf) snapshot' },
        width: '900px',
        maxWidth: '96vw',
      })
      .afterClosed()
      .subscribe((img?: SnapshotImage) => {
        if (!img) return;
        this.refUrl.set(img.url);
        this.patch({ referenceSnapshotId: img.id });
      });
  }

  undo(): void {
    const d = this.draft();
    if (!d) return;
    const stack = this.undoStack();
    const prev = stack.length ? stack[stack.length - 1] : d.polygon.slice(0, -1);
    this.undoStack.set(stack.slice(0, -1));
    this.redoStack.update((r) => [...r, d.polygon]);
    this.draft.set({ ...d, polygon: prev });
  }

  redo(): void {
    const d = this.draft();
    const r = this.redoStack();
    if (!d || !r.length) return;
    this.undoStack.update((s) => [...s, d.polygon]);
    this.redoStack.set(r.slice(0, -1));
    this.draft.set({ ...d, polygon: r[r.length - 1] });
  }

  clearPoints(): void {
    const d = this.draft();
    if (!d) return;
    this.pushHistory(d.polygon);
    this.draft.set({ ...d, polygon: [] });
  }

  cancel(): void {
    this.draft.set(null);
    this.error.set(null);
    this.resetHistory();
  }

  onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (e.key === 'Escape' && this.draft()) this.cancel();
  }

  save(): void {
    const d = this.draft();
    if (!d || this.saving()) return;
    if (!d.name.trim()) {
      this.error.set('Zone name is required');
      return;
    }
    const geomErr = validateZoneGeometry(d.type, d.polygon);
    if (geomErr) {
      this.error.set(geomErr);
      return;
    }
    const body = zonePayload(d, this.storeId(), this.camera().id);
    this.saving.set(true);
    const req = d.id ? this.api.patch<Zone>(`/zones/${d.id}`, body) : this.api.post<Zone>('/zones', body);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.ui.toast('Zone saved');
        this.draft.set(null);
        this.resetHistory();
        this.load(this.camera().id);
      },
      error: () => this.saving.set(false),
    });
  }

  remove(z: Zone): void {
    this.ui.confirm({ title: 'Delete zone?', message: `Delete "${z.name}"? Historic analytics remain.`, confirmText: 'Delete', danger: true }).subscribe(() =>
      this.api.delete(`/zones/${z.id}`).subscribe(() => {
        if (this.draft()?.id === z.id) this.draft.set(null);
        this.ui.toast('Zone deleted');
        this.load(this.camera().id);
      }),
    );
  }

  /** Zone names on the camera image are shortened (full name in the SVG <title> tooltip and in the zone list). */
  shortLabel(name: string): string {
    const chars = Array.from(name ?? '');
    return chars.length > 22 ? chars.slice(0, 21).join('').trimEnd() + '…' : name;
  }
}
