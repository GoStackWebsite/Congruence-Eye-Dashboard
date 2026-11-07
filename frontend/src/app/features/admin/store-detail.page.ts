import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { EdgeDevice, InfraHealth, Recorder, StoreDetail, ZoneType } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { formatNumber, humanize } from '../../core/utils/format';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { DateTimePipe, LocalTimesPipe } from '../../shared/pipes';
import { UiService } from '../../shared/ui/ui.service';
import { EntityDrawerComponent } from '../../shared/ds/entity-drawer.component';
import { useOpsStyles } from '../../shared/ds/ops.styles';
import { EdgeDeviceListComponent, deviceHealth } from './edge-devices.page';
import { RecorderApi } from './recorders/recorder.api';
import { StoreRecordersComponent } from './recorders/recorders-panel.component';
import { AdminCamera, StoreCamerasComponent } from './store/cameras-panel.component';
import { StaffListComponent } from './staff.page';
import { storeErrorMapper, storeFields } from './stores.page';
import { ZONE_COLORS, ZoneEditorComponent } from './zone-editor.component';

export const STORE_TABS = ['overview', 'cameras', 'zones', 'recorders', 'edge', 'staff'] as const;
export type StoreTab = (typeof STORE_TABS)[number];

interface ZoneRow {
  id: number;
  name: string;
  type: ZoneType;
  camera: string;
  isActive: boolean;
}

/**
 * Admin › Stores › <store>: one page per store with tabs Overview · Cameras · Zones · Recorders · Edge device · Staff.
 * `/admin/stores/:id/cameras` keeps its old URL and testid (`page-admin-cameras`).
 */
