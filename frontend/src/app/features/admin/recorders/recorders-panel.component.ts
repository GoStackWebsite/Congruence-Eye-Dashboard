import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin } from 'rxjs';
import { Camera, Recorder, RecorderBrandInfo } from '../../../core/models/api.models';
import { CeColumn, DS } from '../../../shared/ds';
import { DateTimePipe } from '../../../shared/pipes';
import { UiService } from '../../../shared/ui/ui.service';
import { useOpsStyles } from '../../../shared/ds/ops.styles';
import { AdminCamera } from '../store/cameras-panel.component';
import { RecorderChannelsComponent } from './channels-grid.component';
import { RecorderDrawerComponent } from './recorder-drawer.component';
import { RecorderApi } from './recorder.api';
import { DEFAULT_BRANDS, apiErrorText, httpStatus, recorderTone } from './recorder.helpers';

/** Setup guidance shown next to the recorders (contract v3). */
export const SETUP_GUIDE = [
  { icon: 'settings_input_antenna', title: 'Turn RTSP on', text: 'In the DVR menu: Network › Advanced › RTSP (or “Port”), enable it. The usual port is 554.' },
  { icon: 'movie', title: 'Use H.264', text: 'Set each channel’s video encoding to H.264. H.265 / H.265+ streams cannot be read by the store box.' },
  { icon: 'high_quality', title: '2 MP minimum', text: '1080p (2 MP) works for footfall and zones. Use 5 MP on entrance cameras for age and gender.' },
  { icon: 'door_front', title: 'Entrance angle', text: 'Mount the entrance camera above the door looking down at 30–45°, so faces and the door line are both visible.' },
  { icon: 'lan', title: 'Same network as the store PC', text: 'The recorder and the store’s AI box must be on the same LAN (e.g. 192.168.1.x) with no guest-Wi-Fi isolation.' },
];

type PanelState = 'loading' | 'missing' | 'error' | 'ready';

/**
 * Store › Recorders (contract v3 "UI"): recorders table (name, brand, kind, IP:port, channels, linked cameras,
 * status, last checked) with Add recorder, the channels grid of the selected recorder and the setup guidance.
 * A 404 from /api/recorders means the backend has no recorder support yet → explanatory empty state.
 */
