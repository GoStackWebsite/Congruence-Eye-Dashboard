import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { loadOn } from '../../core/services/loader';
import { formatInr, formatNumber, humanize } from '../../core/utils/format';
import { QueryObject } from '../../core/utils/query-params';
import { DateTimePipe } from '../pipes';
import { UiService } from '../ui/ui.service';
import { EmptyStateComponent, LoadStateComponent, PageHeaderComponent, StatusChipComponent } from '../ui/ui.components';
import { FieldDef } from './field';

export interface CrudColumn<T> {
  key: string;
  label: string;
  type?: 'text' | 'bool' | 'chip' | 'datetime' | 'date' | 'inr' | 'number';
  value?: (row: T) => unknown;
}

export interface CrudRowAction<T> {
  icon: string;
  label: string;
  testId: string;
  handler: (row: T, reload: () => void) => void;
  visible?: (row: T) => boolean;
}

export interface CrudConfig<T extends { id: number }> {
  /** page-<id>, table-<id> */
  id: string;
  /** singular, used for dialogs/buttons: btn-create-<entity>, dialog-<entity> */
  entity: string;
  title: string;
  subtitle?: string;
  endpoint: string;
  query?: () => QueryObject | null;
  columns: CrudColumn<T>[];
  fields: () => FieldDef[];
  canWrite: () => boolean;
  canDelete?: () => boolean;
  deleteVerb?: string;
  toPayload?: (v: Record<string, unknown>, existing: T | null) => unknown;
  toForm?: (row: T) => Record<string, unknown>;
  create?: (payload: unknown) => Observable<unknown>;
  rowActions?: CrudRowAction<T>[];
  emptyMessage?: string;
  pageSize?: number;
}

/**
 * Config-driven list + create/edit/delete page used by the admin screens.
 * Projected content (`<ng-content>`) renders in the toolbar (e.g. extra filters).
 */