@Component({
  selector: 'ce-store-detail-page',
  imports: [FormsModule, RouterLink, MatIconModule, MatTooltipModule, MatSelectModule, ...DS, DateTimePipe, LocalTimesPipe, EntityDrawerComponent, StoreCamerasComponent, ZoneEditorComponent, StoreRecordersComponent, EdgeDeviceListComponent, StaffListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <section [attr.data-testid]="tab() === 'cameras' ? 'page-admin-cameras' : 'page-admin-store'" [attr.data-tab]="tab()">
      @let s = store.data();
      <ce-page [title]="s ? s.name : store.error() ? 'Store' : 'Loading store…'" [description]="description()">
        <ng-container pageBadge>
          @if (s) {
            <ce-pill [value]="s.isActive ? 'YES' : 'NO'" [label]="s.isActive ? 'Active' : 'Inactive'" size="sm" data-testid="store-status" />
          }
        </ng-container>
        <ng-container pageActions>
          <a class="ce-btn ce-btn-ghost" routerLink="/admin/stores" data-testid="btn-back"><mat-icon>arrow_back</mat-icon> All stores</a>
          @if (s) {
            <button type="button" class="ce-btn ce-btn-secondary" (click)="formOpen.set(true)" data-testid="btn-edit-store"><mat-icon>edit</mat-icon> Edit store</button>
          }
        </ng-container>
        <ce-tabs class="ops-scroll-tabs" pageTabs [tabs]="tabs()" [value]="tab()" (valueChange)="go($event)" label="Store sections" data-testid="store-tabs" />

        @if (store.error() && !s) {
          <ce-card>
            <ce-empty-state [kind]="notFound() ? 'no-data' : 'error'" [icon]="notFound() ? 'store' : null" [title]="notFound() ? 'Store not found' : null" [message]="notFound() ? 'It may have been removed, or you do not have access to it.' : store.error()">
              <a class="ce-btn ce-btn-secondary ce-btn-sm" routerLink="/admin/stores">All stores</a>
              @if (!notFound()) {
                <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="store.reload()" data-testid="btn-retry">Retry</button>
              }
            </ce-empty-state>
          </ce-card>
        } @else {
          @switch (tab()) {
            @case ('overview') {
              <div class="ops-stack" data-testid="store-overview">
                <ce-stat-strip label="Store health">
                  <ce-stat-tile variant="strip" id="store-cameras" label="Cameras online" [text]="camText()" [loading]="!cameras.data()" [link]="['/admin/stores', storeId(), 'cameras']" />
                  <ce-stat-tile variant="strip" id="store-zones" label="Active zones" [value]="activeZones()" [loading]="!s" [link]="['/admin/stores', storeId(), 'zones']" />
                  <ce-stat-tile variant="strip" id="store-recorders" label="Recorders" [text]="recordersMissing() ? '--' : null" [value]="recorders().length" [link]="['/admin/stores', storeId(), 'recorders']" />
                  <ce-stat-tile variant="strip" id="store-edge" label="AI box" [text]="edgeText()" [loading]="!edge.data()" [link]="['/admin/stores', storeId(), 'edge']" />
                  <ce-stat-tile variant="strip" id="store-uptime" label="Uptime (7 days)" format="pct" [value]="health()?.uptimePct7d" [loading]="healthLoading()" hint="Share of camera heartbeats received in the last 7 days" />
                </ce-stat-strip>
                <div class="ops-grid-2-1">
                  <ce-card title="Store details" icon="storefront">
                    @if (s) {
                      <dl class="ops-dl">
                        <dt>Code</dt>
                        <dd class="ops-mono">{{ s.code }}</dd>
                        <dt>Region</dt>
                        <dd>{{ s.regionName || '--' }}</dd>
                        <dt>Format</dt>
                        <dd>{{ s.format ? humanize(s.format) : '--' }}</dd>
                        <dt>Hours</dt>
                        <dd>{{ s.openTime }} – {{ s.closeTime }} <span class="caption">({{ s.timezone }})</span></dd>
                        <dt>Area</dt>
                        <dd>{{ s.areaSqft ? num(s.areaSqft) + ' sq ft' : '--' }}</dd>
                        <dt>Address</dt>
                        <dd>{{ s.address || '--' }}{{ s.city ? ', ' + s.city : '' }}</dd>
                        <dt>Location</dt>
                        <dd>
                          @if (s.latitude != null && s.longitude != null) {
                            <a class="ce-text-link" [href]="'https://www.google.com/maps?q=' + s.latitude + ',' + s.longitude" target="_blank" rel="noopener">{{ s.latitude }}, {{ s.longitude }}</a>
                          } @else {
                            --
                          }
                        </dd>
                        <dt>Created</dt>
                        <dd>{{ s.createdAt | dt: 'date' }}</dd>
                      </dl>
                    } @else {
                      <ce-skeleton kind="text" [count]="6" />
                    }
                  </ce-card>
                  <ce-card title="Open issues" icon="monitor_heart" [subtitle]="health() ? (health()!.openTickets ? health()!.openTickets + ' open infra ticket(s)' : 'No open infra tickets') : null">
                    <a cardActions class="ce-link-btn small" routerLink="/infra-health">Infra health</a>
                    @if (health(); as h) {
                      <ul class="ops-noc-issues" style="padding: 0" data-testid="store-issues">
                        @for (i of h.issues; track i) {
                          <li><span class="material-symbols-outlined" aria-hidden="true">warning</span>{{ i | localTimes }}</li>
                        } @empty {
                          <li class="none"><span class="material-symbols-outlined" aria-hidden="true">check_circle</span>Cameras and the AI box are reporting normally.</li>
                        }
                      </ul>
                    } @else {
                      <ce-skeleton kind="text" [count]="3" />
                    }
                  </ce-card>
                </div>
              </div>
            }
            @case ('cameras') {
              <ce-store-cameras [storeId]="storeId()" [cameras]="cameraRows()" [loading]="cameras.loading()" [error]="cameras.error()" [recorders]="recorders()" (reload)="cameras.reload()" />
            }
            @case ('zones') {
              <div class="ops-stack" data-testid="store-zones">
                @if (cameraRows()?.length) {
                  <ce-card [title]="'Zones · ' + (zoneCamera()?.name ?? '')" subtitle="Pick a camera, then draw its zones" icon="polyline">
                    <mat-select cardActions class="ops-chip-select is-set" [ngModel]="zoneCamera()?.id" (ngModelChange)="zoneCameraId.set($event)" aria-label="Camera" data-testid="select-zone-camera">
                      <mat-select-trigger><span class="ops-chip-label">Camera:</span>{{ zoneCamera()?.name ?? '' }}</mat-select-trigger>
                      @for (c of cameraRows(); track c.id) {
                        <mat-option [value]="c.id">{{ c.name }}</mat-option>
                      }
                    </mat-select>
                    @if (zoneCamera(); as cam) {
                      <ce-zone-editor [camera]="cam" [storeId]="storeId()" />
                    }
                  </ce-card>
                } @else if (cameras.data()) {
                  <ce-card>
                    <ce-empty-state icon="videocam_off" title="Add a camera first" message="Zones are drawn on a camera view.">
                      <a class="ce-btn ce-btn-primary ce-btn-sm" [routerLink]="['/admin/stores', storeId(), 'cameras']">Go to cameras</a>
                    </ce-empty-state>
                  </ce-card>
                } @else {
                  <ce-skeleton kind="chart" height="360px" />
                }
                <ce-table
                  [rows]="zoneRows()"
                  [columns]="zoneCols"
                  [loading]="!s"
                  title="All zones in this store"
                  testId="table-store-zones"
                  [rowTestId]="zoneRowId"
                  [pageSize]="10"
                  emptyIcon="polyline"
                  emptyTitle="No zones yet"
                  emptyMessage="Draw door lines, sections and queues on each camera."
                >
                  <ng-template ceCell="type" let-z>
                    <span class="ops-row" style="flex-wrap: nowrap; gap: 6px"><span class="ops-layer-swatch" [style.background]="zoneColor(z.type)"></span>{{ humanize(z.type) }}</span>
                  </ng-template>
                  <ng-template ceCell="isActive" let-z>
                    <ce-pill [value]="z.isActive ? 'ACTIVE' : 'INACTIVE'" size="sm" />
                  </ng-template>
                </ce-table>
              </div>
            }
            @case ('recorders') {
              <ce-store-recorders [storeId]="storeId()" [cameras]="cameraRows() ?? []" (loaded)="recorders.set($event)" (camerasChanged)="cameras.reload()" />
            }
            @case ('edge') {
              <ce-edge-device-list [fixedStoreId]="storeId()" />
            }
            @case ('staff') {
              <ce-staff-list [fixedStoreId]="storeId()" />
            }
          }
        }
      </ce-page>

      <ce-entity-drawer
        [(open)]="formOpen"
        entity="store"
        title="Edit store"
        [subtitle]="s ? s.code + ' · ' + s.name : null"
        [fields]="fields"
        [value]="s"
        [submit]="submit"
        [mapServerError]="mapError"
        submitLabel="Save changes"
        (saved)="onSaved()"
      />
    </section>
  `,
})
export class StoreDetailPage {
  protected readonly opsCss = useOpsStyles();
  private readonly api = inject(ApiService);
  private readonly v2 = inject(V2Api);
  private readonly rec = inject(RecorderApi);
  private readonly router = inject(Router);
  private readonly ui = inject(UiService);
  private readonly lookup = inject(LookupService);
  readonly id = input.required<string>();
  /** Route param (absent on /admin/stores/:id). */
  readonly section = input<string | undefined>(undefined, { alias: 'tab' });
  readonly storeId = computed(() => Number(this.id()));
  readonly tab = computed<StoreTab>(() => {
    const t = this.section() as StoreTab | undefined;
    return t && (STORE_TABS as readonly string[]).includes(t) ? t : 'overview';
  });

  readonly store = loadOn(() => this.storeId(), (id) => this.api.get<StoreDetail>(`/stores/${id}`));
  readonly cameras = loadOn(() => this.storeId(), (id) => this.api.get<AdminCamera[]>('/cameras', { storeId: id }));
  readonly edge = loadOn(() => this.storeId(), (id) => this.api.get<EdgeDevice[]>('/edge-devices', { storeId: id }, silent()).pipe(catchError(() => of([] as EdgeDevice[]))));
  private readonly infra = loadOn(() => this.storeId(), (id) => this.v2.infraHealth([id]).pipe(catchError(() => of(null as InfraHealth | null))));
  readonly recorders = signal<Recorder[]>([]);
  readonly recordersMissing = signal(false);
  readonly zoneCameraId = signal<number | null>(null);
  readonly formOpen = signal(false);
  readonly fields = storeFields(this.lookup);
  readonly mapError = storeErrorMapper;
  readonly humanize = humanize;
  readonly num = formatNumber;

  readonly notFound = computed(() => /not found|404/i.test(this.store.error() ?? ''));
  readonly cameraRows = computed(() => this.cameras.data());
  readonly health = computed(() => this.infra.data()?.stores.find((x) => x.storeId === this.storeId()) ?? null);
  readonly healthLoading = computed(() => this.infra.loading() && !this.infra.data());
  readonly description = computed(() => {
    const s = this.store.data();
    if (!s) return null;
    return [s.code, s.regionName, s.format ? humanize(s.format) : null, `${s.openTime} – ${s.closeTime}`].filter(Boolean).join(' · ');
  });
  readonly camText = computed(() => {
    const c = this.cameras.data();
    if (!c) return null;
    const active = c.filter((x) => x.isActive);
    return `${active.filter((x) => x.status === 'ONLINE').length} / ${active.length}`;
  });
  readonly activeZones = computed(() => (this.store.data()?.zones ?? []).filter((z) => z.isActive).length);
  readonly edgeText = computed(() => {
    const d = this.edge.data();
    if (!d) return null;
    if (!d.length) return 'Not set up';
    const h = d.map((x) => deviceHealth(x));
    return h.includes('ONLINE') ? 'Online' : h.includes('OFFLINE') ? 'Offline' : 'Never seen';
  });
  readonly tabs = computed<TabItem[]>(() => {
    const cams = this.cameras.data();
    const zones = this.store.data()?.zones?.filter((z) => z.isActive);
    return [
      { value: 'overview', label: 'Overview', testId: 'tab-store-overview' },
      { value: 'cameras', label: 'Cameras', count: cams ? cams.length : null, testId: 'tab-store-cameras' },
      { value: 'zones', label: 'Zones', count: zones ? zones.length : null, testId: 'tab-store-zones' },
      { value: 'recorders', label: 'Recorders', count: this.recordersMissing() ? null : this.recorders().length, testId: 'tab-store-recorders' },
      { value: 'edge', label: 'Edge device', testId: 'tab-store-edge' },
      { value: 'staff', label: 'Staff', testId: 'tab-store-staff' },
    ];
  });
  readonly zoneCamera = computed<AdminCamera | null>(() => {
    const list = this.cameraRows() ?? [];
    return list.find((c) => c.id === this.zoneCameraId()) ?? list[0] ?? null;
  });
  readonly zoneRows = computed<ZoneRow[]>(() => {
    const s = this.store.data();
    const cams = new Map((this.cameraRows() ?? s?.cameras ?? []).map((c) => [c.id, c.name]));
    return (s?.zones ?? []).map((z) => ({ id: z.id, name: z.name, type: z.type, camera: cams.get(z.cameraId) ?? `#${z.cameraId}`, isActive: z.isActive }));
  });
  readonly zoneRowId = (z: ZoneRow) => `row-store-zone-${z.id}`;
  readonly zoneCols: CeColumn<ZoneRow>[] = [
    { key: 'name', header: 'Zone', sortable: true },
    { key: 'type', header: 'Type', sortable: true },
    { key: 'camera', header: 'Camera', sortable: true },
    { key: 'isActive', header: 'Status', value: (z) => (z.isActive ? 'Active' : 'Inactive'), sortable: true },
  ];

  readonly submit = (v: Record<string, unknown>) => this.api.patch(`/stores/${this.storeId()}`, v, silent());

  constructor() {
    this.lookup.loadRegions();
    // recorders label recorder-linked cameras ("DVR ch 3") on every tab; a 404 means no recorder backend yet
    effect((onCleanup) => {
      const id = this.storeId();
      const sub = this.rec.list(id).subscribe({
        next: (r) => {
          this.recorders.set(r);
          this.recordersMissing.set(false);
        },
        error: () => this.recordersMissing.set(true),
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  zoneColor(t: ZoneType): string {
    return ZONE_COLORS[t];
  }

  go(t: string): void {
    void this.router.navigate(t === 'overview' ? ['/admin/stores', this.storeId()] : ['/admin/stores', this.storeId(), t]);
  }

  onSaved(): void {
    this.ui.toast('Saved');
    this.store.reload();
    this.lookup.loadStores(true).subscribe();
  }
}
