import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import { Camera, CameraRecorderLink, Probe, Recorder } from '../../../core/models/api.models';
import { ApiService, silent } from '../../../core/services/api.service';
import { humanize } from '../../../core/utils/format';
import { enumOptions } from '../../../shared/crud/field';
import { CeColumn, DS } from '../../../shared/ds';
import { DateTimePipe } from '../../../shared/pipes';
import { UiService } from '../../../shared/ui/ui.service';
import { AdminField, EntityDrawerComponent } from '../../../shared/ds/entity-drawer.component';
import { useOpsStyles } from '../../../shared/ds/ops.styles';
import { RecorderApi } from '../recorders/recorder.api';
import { channelLabel, httpStatus, isTerminal, probeErrorMessage, probeTone, resolutionLabel } from '../recorders/recorder.helpers';
import { ZoneEditorComponent } from '../zone-editor.component';

export type AdminCamera = Camera & CameraRecorderLink;

/** Hides an inline RTSP password: rtsp://user:secret@host → rtsp://user:****@host. */
export function maskRtsp(url: string | null | undefined): string {
  return (url ?? '').replace(/^(rtsp:\/\/[^:/@]+:)([^@]+)(@)/i, (_, a, p, b) => (p === '****' ? `${a}${p}${b}` : `${a}****${b}`));
}

const CAMERA_TYPES = ['ENTRANCE', 'ZONE', 'BILLING', 'GENERAL'];
const RTSP = /^rtsp:\/\/\S+$/i;

/**
 * Store › Cameras: camera list (recorder-linked cameras show "DVR ch 3"), add / edit drawer with "Test connection"
 * (live probe through the store's edge box), and the zone editor for the selected camera.
 */
