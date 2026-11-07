import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import { Camera, CameraType, Probe, Recorder } from '../../../core/models/api.models';
import { humanize } from '../../../core/utils/format';
import { DS } from '../../../shared/ds';
import { DateTimePipe } from '../../../shared/pipes';
import { UiService } from '../../../shared/ui/ui.service';
import { useOpsStyles } from '../../../shared/ds/ops.styles';
import { AdminCamera } from '../store/cameras-panel.component';
import { RecorderApi } from './recorder.api';
import { apiErrorText, channelLabel, httpStatus, isTerminal, probeErrorMessage, probeTone, resolutionLabel } from './recorder.helpers';

export interface ChannelCell {
  channel: number;
  camera: AdminCamera | null;
  probe: Probe | null;
}

/** One card per recorder channel with its linked camera and latest test; newest probe per channel wins. */
export function channelCells(channels: number, recorderId: number, cameras: AdminCamera[], probes: Probe[]): ChannelCell[] {
  const latest = new Map<number, Probe>();
  for (const p of probes) {
    if (p.recorderId !== recorderId || !p.channel) continue;
    const cur = latest.get(p.channel);
    if (!cur || p.requestedAt > cur.requestedAt || (p.requestedAt === cur.requestedAt && p.id > cur.id)) latest.set(p.channel, p);
  }
  return Array.from({ length: Math.max(0, Math.min(64, channels)) }, (_, i) => {
    const ch = i + 1;
    return { channel: ch, camera: cameras.find((c) => c.recorderId === recorderId && c.channel === ch) ?? null, probe: latest.get(ch) ?? null };
  });
}

const TYPES: CameraType[] = ['ZONE', 'ENTRANCE', 'BILLING', 'GENERAL'];

/**
 * Recorder channels grid (contract v3): select channels, "Add as cameras" (type + name prefix) and "Test selected".
 * Tests poll GET /api/probes/:id every second (60 s cap) with a spinner per card, then show resolution, fps and a
 * snapshot, or the plain-language fix.
 */