@Component({
  selector: 'ce-store-recorders',
  imports: [MatIconModule, MatTooltipModule, ...DS, DateTimePipe, RecorderDrawerComponent, RecorderChannelsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="ops-grid-2-1 ops-rec-layout" data-testid="store-recorders" [attr.data-state]="state()">
      <div class="ops-stack">
        @switch (state()) {
          @case ('missing') {
            <ce-card>
              <ce-empty-state icon="dvr" title="Recorder support needs a backend update" message="DVR / NVR recorders and connection tests arrive with the next server update. Cameras can still be added one by one by RTSP address under Cameras." data-testid="recorders-missing">
                <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="load()" data-testid="btn-retry">Check again</button>
              </ce-empty-state>
            </ce-card>
          }
          @case ('error') {
            <ce-card>
              <ce-empty-state kind="error" [message]="error()">
                <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="load()" data-testid="btn-retry">Retry</button>
              </ce-empty-state>
            </ce-card>
          }
          @default {
            <ce-table
              [rows]="recorders()"
              [columns]="cols"
              [loading]="state() === 'loading'"
              title="Recorders"
              subtitle="DVRs and NVRs at this store; the store's AI box reads each channel over RTSP"
              testId="table-recorders"
              [rowTestId]="rowId"
              [rowClickable]="true"
              (rowClick)="selectedId.set($event.id)"
              [rowClass]="rowClass"
              [paginate]="false"
              emptyIcon="dvr"
              emptyTitle="No recorders yet"
              emptyMessage="Add the store's DVR or NVR to create cameras from its channels without typing stream addresses."
            >
              <button tableActions type="button" class="ce-btn ce-btn-primary" (click)="openForm(null)" [disabled]="!canManage()" data-testid="btn-add-recorder"><mat-icon>add</mat-icon> Add recorder</button>
              <ng-template ceCell="name" let-r>
                <div class="ops-user-text">
                  <span class="ops-strong ops-ellipsis" [title]="r.name">{{ r.name }}</span>
                  <span class="caption">{{ brandLabel(r.brand) }} · {{ r.kind }}</span>
                </div>
              </ng-template>
              <ng-template ceCell="address" let-r><span class="ops-mono">{{ r.host }}:{{ r.rtspPort }}</span></ng-template>
              <ng-template ceCell="status" let-r>
                <div class="ops-user-text" style="align-items: flex-start; gap: 2px">
                  <ce-pill [value]="r.status" [tone]="tone(r.status)" [label]="r.status === 'PARTIAL' ? 'Partial' : null" size="sm" data-testid="chip-recorder-status" />
                  <span class="caption" [title]="r.lastCheckedAt ? (r.lastCheckedAt | dt) : ''" data-testid="recorder-last-checked">{{ r.lastCheckedAt ? 'Checked ' + (r.lastCheckedAt | dt: 'relative') : 'Never checked' }}</span>
                </div>
              </ng-template>
              <ng-template ceCell="actions" let-r>
                <span class="ops-row-actions" (click)="$event.stopPropagation()">
                  <button type="button" class="ce-icon-btn sm" matTooltip="Channels" aria-label="Show channels" (click)="selectedId.set(r.id)" data-testid="btn-channels"><mat-icon>grid_view</mat-icon></button>
                  <button type="button" class="ce-icon-btn sm" matTooltip="Edit" aria-label="Edit recorder" (click)="openForm(r)" [disabled]="!canManage()" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
                  <button type="button" class="ce-icon-btn sm" matTooltip="Delete" aria-label="Delete recorder" (click)="remove(r)" [disabled]="!canManage()" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
                </span>
              </ng-template>
            </ce-table>
            @if (selected(); as r) {
              <ce-recorder-channels [recorder]="r" [cameras]="cameras()" (camerasChanged)="camerasChanged.emit($event); load()" (tested)="load(true)" />
            }
          }
        }
      </div>

      <ce-card title="Setup checklist" subtitle="Before adding a recorder" icon="checklist" data-testid="recorder-guide">
        <ul class="ops-guide">
          @for (g of guide; track g.title) {
            <li>
              <span class="ops-guide-ic" aria-hidden="true"><span class="material-symbols-outlined">{{ g.icon }}</span></span>
              <span><b>{{ g.title }}</b>{{ g.text }}</span>
            </li>
          }
        </ul>
      </ce-card>
    </div>

    <ce-recorder-drawer [(open)]="formOpen" [storeId]="storeId()" [recorder]="editing()" [brands]="brands()" (saved)="onSaved($event)" />
  `,
})
export class StoreRecordersComponent {
  protected readonly opsCss = useOpsStyles();
  private readonly api = inject(RecorderApi);
  private readonly ui = inject(UiService);
  readonly storeId = input.required<number>();
  readonly cameras = input<AdminCamera[]>([]);
  readonly canManage = input(true);
  readonly camerasChanged = output<Camera[]>();
  /** Emits the loaded list so the parent can label recorder-linked cameras. */
  readonly loaded = output<Recorder[]>();

  readonly guide = SETUP_GUIDE;
  readonly state = signal<PanelState>('loading');
  readonly error = signal<string | null>(null);
  readonly recorders = signal<Recorder[]>([]);
  readonly brands = signal<RecorderBrandInfo[]>(DEFAULT_BRANDS);
  readonly selectedId = signal<number | null>(null);
  readonly formOpen = signal(false);
  readonly editing = signal<Recorder | null>(null);
  readonly selected = computed(() => this.recorders().find((r) => r.id === this.selectedId()) ?? this.recorders()[0] ?? null);
  readonly rowId = (r: Recorder) => `row-recorder-${r.id}`;
  readonly rowClass = (r: Recorder) => (this.selected()?.id === r.id ? 'selected' : null);

  readonly cols: CeColumn<Recorder>[] = [
    // the table shares the row with the setup checklist: keep it narrow enough that the actions never get clipped
    { key: 'name', header: 'Recorder', sortable: true, locked: true, wrap: true },
    { key: 'address', header: 'IP : port', value: (r) => `${r.host}:${r.rtspPort}`, mobileLabel: 'Address' },
    { key: 'camerasLinked', header: 'Cameras', sub: 'added / ch.', type: 'number', align: 'left', format: (v, r) => `${v ?? 0} / ${r.channels}` },
    { key: 'status', header: 'Status', sortable: true },
    { key: 'actions', header: '', type: 'actions', value: () => '', align: 'right', locked: true, width: '112px' },
  ];

  constructor() {
    effect(() => {
      this.storeId();
      untracked(() => this.load());
    });
  }

  load(quiet = false): void {
    const sid = this.storeId();
    if (!quiet) this.state.set(this.recorders().length ? 'ready' : 'loading');
    forkJoin({ brands: this.api.brands(), list: this.api.list(sid) }).subscribe({
      next: ({ brands, list }) => {
        if (brands?.length) this.brands.set(brands);
        this.recorders.set(list);
        this.loaded.emit(list);
        this.state.set('ready');
      },
      error: (e) => {
        if (httpStatus(e) === 404) {
          this.recorders.set([]);
          this.loaded.emit([]);
          this.state.set('missing');
        } else if (!quiet || !this.recorders().length) {
          this.error.set(httpStatus(e) === 403 ? 'You do not have access to this store’s recorders.' : apiErrorText(e, 'Couldn’t load recorders.'));
          this.state.set('error');
        }
      },
    });
  }

  tone(s: Recorder['status']) {
    return recorderTone(s);
  }

  brandLabel(b: Recorder['brand']): string {
    return this.brands().find((x) => x.brand === b)?.label ?? b;
  }

  openForm(r: Recorder | null): void {
    this.editing.set(r);
    this.formOpen.set(true);
  }

  onSaved(r: Recorder): void {
    this.ui.toast(this.editing() ? 'Recorder saved' : 'Recorder added — select channels to test or add as cameras');
    this.selectedId.set(r?.id ?? null);
    this.load();
  }

  remove(r: Recorder): void {
    this.ui.confirm({ title: 'Delete recorder?', message: `Delete "${r.name}" (${r.host})? Its saved password is erased.`, confirmText: 'Delete', danger: true }).subscribe(() =>
      this.api.remove(r.id).subscribe({
        next: () => this.removed(r),
        error: (e) => {
          if (httpStatus(e) === 409) {
            this.ui
              .confirm({
                title: 'Cameras use this recorder',
                message: `${r.camerasLinked || 'Some'} camera(s) read their video from "${r.name}". Delete the recorder and unlink them? The cameras stay, without a stream address.`,
                confirmText: 'Delete and unlink',
                danger: true,
              })
              .subscribe(() => this.api.remove(r.id, true).subscribe({ next: () => this.removed(r), error: (e2) => this.ui.toast(apiErrorText(e2, 'Couldn’t delete the recorder')) }));
          } else this.ui.toast(httpStatus(e) === 404 ? 'Recorder support needs a backend update.' : apiErrorText(e, 'Couldn’t delete the recorder'));
        },
      }),
    );
  }

  private removed(r: Recorder): void {
    this.ui.toast('Recorder deleted');
    if (this.selectedId() === r.id) this.selectedId.set(null);
    this.load();
    this.camerasChanged.emit([]);
  }
}
