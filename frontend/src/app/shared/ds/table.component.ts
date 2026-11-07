import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, Directive, ElementRef, TemplateRef, computed, contentChildren, effect, inject, input, output, signal } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { shortDate } from '../../core/utils/dates';
import { DateTimePipe } from '../pipes';
import { formatNumber, formatPct } from '../../core/utils/format';
import { AvatarComponent } from './avatar.component';
import { PillComponent } from './pill.component';
import { EmptyStateComponent } from '../ui/ui.components';

export type ColumnType = 'text' | 'number' | 'link-number' | 'link' | 'pill' | 'date' | 'datetime' | 'avatar' | 'percent' | 'actions' | 'custom';

export interface CeColumn<T> {
  key: string;
  header: string;
  /** Second header line, e.g. "(Actuals)". */
  sub?: string;
  type?: ColumnType;
  value?: (row: T) => unknown;
  /** Text shown in the cell (defaults by type); null/undefined/'' → "--". */
  format?: (value: unknown, row: T) => string | null | undefined;
  sortable?: boolean;
  /** Included in the toolbar search (text-like columns default to true). */
  searchable?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: string;
  /** router link for `link` / `link-number` cells. */
  link?: (row: T) => string | unknown[] | null | undefined;
  /** click handler for `link` / `link-number` cells (when there is no router link). */
  click?: (row: T) => void;
  /** secondary line (avatar / text cells). */
  secondary?: (row: T) => string | null | undefined;
  /** Hidden by default (can be turned on from the column chooser). */
  hidden?: boolean;
  /** Can't be hidden from the column chooser. */
  locked?: boolean;
  /** Let long cell text wrap (cells don't wrap by default). */
  wrap?: boolean;
  cellTestId?: (row: T) => string;
  /** Extra classes on the cell (e.g. 'cell-bad'). */
  cellClass?: (row: T) => string | null | undefined;
  /** Extra attributes on the cell <td> (e.g. { 'data-late': 'true' }). */
  cellAttrs?: (row: T) => Record<string, string | null | undefined>;
  /** Phone stacked-card mode: leave this cell out of the card (secondary detail). */
  mobileHide?: boolean;
  /** Phone stacked-card mode: label shown left of the value (defaults to `header`). */
  mobileLabel?: string;
}

/** Sets a map of attributes on its host (used for per-cell attributes in ce-table). */
@Directive({ selector: '[ceAttrs]' })
export class AttrsDirective {
  private readonly el = inject(ElementRef<HTMLElement>);
  readonly ceAttrs = input<Record<string, string | null | undefined> | null | undefined>(null);
  private prev: string[] = [];
  constructor() {
    effect(() => {
      const host = this.el.nativeElement as HTMLElement;
      for (const k of this.prev) host.removeAttribute(k);
      const a = this.ceAttrs() ?? {};
      this.prev = [];
      for (const [k, v] of Object.entries(a)) {
        if (v === null || v === undefined) continue;
        host.setAttribute(k, v);
        this.prev.push(k);
      }
    });
  }
}

/** `<ng-template ceCell="key" let-row>` overrides a column's cell. */
@Directive({ selector: 'ng-template[ceCell]' })
export class TableCellDirective {
  readonly ceCell = input.required<string>();
  readonly tpl = inject(TemplateRef);
}

type SortDir = 'asc' | 'desc';
const isBlank = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v));

/**
 * Data table (ce-table): declarative columns, sort (↓ indicators), toolbar search, Export hook, column chooser,
 * pagination (10/25/50/100), sticky header, skeleton rows, empty states (no data vs. no results), row click,
 * selection checkboxes for bulk actions, link-number cells and "--" for empty values.
 */