@Component({
  selector: 'ce-recorder-channels',
  imports: [FormsModule, MatCheckboxModule, MatIconModule, MatTooltipModule, MatMenuModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule, ...DS, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <ce-card [title]="recorder().name + ' · channels'" [subtitle]="subtitle()" icon="grid_view" data-testid="recorder-channels">
      <div cardActions class="ops-row">
        <button type="button" class="ce-btn ce-btn-ghost ce-btn-sm" (click)="toggleAll()" data-testid="btn-select-all-channels">{{ allSelected() ? 'Clear selection' : 'Select all' }}</button>
        <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" [disabled]="!selected().size || testing()" (click)="test()" data-testid="btn-test-selected">
          @if (testing()) {
            <mat-spinner diameter="14" />
          } @else {
            <mat-icon>network_check</mat-icon>
          }
          Test selected
        </button>
        <button type="button" class="ce-btn ce-btn-primary ce-btn-sm" [disabled]="!addable().length || adding()" [matMenuTriggerFor]="addMenu" #addTrigger="matMenuTrigger" data-testid="btn-add-as-cameras">
          <mat-icon>add_a_photo</mat-icon> Add as cameras{{ addable().length ? ' (' + addable().length + ')' : '' }}
        </button>
        <mat-menu #addMenu="matMenu" xPosition="before" class="ops-add-menu">
          <div class="ops-stack" style="gap: 10px; padding: 12px 16px; width: 280px" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <div class="ops-strong">Create {{ addable().length }} camera(s)</div>
            <div class="ops-field">
              <label class="ce-field-label" for="ch-type">Camera type</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <mat-select id="ch-type" [(ngModel)]="newType" data-testid="input-channels-type">
                  @for (t of types; track t) {
                    <mat-option [value]="t">{{ label(t) }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            <div class="ops-field">
              <label class="ce-field-label" for="ch-prefix">Name prefix</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <input id="ch-prefix" matInput [(ngModel)]="prefix" maxlength="40" data-testid="input-channels-prefix" />
              </mat-form-field>
              <div class="caption">Cameras are named “{{ prefix || 'Camera' }} 1”, “{{ prefix || 'Camera' }} 2” … — rename them later.</div>
            </div>
            <button type="button" class="ce-btn ce-btn-primary" (click)="addCameras()" [disabled]="adding()" data-testid="btn-confirm-add-cameras">Create cameras</button>
          </div>
        </mat-menu>
      </div>

      @if (probeError()) {
        <ce-info-banner tone="warning" style="margin-bottom: 12px" data-testid="channels-error">{{ probeError() }}</ce-info-banner>
      }
      <div class="ops-channels" data-testid="channel-grid">
        @for (c of cells(); track c.channel) {
          <div
            class="ops-ch"
            [class.selected]="selected().has(c.channel)"
            [class.ok]="c.probe?.status === 'OK'"
            [class.failed]="c.probe?.status === 'FAILED'"
            [attr.data-testid]="'channel-' + c.channel"
            [attr.data-status]="c.probe?.status ?? 'NONE'"
          >
            <div class="ops-ch-media">
              @if (c.probe?.status === 'OK' && c.probe?.snapshotUrl) {
                <img [src]="c.probe!.snapshotUrl" [alt]="'Channel ' + c.channel + ' snapshot'" loading="lazy" data-testid="channel-snapshot" />
              } @else {
                <div class="ops-media-empty">
                  @if (running(c)) {
                    <mat-spinner diameter="22" />
                  } @else {
                    <span class="material-symbols-outlined" aria-hidden="true">{{ c.probe?.status === 'FAILED' ? 'videocam_off' : 'videocam' }}</span>
                  }
                </div>
              }
              <span class="ops-ch-num">{{ chLabel(c.channel) }}</span>
              <button type="button" class="ops-ch-sel" role="checkbox" [attr.aria-checked]="selected().has(c.channel)" (click)="toggle(c.channel)" [attr.aria-label]="'Select channel ' + c.channel" data-testid="channel-select">
                <span class="material-symbols-outlined" aria-hidden="true">{{ selected().has(c.channel) ? 'check_box' : 'check_box_outline_blank' }}</span>
              </button>
            </div>
            <div class="ops-ch-body">
              @if (c.camera) {
                <span class="ops-ch-name ops-ellipsis" [title]="c.camera.name" data-testid="channel-camera">{{ c.camera.name }}</span>
              } @else {
                <span class="ops-ch-name none" data-testid="channel-camera">Not added</span>
              }
              @if (running(c)) {
                <span class="ops-ch-running" data-testid="channel-running"><mat-spinner diameter="12" /> Testing…</span>
              } @else if (c.probe; as p) {
                <span class="ops-row" style="gap: 6px; flex-wrap: nowrap">
                  <ce-pill [tone]="tone(p.status)" [label]="p.status === 'OK' ? 'OK' : p.status === 'FAILED' ? 'Failed' : 'No answer'" size="sm" data-testid="channel-status" />
                  @if (p.completedAt) {
                    <span class="caption">{{ p.completedAt | dt: 'relative' }}</span>
                  }
                </span>
                @if (p.status === 'OK') {
                  <span class="ops-ch-result" data-testid="channel-result">{{ res(p) ?? 'Stream OK' }}{{ p.fps ? ' · ' + p.fps + ' fps' : '' }}</span>
                } @else {
                  <span class="ops-ch-result err" data-testid="channel-error">{{ fix(p) }}</span>
                }
              } @else {
                <span class="ops-ch-result ops-muted">Not tested</span>
              }
            </div>
          </div>
        }
      </div>
    </ce-card>
  `,
})
export class RecorderChannelsComponent {
  protected readonly opsCss = useOpsStyles();
  private readonly api = inject(RecorderApi);
  private readonly ui = inject(UiService);
  readonly recorder = input.required<Recorder>();
  readonly cameras = input<AdminCamera[]>([]);
  readonly camerasChanged = output<Camera[]>();
  readonly tested = output<void>();

  readonly types = TYPES;
  readonly probes = signal<Probe[]>([]);
  readonly selected = signal<Set<number>>(new Set());
  readonly testing = signal(false);
  readonly adding = signal(false);
  readonly probeError = signal<string | null>(null);
  newType: CameraType = 'ZONE';
  prefix = '';
  private sub: Subscription | null = null;

  readonly cells = computed(() => channelCells(this.recorder().channels, this.recorder().id, this.cameras(), this.probes()));
  readonly allSelected = computed(() => this.selected().size === this.recorder().channels && this.recorder().channels > 0);
  readonly addable = computed(() => this.cells().filter((c) => this.selected().has(c.channel) && !c.camera).map((c) => c.channel));
  readonly subtitle = computed(() => {
    const cells = this.cells();
    const linked = cells.filter((c) => c.camera).length;
    const ok = cells.filter((c) => c.probe?.status === 'OK').length;
    return `${cells.length} channels · ${linked} added as cameras · ${ok} passed the last test`;
  });

  constructor() {
    effect(() => {
      const r = this.recorder();
      untracked(() => {
        this.sub?.unsubscribe();
        this.selected.set(new Set());
        this.testing.set(false);
        this.probeError.set(null);
        this.prefix = 'Camera';
        this.api.probes({ recorderId: r.id }).subscribe({ next: (p) => this.probes.set(p), error: () => this.probes.set([]) });
      });
    });
    inject(DestroyRef).onDestroy(() => this.sub?.unsubscribe());
  }

  label(t: string): string {
    return humanize(t);
  }
  chLabel(ch: number): string {
    return channelLabel(this.recorder().kind, ch) ?? `ch ${ch}`;
  }
  tone(s: Probe['status']) {
    return probeTone(s);
  }
  res(p: Probe) {
    return resolutionLabel(p.width, p.height);
  }
  running(c: ChannelCell): boolean {
    return !!c.probe && !isTerminal(c.probe.status);
  }
  fix(p: Probe): string {
    const r = this.recorder();
    return probeErrorMessage(p.errorCode, { host: r.host, port: r.rtspPort, channel: p.channel, status: p.status });
  }

  toggle(ch: number): void {
    const s = new Set(this.selected());
    if (s.has(ch)) s.delete(ch);
    else s.add(ch);
    this.selected.set(s);
  }

  toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.cells().map((c) => c.channel)));
  }

  test(): void {
    if (this.testing()) return;
    const channels = [...this.selected()].sort((a, b) => a - b);
    this.testing.set(true);
    this.probeError.set(null);
    this.sub?.unsubscribe();
    this.sub = this.api.test(this.recorder().id, channels).subscribe({
      next: (started) => {
        this.merge(started);
        this.sub = this.api.watch(started).subscribe({
          next: (list) => this.merge(list),
          complete: () => {
            this.testing.set(false);
            this.tested.emit();
          },
        });
      },
      error: (e) => {
        this.testing.set(false);
        this.probeError.set(httpStatus(e) === 404 ? 'Recorder support needs a backend update.' : apiErrorText(e, 'The test could not be started.'));
      },
    });
  }

  private merge(list: Probe[]): void {
    const ids = new Set(list.map((p) => p.id));
    this.probes.update((cur) => [...cur.filter((p) => !ids.has(p.id)), ...list]);
  }

  private readonly addTrigger = viewChild<MatMenuTrigger>('addTrigger');

  addCameras(): void {
    const channels = this.addable();
    if (!channels.length || this.adding()) return;
    this.adding.set(true);
    this.api.generateCameras(this.recorder().id, { channels, type: this.newType, namePrefix: this.prefix.trim() || undefined }).subscribe({
      next: (cams) => {
        this.adding.set(false);
        this.addTrigger()?.closeMenu(); // the form lives in the menu: close it once the cameras exist
        this.selected.set(new Set());
        this.ui.toast(`${cams.length} camera(s) added`);
        this.camerasChanged.emit(cams);
      },
      error: (e) => {
        this.adding.set(false);
        this.probeError.set(httpStatus(e) === 404 ? 'Recorder support needs a backend update.' : apiErrorText(e, 'Cameras could not be created.'));
      },
    });
  }
}
