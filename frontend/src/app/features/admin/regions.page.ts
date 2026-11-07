import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Region, Store } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { CeColumn, DS } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { AdminField, EntityDrawerComponent } from '../../shared/ds/entity-drawer.component';
import { useOpsStyles } from '../../shared/ds/ops.styles';
import { apiErrorText } from './recorders/recorder.helpers';

interface RegionRow extends Region {
  stores: number;
  active: number;
  storeNames: string[];
}

/** Admin › Regions: groups of stores for regional managers and benchmarking. */
@Component({
  selector: 'ce-regions-page',
  imports: [MatIconModule, MatTooltipModule, ...DS, EntityDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <section data-testid="page-admin-regions">
      <ce-page title="Regions" description="Group stores for regional managers, benchmarking and the store filter">
        <ng-container pageActions>
          <button type="button" class="ce-btn ce-btn-primary" (click)="openForm(null)" data-testid="btn-create-region"><mat-icon>add</mat-icon> New region</button>
        </ng-container>
        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        } @else {
          <ce-table
            [rows]="rows()"
            [columns]="cols"
            [loading]="data.loading() && !data.data()"
            title="Region list"
            [searchable]="true"
            searchPlaceholder="Search regions"
            searchTestId="input-search"
            testId="table-admin-regions"
            [rowTestId]="rowId"
            [defaultSort]="{ key: 'name', dir: 'asc' }"
            sortStart="asc"
            emptyIcon="map"
            emptyTitle="No regions yet"
            emptyMessage="Create a region (e.g. Chennai North) and assign stores to it from the store form."
          >
            <button tableActions type="button" class="ce-btn ce-btn-secondary ce-icon-btn" (click)="data.reload()" matTooltip="Refresh" aria-label="Refresh" data-testid="btn-refresh"><mat-icon>refresh</mat-icon></button>
            <ng-template ceCell="storeNames" let-r>
              @if (r.storeNames.length) {
                <span class="ops-chips" [title]="r.storeNames.join(', ')">
                  @for (n of r.storeNames.slice(0, 4); track n) {
                    <span class="ops-chip">{{ n }}</span>
                  }
                  @if (r.storeNames.length > 4) {
                    <span class="ops-chip">+{{ r.storeNames.length - 4 }} more</span>
                  }
                </span>
              } @else {
                <span class="dash">No stores</span>
              }
            </ng-template>
            <ng-template ceCell="actions" let-r>
              <span class="ops-row-actions">
                <button type="button" class="ce-icon-btn sm" matTooltip="Rename" aria-label="Rename region" (click)="openForm(r)" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
                <button type="button" class="ce-icon-btn sm" [matTooltip]="r.stores ? 'Move its stores to another region first' : 'Delete'" aria-label="Delete region" [disabled]="r.stores > 0" (click)="remove(r)" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
              </span>
            </ng-template>
          </ce-table>
        }
      </ce-page>
      <ce-entity-drawer
        [(open)]="formOpen"
        entity="region"
        [title]="editing() ? 'Rename region' : 'New region'"
        [fields]="fields"
        [value]="editing()"
        [submit]="submit"
        [mapServerError]="mapError"
        [submitLabel]="editing() ? 'Save' : 'Create region'"
        (saved)="onSaved()"
      />
    </section>
  `,
})
export class RegionsPage {
  protected readonly opsCss = useOpsStyles();
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly lookup = inject(LookupService);
  readonly data = loadOn(() => ({}), () => this.api.get<Region[]>('/regions'));
  private readonly stores = loadOn(() => ({}), () => this.api.get<Store[]>('/stores'));
  readonly formOpen = signal(false);
  readonly editing = signal<Region | null>(null);
  readonly rowId = (r: Region) => `row-region-${r.id}`;
  readonly rows = computed<RegionRow[]>(() => {
    const stores = this.stores.data() ?? [];
    return (this.data.data() ?? []).map((r) => {
      const mine = stores.filter((s) => s.regionId === r.id);
      return { ...r, stores: mine.length, active: mine.filter((s) => s.isActive).length, storeNames: mine.map((s) => s.name) };
    });
  });
  readonly cols: CeColumn<RegionRow>[] = [
    { key: 'name', header: 'Region', sortable: true, locked: true },
    { key: 'stores', header: 'Stores', type: 'number', align: 'left', sortable: true },
    { key: 'active', header: 'Active stores', type: 'number', align: 'left', sortable: true },
    { key: 'storeNames', header: 'Store list', value: (r) => r.storeNames.join(', ') },
    { key: 'actions', header: 'Action', type: 'actions', value: () => '', align: 'right', locked: true },
  ];
  readonly fields: AdminField[] = [{ key: 'name', label: 'Region name', type: 'text', required: true, full: true, placeholder: 'Chennai North' }];
  readonly mapError = (status: number, msg: string) => (status === 409 || /name|exist/i.test(msg) ? { field: 'name', message: status === 409 ? 'A region with this name already exists' : msg } : null);

  readonly submit = (v: Record<string, unknown>) => {
    const r = this.editing();
    return r ? this.api.patch(`/regions/${r.id}`, v, silent()) : this.api.post('/regions', v, null, silent());
  };

  openForm(r: Region | null): void {
    this.editing.set(r);
    this.formOpen.set(true);
  }

  onSaved(): void {
    this.ui.toast(this.editing() ? 'Saved' : 'Created');
    this.data.reload();
    this.lookup.loadRegions();
  }

  remove(r: Region): void {
    this.ui.confirm({ title: 'Delete region?', message: `Delete "${r.name}"?`, confirmText: 'Delete', danger: true }).subscribe(() =>
      this.api.delete(`/regions/${r.id}`, silent()).subscribe({
        next: () => {
          this.ui.toast('Deleted');
          this.data.reload();
        },
        error: (e) => this.ui.toast(apiErrorText(e, 'The region could not be deleted')),
      }),
    );
  }
}
