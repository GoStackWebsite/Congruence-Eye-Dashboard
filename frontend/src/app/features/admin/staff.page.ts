import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Staff } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { CeColumn, DS } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { AdminField, EntityDrawerComponent } from '../../shared/ds/entity-drawer.component';
import { useOpsStyles } from '../../shared/ds/ops.styles';
import { StoreChipFilterComponent } from '../../shared/ds/store-chip-filter.component';

/** Minutes of a shift (overnight shifts wrap past midnight). */
export function shiftMinutes(start: string, end: string): number | null {
  const m = (s: string) => (/^\d{2}:\d{2}$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : NaN);
  const a = m(start);
  const b = m(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return b > a ? b - a : b + 1440 - a;
}

/** Staff roster list with add / edit / remove (Admin › Staff roster and the store's Staff tab). */
@Component({
  selector: 'ce-staff-list',
  imports: [MatIconModule, MatTooltipModule, ...DS, EntityDrawerComponent, StoreChipFilterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (data.error() && !data.data()) {
      <ce-card>
        <ce-empty-state kind="error" [message]="data.error()">
          <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
        </ce-empty-state>
      </ce-card>
    } @else {
      <ce-table
        [rows]="rows()"
        [columns]="cols()"
        [loading]="data.loading() && !data.data()"
        title="Roster"
        [subtitle]="subtitle()"
        [searchable]="true"
        searchPlaceholder="Search by name, code or role"
        searchTestId="input-search"
        [columnChooser]="!fixedStoreId()"
        testId="table-admin-staff"
        [rowTestId]="rowId"
        [rowClass]="rowClass"
        [defaultSort]="{ key: 'name', dir: 'asc' }"
        sortStart="asc"
        emptyIcon="badge"
        emptyTitle="No staff on the roster"
        emptyMessage="Add store staff and their shifts; staff presence and accountability use this list."
      >
        @if (!fixedStoreId()) {
          <div tableFilters style="margin-top: 8px">
            <ce-store-chip-filter [(value)]="storeFilter" testId="filter-staff-store" />
          </div>
        }
        <button tableActions type="button" class="ce-btn ce-btn-secondary ce-icon-btn" (click)="data.reload()" matTooltip="Refresh" aria-label="Refresh" data-testid="btn-refresh"><mat-icon>refresh</mat-icon></button>
            <button tableActions type="button" class="ce-btn ce-btn-primary" (click)="openForm(null)" data-testid="btn-create-staff"><mat-icon>person_add</mat-icon> Add staff</button>
        <ng-template ceCell="isActive" let-s>
          <ce-pill [value]="s.isActive ? 'YES' : 'NO'" [label]="s.isActive ? 'Active' : 'Inactive'" size="sm" />
        </ng-template>
        <ng-template ceCell="actions" let-s>
          <span class="ops-row-actions">
            <button type="button" class="ce-icon-btn sm" matTooltip="Edit" aria-label="Edit staff" (click)="openForm(s)" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
            <button type="button" class="ce-icon-btn sm" matTooltip="Remove" aria-label="Remove staff" (click)="remove(s)" data-testid="btn-delete"><mat-icon>person_remove</mat-icon></button>
          </span>
        </ng-template>
      </ce-table>
    }

    <ce-entity-drawer
      [(open)]="formOpen"
      entity="staff"
      [title]="editing() ? 'Edit staff' : 'Add staff'"
      [subtitle]="editing() ? editing()!.code + ' · ' + editing()!.name : 'Shifts are store-local times'"
      [fields]="fields"
      [value]="formValue()"
      [submit]="submit"
      [submitLabel]="editing() ? 'Save changes' : 'Add to roster'"
      [mapServerError]="mapError"
      (saved)="onSaved()"
    />
  `,
})
export class StaffListComponent {
  protected readonly opsCss = useOpsStyles();
  private readonly lookup = inject(LookupService);
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  readonly fixedStoreId = input<number | null>(null);
  readonly storeFilter = signal<number | null>(null);
  readonly storeId = computed(() => this.fixedStoreId() ?? this.storeFilter());
  readonly data = loadOn(() => ({ storeId: this.storeId() }), (q) => this.api.get<Staff[]>('/staff', q));
  readonly rows = computed(() => this.data.data() ?? []);
  readonly formOpen = signal(false);
  readonly editing = signal<Staff | null>(null);
  readonly rowId = (s: Staff) => `row-staff-${s.id}`;
  readonly rowClass = (s: Staff) => (s.isActive ? null : 'ops-dim');
  readonly subtitle = computed(() => {
    const r = this.rows();
    return r.length ? `${r.filter((s) => s.isActive).length} active of ${r.length}` : null;
  });
  readonly formValue = computed(() => this.editing() ?? { storeId: this.storeId() });

  readonly cols = computed<CeColumn<Staff>[]>(() => [
    { key: 'name', header: 'Name', type: 'avatar', sortable: true, locked: true },
    { key: 'code', header: 'Code', sortable: true, cellClass: () => 'ops-mono' },
    { key: 'designation', header: 'Designation', sortable: true },
    ...(this.fixedStoreId() ? [] : [{ key: 'store', header: 'Store', value: (s: Staff) => this.lookup.storeName()(s.storeId), sortable: true } as CeColumn<Staff>]),
    {
      key: 'shift',
      header: 'Shift',
      value: (s) => `${s.shiftStart} – ${s.shiftEnd}`,
      secondary: (s) => {
        const m = shiftMinutes(s.shiftStart, s.shiftEnd);
        return m === null ? null : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`;
      },
      searchable: false,
    },
    { key: 'isActive', header: 'Status', value: (s) => (s.isActive ? 'Active' : 'Inactive'), sortable: true },
    { key: 'actions', header: 'Action', type: 'actions', value: () => '', align: 'right', locked: true },
  ]);

  readonly fields: AdminField[] = [
    { key: 'storeId', label: 'Store', type: 'select', required: true, full: true, options: () => this.lookup.scopedStores().map((s) => ({ value: s.id, label: s.name })) },
    { key: 'name', label: 'Full name', type: 'text', required: true, placeholder: 'Lakshmi Priya' },
    { key: 'code', label: 'Staff code', type: 'text', required: true, placeholder: 'TN-014' },
    { key: 'designation', label: 'Designation', type: 'text', placeholder: 'Sales associate', full: true },
    { key: 'shiftStart', label: 'Shift start (HH:mm)', type: 'time', required: true, default: '10:00' },
    { key: 'shiftEnd', label: 'Shift end (HH:mm)', type: 'time', required: true, default: '19:00', validate: (v, all) => (String(v ?? '') === String(all['shiftStart'] ?? '') ? 'Shift end must differ from the start' : null) },
    { key: 'isActive', label: 'Active', type: 'checkbox', default: true },
  ];
  readonly mapError = (status: number, msg: string) => (status === 409 || /code/i.test(msg) ? { field: 'code', message: status === 409 ? 'This staff code is already used' : msg } : null);

  readonly submit = (v: Record<string, unknown>) => {
    const s = this.editing();
    return s ? this.api.patch(`/staff/${s.id}`, v, silent()) : this.api.post('/staff', v, null, silent());
  };

  constructor() {
    this.lookup.loadStores().subscribe();
  }

  openForm(s: Staff | null): void {
    this.editing.set(s);
    this.formOpen.set(true);
  }

  onSaved(): void {
    this.ui.toast(this.editing() ? 'Saved' : 'Created');
    this.data.reload();
  }

  remove(s: Staff): void {
    this.ui.confirm({ title: 'Remove from roster?', message: `Remove "${s.name}" (${s.code}) from the roster?`, confirmText: 'Remove', danger: true }).subscribe(() =>
      this.api.delete(`/staff/${s.id}`).subscribe(() => {
        this.ui.toast('Removed');
        this.data.reload();
      }),
    );
  }
}

/** Admin › Staff roster. */
@Component({
  selector: 'ce-staff-page',
  imports: [...DS, StaffListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-admin-staff">
      <ce-page title="Staff roster" description="Store staff and shifts — used for staff presence, zone allocation and accountability">
        <ce-staff-list />
      </ce-page>
    </section>
  `,
})
export class StaffPage {}