@Component({
  selector: 'ce-crud-page',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatInputModule,
    PageHeaderComponent,
    EmptyStateComponent,
    LoadStateComponent,
    StatusChipComponent,
    DateTimePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page" [attr.data-testid]="'page-' + config().id">
      <ce-page-header [title]="config().title" [subtitle]="config().subtitle ?? null">
        @if (config().canWrite()) {
          <button mat-flat-button (click)="openForm(null)" [attr.data-testid]="'btn-create-' + config().entity">
            <mat-icon>add</mat-icon> New {{ entityLabel() }}
          </button>
        }
      </ce-page-header>

      <div class="toolbar">
        <mat-form-field class="search-field" subscriptSizing="dynamic">
          <mat-icon matPrefix>search</mat-icon>
          <mat-label>Search</mat-label>
          <input matInput [ngModel]="search()" (ngModelChange)="search.set($event)" data-testid="input-search" />
        </mat-form-field>
        <ng-content />
        <span class="spacer"></span>
        <button mat-icon-button (click)="data.reload()" matTooltip="Refresh" data-testid="btn-refresh" aria-label="Refresh">
          <mat-icon>refresh</mat-icon>
        </button>
      </div>

      <ce-load-state [loading]="data.loading()" [error]="data.error()" [hasData]="!!data.data()" />

      <div class="card table-card" [hidden]="!data.loaded()">
        <div class="table-scroll">
          <table mat-table [dataSource]="ds" matSort [attr.data-testid]="'table-' + config().id" class="ce-table">
            @for (c of config().columns; track c.key) {
              <ng-container [matColumnDef]="c.key">
                <th mat-header-cell *matHeaderCellDef mat-sort-header>{{ c.label }}</th>
                <td mat-cell *matCellDef="let row" [attr.data-col]="c.key">
                  <ng-container *ngTemplateOutlet="cell; context: { $implicit: row, c: c }" />
                </td>
              </ng-container>
            }
            <ng-container matColumnDef="_actions">
              <th mat-header-cell *matHeaderCellDef class="actions-col">Actions</th>
              <td mat-cell *matCellDef="let row" class="actions-col">
                @for (a of config().rowActions ?? []; track a.testId) {
                  @if (!a.visible || a.visible(row)) {
                    <button mat-icon-button [matTooltip]="a.label" [attr.aria-label]="a.label" [attr.data-testid]="a.testId" (click)="a.handler(row, reload)">
                      <mat-icon>{{ a.icon }}</mat-icon>
                    </button>
                  }
                }
                @if (config().canWrite()) {
                  <button mat-icon-button matTooltip="Edit" aria-label="Edit" data-testid="btn-edit" (click)="openForm(row)">
                    <mat-icon>edit</mat-icon>
                  </button>
                }
                @if (config().canDelete ? config().canDelete!() : config().canWrite()) {
                  <button mat-icon-button [matTooltip]="config().deleteVerb ?? 'Delete'" [attr.aria-label]="config().deleteVerb ?? 'Delete'" data-testid="btn-delete" (click)="remove(row)">
                    <mat-icon>delete</mat-icon>
                  </button>
                }
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="displayed(); sticky: true"></tr>
            <tr mat-row *matRowDef="let row; columns: displayed()" [attr.data-testid]="'row-' + config().entity + '-' + row.id"></tr>
          </table>
        </div>
        @if (data.loaded() && !ds.filteredData.length) {
          <ce-empty-state [title]="'No ' + config().title.toLowerCase() + ' found'" [message]="config().emptyMessage ?? null" />
        }
        <mat-paginator [pageSize]="config().pageSize ?? 25" [pageSizeOptions]="[10, 25, 50, 100]" showFirstLastButtons />
      </div>
    </section>

    <ng-template #cell let-row let-c="c">
      @let v = valueOf(row, c);
      @switch (c.type) {
        @case ('bool') {
          <ce-chip [value]="v ? 'YES' : 'NO'" [label]="v ? 'Yes' : 'No'" />
        }
        @case ('chip') {
          <ce-chip [value]="$any(v)" />
        }
        @case ('datetime') {
          {{ $any(v) | dt }}
        }
        @case ('date') {
          {{ $any(v) | dt: 'date' }}
        }
        @case ('inr') {
          {{ inr($any(v)) }}
        }
        @case ('number') {
          {{ num($any(v)) }}
        }
        @default {
          {{ v ?? '--' }}
        }
      }
    </ng-template>
  `,
})
export class CrudPageComponent<T extends { id: number }> {
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  readonly config = input.required<CrudConfig<T>>();

  readonly search = signal('');
  readonly ds = new MatTableDataSource<T>([]);
  private readonly sort = viewChild(MatSort);
  private readonly paginator = viewChild(MatPaginator);

  readonly data = loadOn(
    () => {
      const cfg = this.config();
      const q = cfg.query ? cfg.query() : {};
      return q === null ? null : { endpoint: cfg.endpoint, q };
    },
    (p) => this.api.get<T[] | { items: T[] }>(p.endpoint, p.q),
  );
  readonly reload = () => this.data.reload();

  readonly displayed = computed(() => [...this.config().columns.map((c) => c.key), '_actions']);
  readonly entityLabel = computed(() => humanize(this.config().entity).toLowerCase());

  constructor() {
    effect(() => {
      const d = this.data.data();
      this.ds.data = Array.isArray(d) ? d : (d?.items ?? []);
    });
    effect(() => {
      this.ds.filter = this.search().trim().toLowerCase();
    });
    effect(() => {
      const s = this.sort();
      const p = this.paginator();
      if (s) this.ds.sort = s;
      if (p) this.ds.paginator = p;
    });
    this.ds.sortingDataAccessor = (row, key) => {
      const col = this.config().columns.find((c) => c.key === key);
      const v = col ? this.valueOf(row, col) : (row as Record<string, unknown>)[key];
      return typeof v === 'number' ? v : String(v ?? '').toLowerCase();
    };
    this.ds.filterPredicate = (row, f) => {
      if (!f) return true;
      return this.config().columns.some((c) => String(this.valueOf(row, c) ?? '').toLowerCase().includes(f));
    };
  }

  valueOf(row: T, c: CrudColumn<T>): unknown {
    return c.value ? c.value(row) : (row as Record<string, unknown>)[c.key];
  }
  inr(v: number) {
    return formatInr(v);
  }
  num(v: number) {
    return formatNumber(v);
  }

  openForm(row: T | null): void {
    const cfg = this.config();
    const value = row ? (cfg.toForm ? cfg.toForm(row) : (row as unknown as Record<string, unknown>)) : null;
    this.ui
      .form({
        title: row ? `Edit ${this.entityLabel()}` : `New ${this.entityLabel()}`,
        entity: cfg.entity,
        fields: cfg.fields(),
        value,
        submit: (v) => {
          const payload = cfg.toPayload ? cfg.toPayload(v, row) : v;
          if (row) return this.api.patch(`${cfg.endpoint}/${row.id}`, payload);
          return cfg.create ? cfg.create(payload) : this.api.post(cfg.endpoint, payload);
        },
      })
      .subscribe(() => {
        this.ui.toast(row ? 'Saved' : 'Created');
        this.reload();
      });
  }

  remove(row: T): void {
    const cfg = this.config();
    const verb = cfg.deleteVerb ?? 'Delete';
    const name = (row as Record<string, unknown>)['name'] ?? (row as Record<string, unknown>)['title'] ?? `#${row.id}`;
    this.ui
      .confirm({ title: `${verb} ${this.entityLabel()}?`, message: `${verb} "${name}"?`, confirmText: verb, danger: true })
      .subscribe(() =>
        this.api.delete(`${cfg.endpoint}/${row.id}`).subscribe(() => {
          this.ui.toast(`${verb}d`);
          this.reload();
        }),
      );
  }
}
