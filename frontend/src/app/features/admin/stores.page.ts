import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { STORE_FORMATS, Store } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { formatNumber, humanize } from '../../core/utils/format';
import { enumOptions } from '../../shared/crud/field';
import { CeColumn, DS } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { AdminField, EntityDrawerComponent, ServerErrorMapper } from '../../shared/ds/entity-drawer.component';
import { useOpsStyles } from '../../shared/ds/ops.styles';

/** Store master form (shared by the list and the store detail page). */
export function storeFields(lookup: LookupService): AdminField[] {
  return [
    { key: 'code', label: 'Store code', type: 'text', required: true, placeholder: 'CNG-TNR', group: 'Identity', validate: (v) => (/^[A-Za-z0-9_.-]{2,30}$/.test(String(v ?? '').trim()) ? null : 'Use 2–30 letters, digits, dots or dashes') },
    { key: 'name', label: 'Store name', type: 'text', required: true, placeholder: 'Congruence T Nagar' },
    { key: 'regionId', label: 'Region', type: 'select', required: true, options: () => lookup.regions().map((r) => ({ value: r.id, label: r.name })) },
    { key: 'format', label: 'Store format', type: 'select', required: true, options: enumOptions(STORE_FORMATS, humanize), default: 'HIGH_STREET' },
    { key: 'city', label: 'City', type: 'text', required: true, default: 'Chennai', group: 'Location' },
    { key: 'timezone', label: 'Timezone', type: 'text', required: true, default: 'Asia/Kolkata' },
    { key: 'address', label: 'Address', type: 'textarea', full: true },
    { key: 'latitude', label: 'Latitude', type: 'number', min: -90, max: 90, placeholder: '13.0418' },
    { key: 'longitude', label: 'Longitude', type: 'number', min: -180, max: 180, placeholder: '80.2341' },
    { key: 'openTime', label: 'Opens (HH:mm)', type: 'time', required: true, default: '10:00', group: 'Operations' },
    {
      key: 'closeTime',
      label: 'Closes (HH:mm)',
      type: 'time',
      required: true,
      default: '22:00',
      validate: (v, all) => (String(v ?? '') <= String(all['openTime'] ?? '') ? 'Closing time must be after opening time' : null),
    },
    { key: 'areaSqft', label: 'Area (sq ft)', type: 'number', required: true, min: 1, placeholder: '4200' },
    { key: 'isActive', label: 'Active — include in analytics, alerts and checklists', type: 'checkbox', default: true },
  ];
}

export const storeErrorMapper: ServerErrorMapper = (status, msg) =>
  status === 409 || /code/i.test(msg) ? { field: 'code', message: /exist|duplicate|unique|taken/i.test(msg) || status === 409 ? 'Another store already uses this code' : msg } : null;