@Component({
  selector: 'ce-table',
  imports: [NgTemplateOutlet, AttrsDirective, RouterLink, MatIconModule, MatMenuModule, MatCheckboxModule, MatTooltipModule, AvatarComponent, PillComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-table-wrap', '[class.bare]': 'bare()', '[class.m-cards]': 'mobileCards()' },
  template: `
    @if (showToolbar()) {
      <div class="ce-table-toolbar">
        <div class="ce-tt-titles">
          @if (title()) {
            <div class="ce-tt-title">
              {{ title() }}
              @if (showTotal()) {
                <span class="ce-count-badge" data-testid="table-total">{{ filtered().length }} Total</span>
              }
            </div>
          }
          @if (subtitle()) {
            <div class="ce-tt-sub">{{ subtitle() }}</div>
          }
          <ng-content select="[tableFilters]" />
        </div>
        <div class="ce-tt-actions">
          @if (searchable()) {
            <label class="ce-search">
              <mat-icon aria-hidden="true">search</mat-icon>
              <input type="search" [placeholder]="searchPlaceholder()" [value]="query()" (input)="setQuery($any($event.target).value)" [attr.data-testid]="searchTestId()" [attr.aria-label]="searchPlaceholder()" />
            </label>
          }
          @if (columnChooser()) {
            <button type="button" class="ce-btn ce-btn-secondary ce-btn-icon" [matMenuTriggerFor]="colMenu" matTooltip="Columns" aria-label="Choose columns" data-testid="btn-columns">
              <mat-icon>view_column</mat-icon>
            </button>
            <mat-menu #colMenu="matMenu">
              @for (c of chooserColumns(); track c.key) {
                <div class="ce-col-option" (click)="$event.stopPropagation()">
                  <mat-checkbox [checked]="!hiddenCols().has(c.key)" (change)="toggleCol(c.key)">{{ c.header }}</mat-checkbox>
                </div>
              }
            </mat-menu>
          }
          @if (exportable()) {
            <button type="button" class="ce-btn ce-btn-secondary" (click)="exportClick.emit(filteredSorted())" [disabled]="!filtered().length" [attr.data-testid]="exportTestId()">
              <mat-icon>ios_share</mat-icon> Export
            </button>
          }
          <ng-content select="[tableActions]" />
        </div>
      </div>
    }
    @if (selection().size && selectable()) {
      <div class="ce-bulkbar" data-testid="table-bulkbar">
        <span>{{ selection().size }} selected</span>
        <button type="button" class="ce-link-btn" (click)="clearSelection()">Clear</button>
        <span class="spacer"></span>
        <ng-content select="[bulkActions]" />
      </div>
    }
    <div class="ce-table-scroll" [style.max-height]="maxHeight()" tabindex="0" role="region" [attr.aria-label]="title() || 'Table'">
      <table class="ce-dtable" [attr.data-testid]="testId()" [class.dense]="dense()">
        <thead>
          <tr>
            @if (selectable()) {
              <th class="sel">
                <mat-checkbox [checked]="allSelected()" [indeterminate]="someSelected()" (change)="toggleAll($event.checked)" aria-label="Select all rows" />
              </th>
            }
            @for (c of visibleCols(); track c.key) {
              <th
                scope="col"
                role="columnheader"
                [class]="'al-' + align(c) + (c.sortable ? ' sortable' : '') + (c.type === 'actions' ? ' t-actions' : '')"
                [style.width]="c.width ?? null"
                [attr.aria-sort]="sortKey() === c.key ? (sortDir() === 'asc' ? 'ascending' : 'descending') : null"
                (click)="c.sortable && toggleSort(c.key)"
              >
                @if (c.sortable) {
                  <button type="button" class="ce-th-sort" [class.active]="sortKey() === c.key">
                    <span class="ce-th-text">{{ c.header }}@if (c.sub) {<small>{{ c.sub }}</small>}</span>
                    <mat-icon aria-hidden="true">{{ sortKey() === c.key && sortDir() === 'asc' ? 'arrow_upward' : 'arrow_downward' }}</mat-icon>
                  </button>
                } @else {
                  <span class="ce-th-text">{{ c.header }}@if (c.sub) {<small>{{ c.sub }}</small>}</span>
                }
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @if (loading() && !rows().length) {
            @for (i of skeletonRows; track i) {
              <tr class="skel-row">
                @if (selectable()) {
                  <td></td>
                }
                @for (c of visibleCols(); track c.key) {
                  <td><span class="ce-skel" [style.width.%]="c.type === 'text' || c.type === 'avatar' || c.type === 'link' ? 60 : 35"></span></td>
                }
              </tr>
            }
          } @else {
            @for (r of page(); track trackFn()(r, $index)) {
              <tr
                [attr.data-testid]="rowTestId() ? rowTestId()!(r) : null"
                [class]="rowClass() ? rowClass()!(r) ?? '' : ''"
                [class.clickable]="rowClickable()"
                [class.selected]="selection().has(trackFn()(r, $index))"
                (click)="rowClickable() && rowClick.emit(r)"
              >
                @if (selectable()) {
                  <td class="sel" (click)="$event.stopPropagation()">
                    <mat-checkbox [checked]="selection().has(trackFn()(r, $index))" (change)="toggleRow(r, $index, $event.checked)" aria-label="Select row" />
                  </td>
                }
                @for (c of visibleCols(); track c.key) {
                   <td
                    [class]="'al-' + align(c) + ' t-' + (c.type ?? 'text') + (c.wrap ? ' wrap' : '') + (c.cellClass ? ' ' + (c.cellClass(r) ?? '') : '')"
                    [attr.data-testid]="c.cellTestId ? c.cellTestId(r) : null"
                    [attr.data-label]="c.type === 'actions' ? '' : (c.mobileLabel ?? c.header)"
                    [attr.data-col]="c.key"
                    [attr.data-m-hide]="c.mobileHide ? '' : null"
                    [attr.title]="cellTitle(c, r)"
                    [ceAttrs]="c.cellAttrs ? c.cellAttrs(r) : null"
                  >
                    @if (cellTpl(c.key); as tpl) {
                      <ng-container [ngTemplateOutlet]="tpl" [ngTemplateOutletContext]="{ $implicit: r, row: r, value: raw(c, r) }" />
                    } @else {
                      @switch (c.type ?? 'text') {
                        @case ('link-number') {
                          @if (isBlank(raw(c, r)) || raw(c, r) === 0) {
                            <span class="dash">{{ raw(c, r) === 0 ? '0' : '--' }}</span>
                          } @else if (c.link && c.link(r)) {
                            <a class="ce-num-link" [routerLink]="c.link(r)" (click)="$event.stopPropagation()">{{ text(c, r) }}</a>
                          } @else if (c.click) {
                            <button type="button" class="ce-num-link" (click)="$event.stopPropagation(); c.click(r)">{{ text(c, r) }}</button>
                          } @else {
                            <span class="ce-num-link static">{{ text(c, r) }}</span>
                          }
                        }
                        @case ('link') {
                          @if (c.link && c.link(r)) {
                            <a class="ce-text-link" [routerLink]="c.link(r)" (click)="$event.stopPropagation()">{{ text(c, r) }}</a>
                          } @else if (c.click) {
                            <button type="button" class="ce-text-link" (click)="$event.stopPropagation(); c.click(r)">{{ text(c, r) }}</button>
                          } @else {
                            <span class="ce-text-link">{{ text(c, r) }}</span>
                          }
                          @if (c.secondary && c.secondary(r)) {
                            <div class="cell-sub">{{ c.secondary(r) }}</div>
                          }
                        }
                        @case ('pill') {
                          @if (isBlank(raw(c, r))) {
                            <span class="dash">--</span>
                          } @else {
                            <ce-pill [value]="$any(raw(c, r))" [label]="c.format ? $any(c.format(raw(c, r), r)) : null" />
                          }
                        }
                        @case ('avatar') {
                          @if (isBlank(raw(c, r))) {
                            <span class="dash">--</span>
                          } @else {
                            <span class="cell-avatar"><ce-avatar [name]="$any(raw(c, r))" [size]="28" /><span class="ellipsis">{{ text(c, r) }}</span></span>
                          }
                        }
                        @default {
                          @if (isBlank(raw(c, r))) {
                            <span class="dash">--</span>
                          } @else {
                            <span>{{ text(c, r) }}</span>
                            @if (c.secondary && c.secondary(r)) {
                              <div class="cell-sub">{{ c.secondary(r) }}</div>
                            }
                          }
                        }
                      }
                    }
                  </td>
                }
              </tr>
            }
          }
        </tbody>
      </table>
      @if (!loading() && !page().length) {
        @if (rows().length && query()) {
          <ce-empty-state kind="filtered" icon="search_off" title="No results" [message]="'Nothing matches “' + query() + '”. Try a different search.'">
            <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="setQuery('')" data-testid="btn-clear-search">Clear search</button>
          </ce-empty-state>
        } @else {
          <ce-empty-state [icon]="emptyIcon()" [title]="emptyTitle()" [message]="emptyMessage()" />
        }
      }
    </div>
    @if (paginate() && filtered().length > pageSizeSig()) {
      <div class="ce-pager" [attr.data-testid]="testId() ? testId() + '-pager' : null">
        <span class="caption">Rows per page</span>
        <select class="ce-select-sm" [value]="pageSizeSig()" (change)="setPageSize(+$any($event.target).value)" aria-label="Rows per page">
          @for (s of pageSizes; track s) {
            <option [value]="s" [selected]="s === pageSizeSig()">{{ s }}</option>
          }
        </select>
        <span class="caption">{{ pageIndex() * pageSizeSig() + 1 }}–{{ min((pageIndex() + 1) * pageSizeSig(), filtered().length) }} of {{ filtered().length }}</span>
        <button type="button" class="ce-icon-btn" [disabled]="pageIndex() === 0" (click)="pageIndex.set(pageIndex() - 1)" aria-label="Previous page"><mat-icon>chevron_left</mat-icon></button>
        <button type="button" class="ce-icon-btn" [disabled]="(pageIndex() + 1) * pageSizeSig() >= filtered().length" (click)="pageIndex.set(pageIndex() + 1)" aria-label="Next page"><mat-icon>chevron_right</mat-icon></button>
      </div>
    }
  `,
})
export class TableComponent<T = Record<string, unknown>> {
  readonly rows = input.required<T[]>();
  readonly columns = input.required<CeColumn<T>[]>();
  readonly loading = input(false);
  readonly title = input<string | null>(null);
  readonly subtitle = input<string | null>(null);
  readonly showTotal = input(true);
  readonly searchable = input(false);
  readonly searchPlaceholder = input('Search');
  readonly searchTestId = input<string | null>('input-table-search');
  readonly exportable = input(false);
  readonly exportTestId = input<string | null>('btn-export');
  readonly columnChooser = input(false);
  readonly selectable = input(false);
  readonly rowClickable = input(false);
  readonly paginate = input(true);
  readonly pageSize = input(25);
  readonly maxHeight = input<string | null>(null);
  readonly dense = input(false);
  readonly bare = input(false);
  /** Below 768 px rows become stacked cards (label left, value right) instead of a sideways-scrolling table. */
  readonly mobileCards = input(true);
  readonly toolbar = input<boolean | null>(null);
  readonly testId = input<string | null>(null);
  readonly rowTestId = input<((row: T) => string) | null>(null);
  /** Extra classes per row (e.g. 'row-late'). */
  readonly rowClass = input<((row: T) => string | null | undefined) | null>(null);
  readonly trackBy = input<((row: T) => unknown) | null>(null);
  readonly defaultSort = input<{ key: string; dir: SortDir } | null>(null);
  /** Direction of the first click on a column (Tango default: descending ↓). */
  readonly sortStart = input<SortDir>('desc');
  readonly emptyTitle = input('No data yet');
  readonly emptyMessage = input<string | null>(null);
  readonly emptyIcon = input('inbox');

  readonly rowClick = output<T>();
  readonly exportClick = output<T[]>();
  readonly selectionChange = output<T[]>();

  private readonly cellTpls = contentChildren(TableCellDirective);
  protected readonly pageSizes = [10, 25, 50, 100];
  protected readonly skeletonRows = [0, 1, 2, 3, 4, 5];
  protected readonly query = signal('');
  protected readonly sortKey = signal<string | null>(null);
  protected readonly sortDir = signal<SortDir>('desc');
  protected readonly pageIndex = signal(0);
  protected readonly pageSizeSig = signal(25);
  protected readonly hiddenCols = signal<Set<string>>(new Set());
  protected readonly selection = signal<Set<unknown>>(new Set());
  private static readonly dt = new DateTimePipe();
  protected readonly isBlank = isBlank;
  protected readonly min = Math.min;

  constructor() {
    effect(() => this.pageSizeSig.set(this.pageSize()));
    effect(() => {
      const d = this.defaultSort();
      if (d) {
        this.sortKey.set(d.key);
        this.sortDir.set(d.dir);
      }
    });
    effect(() => this.hiddenCols.set(new Set(this.columns().filter((c) => c.hidden).map((c) => c.key))));
    // a new data set resets paging and selection
    effect(() => {
      this.rows();
      this.pageIndex.set(0);
      this.selection.set(new Set());
    });
  }

  protected readonly showToolbar = computed(() => this.toolbar() ?? !!(this.title() || this.searchable() || this.exportable() || this.columnChooser()));
  protected readonly trackFn = computed(() => {
    const t = this.trackBy();
    return (r: T, i: number) => (t ? t(r) : ((r as { id?: unknown })?.id ?? i));
  });
  protected readonly visibleCols = computed(() => this.columns().filter((c) => !this.hiddenCols().has(c.key)));
  protected readonly chooserColumns = computed(() => this.columns().filter((c) => !c.locked && c.type !== 'actions'));

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const rows = this.rows() ?? [];
    if (!q) return rows;
    const cols = this.columns().filter((c) => c.searchable ?? ['text', 'link', 'avatar', 'pill', undefined].includes(c.type));
    return rows.filter((r) => cols.some((c) => String(this.text(c, r) ?? '').toLowerCase().includes(q)));
  });
  protected readonly filteredSorted = computed(() => {
    const key = this.sortKey();
    const rows = [...this.filtered()];
    if (!key) return rows;
    const col = this.columns().find((c) => c.key === key);
    if (!col) return rows;
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const va = this.raw(col, a);
      const vb = this.raw(col, b);
      if (isBlank(va) && isBlank(vb)) return 0;
      if (isBlank(va)) return 1;
      if (isBlank(vb)) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'en-IN', { numeric: true }) * dir;
    });
  });
  protected readonly page = computed(() => {
    const rows = this.filteredSorted();
    if (!this.paginate()) return rows;
    const size = this.pageSizeSig();
    return rows.slice(this.pageIndex() * size, (this.pageIndex() + 1) * size);
  });
  protected readonly allSelected = computed(() => this.page().length > 0 && this.page().every((r, i) => this.selection().has(this.trackFn()(r, i))));
  protected readonly someSelected = computed(() => this.selection().size > 0 && !this.allSelected());

  /** Rows as currently filtered and sorted (e.g. for an export button outside the table). */
  currentRows(): T[] {
    return this.filteredSorted();
  }

  cellTpl(key: string): TemplateRef<unknown> | null {
    return this.cellTpls().find((d) => d.ceCell() === key)?.tpl ?? null;
  }

  align(c: CeColumn<T>): string {
    if (c.align) return c.align;
    return c.type === 'number' || c.type === 'percent' ? 'right' : c.type === 'actions' ? 'right' : 'left';
  }

  raw(c: CeColumn<T>, r: T): unknown {
    return c.value ? c.value(r) : (r as Record<string, unknown>)?.[c.key];
  }

  text(c: CeColumn<T>, r: T): string {
    const v = this.raw(c, r);
    if (c.format) return c.format(v, r) ?? '--';
    if (isBlank(v)) return '--';
    switch (c.type) {
      case 'number':
      case 'link-number':
        return typeof v === 'number' ? formatNumber(v) : String(v);
      case 'percent':
        return typeof v === 'number' ? formatPct(v) : String(v);
      case 'date':
        return shortDate(String(v));
      case 'datetime':
        return TableComponent.dt.transform(String(v));
      default:
        return String(v);
    }
  }

  /** Tooltip with the full text for long text cells (they are clipped with an ellipsis). */
  cellTitle(c: CeColumn<T>, r: T): string | null {
    const t = c.type ?? 'text';
    if (this.cellTpl(c.key) || !(t === 'text' || t === 'link' || t === 'avatar') || c.wrap) return null;
    const v = this.text(c, r);
    return v && v.length > 28 ? v : null;
  }

  setQuery(q: string): void {
    this.query.set(q);
    this.pageIndex.set(0);
  }

  toggleSort(key: string): void {
    if (this.sortKey() === key) this.sortDir.set(this.sortDir() === 'desc' ? 'asc' : 'desc');
    else {
      this.sortKey.set(key);
      this.sortDir.set(this.sortStart());
    }
  }

  setPageSize(n: number): void {
    this.pageSizeSig.set(n);
    this.pageIndex.set(0);
  }

  toggleCol(key: string): void {
    const s = new Set(this.hiddenCols());
    if (s.has(key)) s.delete(key);
    else s.add(key);
    this.hiddenCols.set(s);
  }

  toggleRow(r: T, i: number, on: boolean): void {
    const s = new Set(this.selection());
    const k = this.trackFn()(r, i);
    if (on) s.add(k);
    else s.delete(k);
    this.selection.set(s);
    this.emitSelection();
  }

  toggleAll(on: boolean): void {
    const s = new Set(this.selection());
    this.page().forEach((r, i) => (on ? s.add(this.trackFn()(r, i)) : s.delete(this.trackFn()(r, i))));
    this.selection.set(s);
    this.emitSelection();
  }

  clearSelection(): void {
    this.selection.set(new Set());
    this.emitSelection();
  }

  private emitSelection(): void {
    const sel = this.selection();
    this.selectionChange.emit(this.rows().filter((r, i) => sel.has(this.trackFn()(r, i))));
  }
}