@Component({
  selector: 'ce-store-cameras',
  imports: [MatIconModule, MatTooltipModule, MatProgressSpinnerModule, ...DS, EntityDrawerComponent, ZoneEditorComponent, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="ops-stack">
      @if (error() && !cameras()) {
        <ce-card>
          <ce-empty-state kind="error" [message]="error()">
            <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="reload.emit()" data-testid="btn-retry">Retry</button>
          </ce-empty-state>
        </ce-card>
      } @else {
        <ce-table
          [rows]="cameras() ?? []"
          [columns]="cols"
          [loading]="loading() && !cameras()"
          title="Cameras"
          [subtitle]="subtitle()"
          [searchable]="(cameras() ?? []).length > 8"
          searchPlaceholder="Search cameras"
          searchTestId="input-search-cameras"
          testId="table-admin-cameras"
          [rowTestId]="rowId"
          [rowClass]="rowClass"
          [paginate]="false"
          emptyIcon="videocam_off"
          emptyTitle="No cameras yet"
          emptyMessage="Add the store's CCTV cameras by RTSP address, or add a DVR / NVR under Recorders and create cameras from its channels."
        >
          <button tableActions type="button" class="ce-btn ce-btn-primary" (click)="edit(null)" data-testid="btn-create-camera"><mat-icon>add</mat-icon> New camera</button>
          <ng-template ceCell="name" let-c>
            <div class="ops-user-text">
              <span class="ops-strong ops-ellipsis" [title]="c.name">{{ c.name }}</span>
              @if (source(c); as s) {
                <span class="caption" data-testid="camera-source">{{ s }}</span>
              } @else {
                <span class="caption ops-mono ops-ellipsis" [title]="mask(c.rtspUrl)">{{ mask(c.rtspUrl) || '--' }}</span>
              }
            </div>
          </ng-template>
          <ng-template ceCell="status" let-c>
            <span class="ops-row" style="gap: 4px; flex-wrap: nowrap">
              <ce-pill [value]="c.status" size="sm" />
              @if (!c.isActive) {
                <ce-pill value="INACTIVE" size="sm" />
              }
            </span>
          </ng-template>
          <ng-template ceCell="lastHeartbeatAt" let-c>
            @if (c.lastHeartbeatAt) {
              <span [title]="c.lastHeartbeatAt | dt">{{ c.lastHeartbeatAt | dt: 'relative' }}</span>
            } @else {
              <span class="dash">Never</span>
            }
          </ng-template>
          <ng-template ceCell="actions" let-c>
            <span class="ops-row-actions">
              <button type="button" class="ce-btn ce-btn-sm" [class.ce-btn-primary]="selectedCamera()?.id === c.id" [class.ce-btn-secondary]="selectedCamera()?.id !== c.id" (click)="select(c)" data-testid="btn-edit-zones">
                <mat-icon>polyline</mat-icon> Zones
              </button>
              <button type="button" class="ce-icon-btn sm" matTooltip="Edit / test" aria-label="Edit camera" (click)="edit(c)" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
              <button type="button" class="ce-icon-btn sm" matTooltip="Delete" aria-label="Delete camera" (click)="remove(c)" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
            </span>
          </ng-template>
        </ce-table>

        @if (selectedCamera(); as cam) {
          <ce-card [title]="'Zones · ' + cam.name" subtitle="Draw door lines, sections, queues, staff-only areas and shelves on the camera view" icon="polyline">
            <ce-zone-editor [camera]="cam" [storeId]="storeId()" />
          </ce-card>
        }
      }
    </div>

    <ce-entity-drawer
      [(open)]="formOpen"
      entity="camera"
      [title]="editing() ? 'Edit camera' : 'New camera'"
      [subtitle]="editing() ? (source(editing()!) ?? 'Direct RTSP camera') : 'Add an IP camera by its RTSP address'"
      [fields]="fields()"
      [value]="formValue()"
      [submit]="submit"
      [submitLabel]="editing() ? 'Save changes' : 'Add camera'"
      (saved)="onSaved()"
      (closed)="stopTest()"
    >
      @if (editing(); as cam) {
        <div class="ops-drawer-section" data-testid="camera-test">
          <div class="ops-row" style="margin-bottom: 8px">
            <h3 class="ops-section-title" style="margin: 0">Connection test</h3>
            <span class="ops-spacer"></span>
            <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="test(cam)" [disabled]="testing()" data-testid="btn-test-camera">
              @if (testing()) {
                <mat-spinner diameter="14" />
              } @else {
                <mat-icon>network_check</mat-icon>
              }
              Test connection
            </button>
          </div>
          @if (probe(); as p) {
            <div class="ops-row" data-testid="camera-test-result" [attr.data-status]="p.status">
              <ce-pill [tone]="tone(p.status)" [label]="p.status === 'OK' ? 'Connected' : p.status === 'FAILED' ? 'Failed' : p.status === 'EXPIRED' ? 'No answer' : 'Testing…'" size="sm" />
              @if (p.status === 'OK') {
                <span class="caption">{{ res(p) ?? '--' }}{{ p.fps ? ' · ' + p.fps + ' fps' : '' }}{{ p.codec ? ' · ' + p.codec : '' }}</span>
              }
            </div>
            @if (p.status === 'OK' && p.snapshotUrl) {
              <img class="ops-thumb" style="width: 100%; margin-top: 10px; cursor: default" [src]="p.snapshotUrl" alt="Test snapshot" data-testid="camera-test-snapshot" />
            }
            @if (p.status === 'FAILED' || p.status === 'EXPIRED') {
              <ce-info-banner tone="danger" style="margin-top: 10px">{{ fix(p, cam) }}</ce-info-banner>
            }
          } @else if (testError()) {
            <ce-info-banner tone="warning" data-testid="camera-test-unavailable">{{ testError() }}</ce-info-banner>
          } @else {
            <p class="ops-help" style="margin: 0">The store's AI box opens the stream on the store network and reports resolution, frame rate and a snapshot.</p>
          }
        </div>
      }
    </ce-entity-drawer>
  `,
})
export class StoreCamerasComponent {
  protected readonly opsCss = useOpsStyles();
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly rec = inject(RecorderApi);
  readonly storeId = input.required<number>();
  readonly cameras = input<AdminCamera[] | undefined>(undefined);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly recorders = input<Recorder[]>([]);
  readonly reload = output<void>();

  readonly selected = signal<number | null>(null);
  readonly formOpen = signal(false);
  readonly editing = signal<AdminCamera | null>(null);
  readonly testing = signal(false);
  readonly probe = signal<Probe | null>(null);
  readonly testError = signal<string | null>(null);
  private testSub: Subscription | null = null;

  readonly rowId = (c: Camera) => `row-camera-${c.id}`;
  readonly rowClass = (c: Camera) => (this.selectedCamera()?.id === c.id ? 'selected' : c.isActive ? null : 'ops-dim');
  readonly selectedCamera = computed<AdminCamera | null>(() => {
    const list = this.cameras() ?? [];
    const sel = this.selected();
    return (sel !== null && list.find((c) => c.id === sel)) || list[0] || null;
  });
  readonly subtitle = computed(() => {
    const list = this.cameras() ?? [];
    const on = list.filter((c) => c.status === 'ONLINE').length;
    return list.length ? `${on} of ${list.length} online · select a camera to edit its zones` : null;
  });

  readonly cols: CeColumn<AdminCamera>[] = [
    { key: 'name', header: 'Camera', sortable: true, locked: true },
    { key: 'type', header: 'Type', format: (v) => humanize(String(v ?? '')), sortable: true },
    { key: 'status', header: 'Status', sortable: true },
    { key: 'lastHeartbeatAt', header: 'Last heartbeat', sortable: true },
    { key: 'fps', header: 'FPS', type: 'number', format: (v) => (typeof v === 'number' && v > 0 ? String(v) : null) },
    { key: 'actions', header: 'Action', type: 'actions', value: () => '', align: 'right', locked: true },
  ];

  readonly fields = computed<AdminField[]>(() => {
    const linked = !!this.editing()?.recorderId;
    return [
      { key: 'name', label: 'Camera name', type: 'text', required: true, placeholder: 'Entrance A', full: true },
      { key: 'type', label: 'Type', type: 'select', required: true, options: enumOptions(CAMERA_TYPES, humanize), default: 'ZONE', helper: 'Entrance cameras count footfall' },
      { key: 'isActive', label: 'Active', type: 'checkbox', default: true },
      ...(linked
        ? []
        : ([
            {
              key: 'rtspUrl',
              label: 'RTSP URL',
              type: 'text',
              required: true,
              full: true,
              placeholder: 'rtsp://user:pass@10.0.0.10:554/stream1',
              hint: 'Ask the installer for the stream address, or add the DVR under Recorders',
              validate: (v: unknown) => (RTSP.test(String(v ?? '').trim()) ? null : 'Must start with rtsp:// and contain no spaces'),
            },
          ] as AdminField[])),
    ];
  });
  readonly formValue = computed(() => {
    const c = this.editing();
    return c ? { ...c } : null;
  });

  readonly submit = (v: Record<string, unknown>) => {
    const c = this.editing();
    return c ? this.api.patch(`/cameras/${c.id}`, v, silent()) : this.api.post('/cameras', { ...v, storeId: this.storeId() }, null, silent());
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.testSub?.unsubscribe());
  }

  mask(u: string): string {
    return maskRtsp(u);
  }
  tone(s: Probe['status']) {
    return probeTone(s);
  }
  res(p: Probe) {
    return resolutionLabel(p.width, p.height);
  }

  /** "DVR ch 3 · Main DVR" for a recorder-linked camera. */
  source(c: AdminCamera): string | null {
    if (!c.recorderId) return null;
    const r = this.recorders().find((x) => x.id === c.recorderId);
    const ch = channelLabel(r?.kind ?? 'DVR', c.channel);
    return [ch, r?.name, c.streamProfile === 'SUB' ? 'sub stream' : null].filter(Boolean).join(' · ');
  }

  fix(p: Probe, c: AdminCamera): string {
    const r = this.recorders().find((x) => x.id === c.recorderId);
    const host = r?.host ?? /@([^:/]+)/.exec(c.rtspUrl ?? '')?.[1] ?? null;
    const port = r?.rtspPort ?? /@[^:/]+:(\d+)/.exec(c.rtspUrl ?? '')?.[1] ?? null;
    return p.error && p.errorCode === 'OTHER' ? p.error : probeErrorMessage(p.errorCode, { host, port, channel: c.channel ?? p.channel, status: p.status });
  }

  select(c: Camera): void {
    this.selected.set(c.id);
  }

  edit(c: AdminCamera | null): void {
    this.stopTest();
    this.editing.set(c);
    this.formOpen.set(true);
  }

  onSaved(): void {
    this.ui.toast(this.editing() ? 'Camera updated' : 'Camera added');
    this.reload.emit();
  }

  stopTest(): void {
    this.testSub?.unsubscribe();
    this.testSub = null;
    this.testing.set(false);
    this.probe.set(null);
    this.testError.set(null);
  }

  test(c: AdminCamera): void {
    if (this.testing()) return;
    this.stopTest();
    this.testing.set(true);
    this.testSub = this.rec.testCamera(c.id).subscribe({
      next: (p) => {
        this.probe.set(p);
        this.testSub = this.rec.watch([p]).subscribe({
          next: ([x]) => {
            this.probe.set(x);
            if (isTerminal(x.status)) this.testing.set(false);
          },
          complete: () => this.testing.set(false),
        });
      },
      error: (e) => {
        this.testing.set(false);
        this.testError.set(httpStatus(e) === 404 ? 'Connection tests need a backend update (recorder support). The camera itself is saved and working.' : 'The test could not be started. Try again in a moment.');
      },
    });
  }

  remove(c: Camera): void {
    this.ui.confirm({ title: 'Delete camera?', message: `Delete "${c.name}" and its zones? Historic analytics remain.`, confirmText: 'Delete', danger: true }).subscribe(() =>
      this.api.delete(`/cameras/${c.id}`).subscribe(() => {
        this.ui.toast('Camera deleted');
        if (this.selected() === c.id) this.selected.set(null);
        this.reload.emit();
      }),
    );
  }
}