/** Admin › Stores: store master list (management-list pattern) → store detail page with tabs. */
@Component({
  selector: 'ce-stores-page',
  imports: [RouterLink, MatIconModule, MatTooltipModule, ...DS, EntityDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <section data-testid="page-admin-stores">
      <ce-page title="Stores" description="Store master: hours, format, area and location. Open a store to manage its cameras, zones, recorders and edge box.">
        <ng-container pageActions>
          <button type="button" class="ce-btn ce-btn-primary" (click)="openForm(null)" data-testid="btn-create-store"><mat-icon>add</mat-icon> New store</button>
        </ng-container>
        <ce-stat-strip label="Store summary">
          <ce-stat-tile variant="strip" id="stores-total" label="Stores" [value]="all().length" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="stores-active" label="Active" [value]="active()" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="stores-inactive" label="Inactive" [value]="all().length - active()" [loading]="busy()" />
          <span class="ce-stat-strip-sep" aria-hidden="true"></span>
          <ce-stat-tile variant="strip" id="stores-regions" label="Regions" [value]="regions()" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="stores-area" label="Total area (sq ft)" [value]="area()" [loading]="busy()" />
        </ce-stat-strip>

        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        } @else {
          <ce-table
            [rows]="all()"
            [columns]="cols"
            [loading]="busy()"
            title="Store list"
            subtitle="Inactive stores are kept for history"
            [searchable]="true"
            searchPlaceholder="Search by code, name or city"
            searchTestId="input-search"
            [columnChooser]="true"
            testId="table-admin-stores"
            [rowTestId]="rowId"
            [rowClickable]="true"
            (rowClick)="open($event)"
            [rowClass]="rowClass"
            [defaultSort]="{ key: 'code', dir: 'asc' }"
            sortStart="asc"
            emptyIcon="storefront"
            emptyTitle="No stores yet"
            emptyMessage="Add your first store to start connecting cameras."
          >
            <button tableActions type="button" class="ce-btn ce-btn-secondary ce-icon-btn" (click)="data.reload()" matTooltip="Refresh" aria-label="Refresh" data-testid="btn-refresh"><mat-icon>refresh</mat-icon></button>
            <ng-template ceCell="name" let-r>
              <a class="ce-text-link ops-ellipsis" [routerLink]="['/admin/stores', r.id]" (click)="$event.stopPropagation()" [title]="r.name">{{ r.name }}</a>
            </ng-template>
            <ng-template ceCell="isActive" let-r>
              <ce-pill [value]="r.isActive ? 'YES' : 'NO'" [label]="r.isActive ? 'Active' : 'Inactive'" size="sm" />
            </ng-template>
            <ng-template ceCell="actions" let-r>
              <span class="ops-row-actions" (click)="$event.stopPropagation()">
                <button type="button" class="ce-icon-btn sm" matTooltip="Cameras & zones" aria-label="Cameras and zones" (click)="cameras(r)" data-testid="btn-cameras"><mat-icon>videocam</mat-icon></button>
                <button type="button" class="ce-icon-btn sm" matTooltip="Edit" aria-label="Edit store" (click)="openForm(r)" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
                <button type="button" class="ce-icon-btn sm" [matTooltip]="r.isActive ? 'Deactivate' : 'Already inactive'" aria-label="Deactivate store" [disabled]="!r.isActive" (click)="remove(r)" data-testid="btn-delete"><mat-icon>block</mat-icon></button>
              </span>
            </ng-template>
          </ce-table>
        }
      </ce-page>

      <ce-entity-drawer
        [(open)]="formOpen"
        entity="store"
        [title]="editing() ? 'Edit store' : 'New store'"
        [subtitle]="editing() ? editing()!.code + ' · ' + editing()!.name : 'Hours drive open / close detection and analytics'"
        [fields]="fields"
        [value]="editing()"
        [submit]="submit"
        [mapServerError]="mapError"
        [submitLabel]="editing() ? 'Save changes' : 'Create store'"
        (saved)="onSaved()"
      />
    </section>
  `,
})
export class StoresPage {
  protected readonly opsCss = useOpsStyles();
  private readonly router = inject(Router);
  private readonly lookup = inject(LookupService);
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);

  readonly data = loadOn(() => ({}), () => this.api.get<Store[]>('/stores'));
  readonly all = computed(() => this.data.data() ?? []);
  readonly busy = computed(() => this.data.loading() && !this.data.data());
  readonly active = computed(() => this.all().filter((s) => s.isActive).length);
  readonly regions = computed(() => new Set(this.all().map((s) => s.regionId)).size);
  readonly area = computed(() => this.all().filter((s) => s.isActive).reduce((a, s) => a + (s.areaSqft || 0), 0));
  readonly formOpen = signal(false);
  readonly editing = signal<Store | null>(null);
  readonly fields = storeFields(this.lookup);
  readonly mapError = storeErrorMapper;
  readonly rowId = (s: Store) => `row-store-${s.id}`;
  readonly rowClass = (s: Store) => (s.isActive ? null : 'ops-dim');

  readonly cols: CeColumn<Store>[] = [
    { key: 'code', header: 'Code', sortable: true, locked: true, cellClass: () => 'ops-mono' },
    { key: 'name', header: 'Store name', sortable: true, locked: true },
    { key: 'regionName', header: 'Region', sortable: true },
    { key: 'city', header: 'City', sortable: true },
    { key: 'format', header: 'Format', format: (v) => (v ? humanize(String(v)) : null), sortable: true },
    { key: 'hours', header: 'Hours', value: (s) => `${s.openTime} – ${s.closeTime}`, searchable: false },
    { key: 'areaSqft', header: 'Area (sq ft)', type: 'number', sortable: true, format: (v) => (typeof v === 'number' && v > 0 ? formatNumber(v) : null) },
    { key: 'isActive', header: 'Status', value: (s) => (s.isActive ? 'Active' : 'Inactive'), sortable: true },
    { key: 'actions', header: 'Action', type: 'actions', value: () => '', align: 'right', locked: true },
  ];

  readonly submit = (v: Record<string, unknown>) => {
    const s = this.editing();
    return s ? this.api.patch(`/stores/${s.id}`, v, silent()) : this.api.post('/stores', v, null, silent());
  };

  constructor() {
    this.lookup.loadRegions();
  }

  open(s: Store): void {
    void this.router.navigate(['/admin/stores', s.id]);
  }

  cameras(s: Store): void {
    void this.router.navigate(['/admin/stores', s.id, 'cameras']);
  }

  openForm(s: Store | null): void {
    this.editing.set(s);
    this.formOpen.set(true);
  }

  onSaved(): void {
    this.ui.toast(this.editing() ? 'Saved' : 'Created');
    this.data.reload();
    this.lookup.loadStores(true).subscribe();
  }

  remove(s: Store): void {
    this.ui
      .confirm({ title: 'Deactivate store?', message: `Deactivate "${s.name}"? Its history stays, but it leaves analytics filters, alerts and checklists.`, confirmText: 'Deactivate', danger: true })
      .subscribe(() =>
        this.api.delete(`/stores/${s.id}`).subscribe(() => {
          this.ui.toast('Store deactivated');
          this.data.reload();
        }),
      );
  }
}
