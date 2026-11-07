import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth/auth.service';
import { VENDOR_CATEGORIES, Vendor, VendorVisit, VendorVisitStatus } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { FieldDef, enumOptions } from '../../shared/crud/field';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { STORE_TZ, VENDOR_CATEGORY_ICON, opsLabel, storeDateTime, storeTime, withMobileLabels } from '../checklists/_ui/ops';
import { LIST_STYLES, OpsServiceStyles } from '../checklists/_ui/styles';

const VISIT_STATUSES: VendorVisitStatus[] = ['SCHEDULED', 'CHECKED_IN', 'COMPLETED', 'MISSED', 'CANCELLED'];

type VendorRow = Vendor & { visits: number; avgRating: number | null; lastVisit: string | null };

/** YYYY-MM-DD of an instant in store time. */
export function storeDay(iso: string, tz = STORE_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** The 7 store-local days (Mon → Sun) of the week containing `anchor` shifted by `offset` weeks. */
export function weekDays(anchor: Date, offset = 0): string[] {
  const today = storeDay(anchor.toISOString());
  const d = new Date(`${today}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

/** Per-vendor visit count, average rating and last visit. */
export function vendorStats(vendors: Vendor[], visits: VendorVisit[], now = Date.now()): VendorRow[] {
  return vendors.map((v) => {
    const mine = visits.filter((x) => x.vendorId === v.id);
    const rated = mine.filter((x) => x.rating);
    return {
      ...v,
      visits: mine.length,
      avgRating: rated.length ? Math.round((rated.reduce((s, x) => s + (x.rating ?? 0), 0) / rated.length) * 10) / 10 : null,
      // "last visit" is in the past: a visit only scheduled for next week is not one
      lastVisit:
        mine
          .map((x) => x.checkInAt ?? x.scheduledAt)
          .filter((t) => !!t && new Date(t).getTime() <= now)
          .sort()
          .pop() ?? null,
    };
  });
}

/** Store Ops › Vendors: vendor directory and the visit log (list or week calendar) with check-in / check-out and ratings. */
@Component({
  selector: 'ce-vendors-page',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule, MatIconModule, MatTooltipModule, ...DS, ...LIST_STYLES, OpsServiceStyles],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles /><ce-ops-service-styles />
    <div class="ops-page">
      <ce-page title="Vendors" description="Housekeeping, security, maintenance and IT partners — and every visit they make to your stores">
        <ng-container pageActions>
          @if (canManage()) {
            @if (tab() === 'vendors') {
              <button type="button" class="ce-btn ce-btn-primary" (click)="editVendor(null)" data-testid="btn-create-vendor"><mat-icon>add</mat-icon> New vendor</button>
            }
          }
        </ng-container>
        <ce-tabs pageTabs [tabs]="tabs()" [(value)]="tab" queryParam="tab" label="Vendors" data-testid="vendor-tabs" />

        @if (tab() === 'vendors') {
          <section class="ops-page" data-testid="page-vendors">
            <ce-stat-strip label="Vendor summary">
              <ce-stat-tile variant="strip" id="vendors-active" label="Active vendors" [value]="activeCount()" [loading]="vendorsBusy()" />
              <ce-stat-tile variant="strip" id="vendors-inactive" label="Inactive" [value]="inactiveCount()" [loading]="vendorsBusy()" />
              <span class="ce-stat-strip-sep" aria-hidden="true"></span>
              <ce-stat-tile variant="strip" id="vendors-visits" label="Visits logged" [value]="allVisits.data()?.length" [loading]="vendorsBusy()" />
              <ce-stat-tile variant="strip" id="vendors-rating" label="Average rating" format="decimal" [value]="avgRating()" [loading]="vendorsBusy()" hint="Average of the ratings given at check-out (1–5)" />
            </ce-stat-strip>
            @if (vendors.error() && !vendors.data()) {
              <div class="ops-card">
                <ce-empty-state kind="error" [message]="vendors.error()"><button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="reloadVendors()" data-testid="btn-retry">Retry</button></ce-empty-state>
              </div>
            } @else {
              <div class="ops-card">
                <ce-table
                  [rows]="vendorRows()"
                  [columns]="vendorCols"
                  [loading]="vendorsBusy()"
                  title="Vendor directory"
                  [searchable]="true"
                  searchPlaceholder="Search name, contact, phone or email"
                  searchTestId="input-search"
                  testId="table-vendors"
                  [rowTestId]="vendorRowId"
                  [bare]="true"
                  [defaultSort]="{ key: 'name', dir: 'asc' }"
                  sortStart="asc"
                  emptyIcon="handshake"
                  emptyTitle="No vendors yet"
                  [emptyMessage]="canManage() ? 'Add the housekeeping, security and maintenance partners that visit your stores.' : 'Vendors added by your managers will show here.'"
                >
                  <button tableActions type="button" class="ce-btn ce-btn-secondary ce-btn-icon" (click)="reloadVendors()" matTooltip="Refresh" aria-label="Refresh" data-testid="btn-refresh"><mat-icon>refresh</mat-icon></button>
                  <ng-template ceCell="name" let-v>
                    <span class="ops-with-icon" style="max-width: 360px">
                      <span class="ops-icon-tile sm"><span class="material-symbols-outlined">{{ catIcon[v.category] || 'storefront' }}</span></span>
                      <span class="ops-cell-title" [title]="v.name"><span class="t">{{ v.name }}</span><span class="s">{{ label(v.category) }}</span></span>
                    </span>
                  </ng-template>
                  <ng-template ceCell="contactName" let-v>
                    <span class="ops-cell-title" [title]="(v.contactName || '') + ' ' + (v.phone || '') + ' ' + (v.email || '')">
                      <span class="t">{{ v.contactName || '--' }}</span>
                      <span class="s">{{ contactLine(v) }}</span>
                    </span>
                  </ng-template>
                  <ng-template ceCell="avgRating" let-v>
                    @if (v.avgRating) {
                      <span class="ops-with-icon"><span class="stars" [attr.aria-label]="v.avgRating + ' of 5'"><span class="on">★</span></span>{{ v.avgRating }}</span>
                    } @else {
                      <span class="dash">--</span>
                    }
                  </ng-template>
                  <ng-template ceCell="isActive" let-v>
                    <ce-pill [value]="v.isActive ? 'YES' : 'NO'" [label]="v.isActive ? 'Active' : 'Inactive'" />
                  </ng-template>
                  <ng-template ceCell="action" let-v>
                    <span class="ops-row-actions">
                      @if (canManage()) {
                        <button type="button" class="ce-icon-btn sm" matTooltip="Edit" aria-label="Edit" (click)="editVendor(v)" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
                        <button type="button" class="ce-icon-btn sm" [matTooltip]="v.visits ? 'Deactivate (has visits)' : 'Delete'" aria-label="Delete" (click)="removeVendor(v)" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
                      }
                    </span>
                  </ng-template>
                </ce-table>
              </div>
            }
          </section>
        } @else {
          <section class="ops-page" data-testid="page-vendor-visits">
            <ce-stat-strip label="Visit summary">
              <ce-stat-tile variant="strip" id="visits-today" label="Visits today" [value]="todayCount()" [loading]="visitsBusy()" />
              <ce-stat-tile variant="strip" id="visits-onsite" label="On site now" [value]="countStatus('CHECKED_IN')" [loading]="visitsBusy()" hint="Checked in, not yet checked out" />
              <ce-stat-tile variant="strip" id="visits-upcoming" label="Scheduled" [value]="countStatus('SCHEDULED')" [loading]="visitsBusy()" />
              <span class="ce-stat-strip-sep" aria-hidden="true"></span>
              <ce-stat-tile variant="strip" id="visits-missed" label="Missed" [value]="countStatus('MISSED')" [loading]="visitsBusy()" />
            </ce-stat-strip>
            <div class="ops-toolbar">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="ops-filter">
                <mat-select [ngModel]="status()" (ngModelChange)="status.set($event)" placeholder="All statuses" data-testid="filter-visit-status" aria-label="Status">
                  <mat-option [value]="null">All statuses</mat-option>
                  @for (s of statuses; track s) {
                    <mat-option [value]="s">{{ statusLabel(s) }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="ops-filter wide">
                <mat-select [ngModel]="vendorId()" (ngModelChange)="vendorId.set($event)" placeholder="All vendors" data-testid="filter-visit-vendor" aria-label="Vendor">
                  <mat-option [value]="null">All vendors</mat-option>
                  @for (v of vendors.data() ?? []; track v.id) {
                    <mat-option [value]="v.id">{{ v.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              @if (status() || vendorId()) {
                <button type="button" class="ce-link-btn" (click)="status.set(null); vendorId.set(null)" data-testid="btn-clear-filters">Clear filters</button>
              }
              <span class="spacer"></span>
              <ce-segmented [options]="visitViews" [value]="visitView()" (valueChange)="visitView.set($any($event))" label="Visits view" data-testid="toggle-visit-view" />
              @if (canManage()) {
                <button type="button" class="ce-btn ce-btn-primary" (click)="schedule()" data-testid="btn-create-visit"><mat-icon>event</mat-icon> Schedule visit</button>
              }
            </div>

            @if (visits.error() && !visits.data()) {
              <div class="ops-card">
                <ce-empty-state kind="error" [message]="visits.error()"><button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="visits.reload()" data-testid="btn-retry">Retry</button></ce-empty-state>
              </div>
            } @else if (visitView() === 'week') {
              <div class="row" style="justify-content: space-between">
                <div class="vd-week-nav">
                  <button type="button" class="ce-icon-btn" (click)="weekOffset.set(weekOffset() - 1)" aria-label="Previous week" data-testid="btn-week-prev"><mat-icon>chevron_left</mat-icon></button>
                  <span class="lbl">{{ weekLabel() }}</span>
                  <button type="button" class="ce-icon-btn" (click)="weekOffset.set(weekOffset() + 1)" aria-label="Next week" data-testid="btn-week-next"><mat-icon>chevron_right</mat-icon></button>
                  @if (weekOffset() !== 0) {
                    <button type="button" class="ce-link-btn" (click)="weekOffset.set(0)">This week</button>
                  }
                </div>
                <span class="caption">Store time ({{ tz }})</span>
              </div>
              <div class="vd-week" data-testid="visit-calendar">
                @for (d of week(); track d.day) {
                  <div class="vd-day" [class.today]="d.day === today" [class.weekend]="d.weekend" [attr.data-testid]="'visit-day-' + d.day">
                    <div class="dh"><span class="dn">{{ d.num }}</span>{{ d.dow }}</div>
                    @for (v of d.visits; track v.id) {
                      <div class="vd-ev" [class]="'vd-ev s-' + v.status" [title]="v.vendorName + ' · ' + v.storeName + ' · ' + v.purpose + ' · ' + statusLabel(v.status)" [attr.data-testid]="'visit-event-' + v.id">
                        <span class="n">{{ time(v.scheduledAt) }} · {{ v.vendorName }}</span>
                        <span class="m">{{ v.storeName }}</span>
                        @if (v.status === 'SCHEDULED') {
                          <button type="button" class="ce-link-btn" style="font-size: 12px; text-align: left" (click)="checkIn(v)">Check in</button>
                        } @else if (v.status === 'CHECKED_IN') {
                          <button type="button" class="ce-link-btn" style="font-size: 12px; text-align: left" (click)="checkOut(v)">Check out</button>
                        }
                      </div>
                    } @empty {
                      <span class="caption" style="padding: 2px">—</span>
                    }
                  </div>
                }
              </div>
            } @else {
              <div class="ops-card">
                <ce-table
                  [rows]="visitRows()"
                  [columns]="visitCols"
                  [loading]="visitsBusy()"
                  title="Visit log"
                  [searchable]="true"
                  searchPlaceholder="Search vendor, store or purpose"
                  searchTestId="input-search-visits"
                  testId="table-vendor-visits"
                  [rowTestId]="visitRowId"
                  [bare]="true"
                  [defaultSort]="{ key: 'scheduledAt', dir: 'desc' }"
                  emptyIcon="event"
                  [emptyTitle]="status() || vendorId() ? 'No visits match these filters' : 'No vendor visits yet'"
                  [emptyMessage]="status() || vendorId() ? 'Clear the filters to see every visit.' : 'Schedule a visit so the store knows who is coming and when.'"
                >
                  <ng-template ceCell="vendorName" let-v>
                    <span class="ops-cell-title" [title]="v.vendorName + ' — ' + v.purpose"><span class="t">{{ v.vendorName }}</span><span class="s">{{ v.purpose }}</span></span>
                  </ng-template>
                  <ng-template ceCell="inout" let-v>
                    @if (v.checkInAt) {
                      <span class="tabular">{{ time(v.checkInAt) }} – {{ v.checkOutAt ? time(v.checkOutAt) : 'on site' }}</span>
                    } @else {
                      <span class="dash">--</span>
                    }
                  </ng-template>
                  <ng-template ceCell="status" let-v>
                    <ce-pill [value]="v.status" data-testid="chip-status" />
                  </ng-template>
                  <ng-template ceCell="rating" let-v>
                    @if (v.rating) {
                      <span class="stars" [attr.aria-label]="v.rating + ' of 5'" [title]="v.notes ?? ''">@for (n of [1, 2, 3, 4, 5]; track n) {<span [class]="n <= v.rating ? 'on' : 'off'">{{ n <= v.rating ? '★' : '☆' }}</span>}</span>
                    } @else {
                      <span class="dash">--</span>
                    }
                  </ng-template>
                  <ng-template ceCell="action" let-v>
                    <span class="ops-row-actions">
                      @if (v.status === 'SCHEDULED') {
                        <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="checkIn(v)" [disabled]="busyId() === v.id" data-testid="btn-check-in"><mat-icon>login</mat-icon> Check in</button>
                      }
                      @if (v.status === 'CHECKED_IN') {
                        <button type="button" class="ce-btn ce-btn-primary ce-btn-sm" (click)="checkOut(v)" [disabled]="busyId() === v.id" data-testid="btn-check-out"><mat-icon>logout</mat-icon> Check out</button>
                      }
                      @if (canManage() && v.status === 'SCHEDULED') {
                        <button type="button" class="ce-icon-btn sm" matTooltip="Edit" aria-label="Edit" (click)="schedule(v)" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
                        <button type="button" class="ce-icon-btn sm" matTooltip="Cancel visit" aria-label="Cancel visit" (click)="cancel(v)" data-testid="btn-cancel-visit"><mat-icon>event_busy</mat-icon></button>
                      }
                    </span>
                  </ng-template>
                </ce-table>
              </div>
            }
          </section>
        }
      </ce-page>
    </div>
  `,
})
export class VendorsPage {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly lookup = inject(LookupService);
  private readonly ui = inject(UiService);
  readonly statuses = VISIT_STATUSES;
  readonly catIcon = VENDOR_CATEGORY_ICON;
  readonly tz = 'IST';
  readonly today = storeDay(new Date().toISOString());
  readonly tab = signal('vendors');
  readonly status = signal<VendorVisitStatus | null>(null);
  readonly vendorId = signal<number | null>(null);
  readonly visitView = signal<'list' | 'week'>('list');
  readonly weekOffset = signal(0);
  readonly busyId = signal<number | null>(null);
  readonly canManage = computed(() => this.auth.can('manageVendors'));
  readonly visitViews: TabItem[] = [
    { value: 'list', label: 'List', testId: 'view-visits-list' },
    { value: 'week', label: 'Week', testId: 'view-visits-calendar' },
  ];

  readonly vendors = loadOn(() => ({}), () => this.api.get<Vendor[]>('/vendors'));
  /** All visits (unfiltered) for vendor stats and the week calendar. */
  readonly allVisits = loadOn(() => ({ t: this.tab() }), () => this.api.get<VendorVisit[]>('/vendor-visits', {}));
  readonly visits = loadOn(
    () => ({ status: this.status(), vendorId: this.vendorId(), t: this.tab() }),
    (q) => this.api.get<VendorVisit[]>('/vendor-visits', { status: q.status, vendorId: q.vendorId }),
  );
  readonly vendorsBusy = computed(() => this.vendors.loading() && !this.vendors.data());
  readonly visitsBusy = computed(() => this.visits.loading() && !this.visits.data());
  readonly vendorRows = computed(() => vendorStats(this.vendors.data() ?? [], this.allVisits.data() ?? []));
  readonly visitRows = computed(() => this.visits.data() ?? []);
  readonly activeCount = computed(() => (this.vendors.data() ? this.vendors.data()!.filter((v) => v.isActive).length : undefined));
  readonly inactiveCount = computed(() => (this.vendors.data() ? this.vendors.data()!.filter((v) => !v.isActive).length : undefined));
  readonly avgRating = computed(() => {
    const r = (this.allVisits.data() ?? []).filter((v) => v.rating);
    return this.allVisits.data() ? (r.length ? Math.round((r.reduce((s, v) => s + (v.rating ?? 0), 0) / r.length) * 10) / 10 : null) : undefined;
  });
  readonly todayCount = computed(() => (this.visits.data() ? this.visitRows().filter((v) => storeDay(v.scheduledAt) === this.today).length : undefined));
  readonly tabs = computed<TabItem[]>(() => [
    { value: 'vendors', label: 'Vendors', count: this.vendors.data()?.length ?? null, testId: 'tab-vendors' },
    { value: 'visits', label: 'Visits', count: this.allVisits.data()?.length ?? null, testId: 'tab-visits' },
  ]);
  readonly week = computed(() => {
    const days = weekDays(new Date(), this.weekOffset());
    const list = this.visitRows();
    return days.map((day) => {
      const d = new Date(`${day}T12:00:00Z`);
      return {
        day,
        num: d.getUTCDate(),
        dow: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
        weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
        visits: list.filter((v) => storeDay(v.scheduledAt) === day).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
      };
    });
  });
  readonly weekLabel = computed(() => {
    const w = this.week();
    const f = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    return `${f(w[0].day)} – ${f(w[6].day)}`;
  });

  readonly vendorRowId = (v: VendorRow) => `row-vendor-${v.id}`;
  readonly visitRowId = (v: VendorVisit) => `row-visit-${v.id}`;
  readonly vendorCols: CeColumn<VendorRow>[] = withMobileLabels<VendorRow>([
    { key: 'name', header: 'Vendor', type: 'custom', sortable: true, locked: true, searchable: true, value: (v) => `${v.name} ${opsLabel(v.category)}` },
    { key: 'contactName', header: 'Contact', type: 'custom', sortable: true, searchable: true, value: (v) => `${v.contactName ?? ''} ${v.phone ?? ''} ${v.email ?? ''}` },
    { key: 'visits', header: 'Visits', type: 'number', sortable: true, align: 'left' },
    { key: 'avgRating', header: 'Rating', type: 'custom', sortable: true },
    { key: 'lastVisit', header: 'Last visit', sortable: true, format: (v) => (v ? storeDateTime(String(v)) : null) },
    { key: 'isActive', header: 'Status', type: 'custom', sortable: true, value: (v) => (v.isActive ? 'Active' : 'Inactive') },
    { key: 'action', header: 'Action', type: 'actions', align: 'right', locked: true, value: () => '' },
  ], ['lastVisit']);
  readonly visitCols: CeColumn<VendorVisit>[] = withMobileLabels<VendorVisit>([
    { key: 'vendorName', header: 'Vendor', type: 'custom', sortable: true, locked: true, searchable: true, value: (v) => `${v.vendorName} ${v.purpose}` },
    { key: 'storeName', header: 'Store', sortable: true },
    { key: 'scheduledAt', header: 'Scheduled', sortable: true, format: (v) => storeDateTime(String(v)) },
    { key: 'inout', header: 'In / out', type: 'custom', value: (v) => v.checkInAt },
    { key: 'status', header: 'Status', type: 'custom', sortable: true, value: (v) => v.status },
    { key: 'rating', header: 'Rating', type: 'custom', sortable: true },
    { key: 'action', header: 'Action', type: 'actions', align: 'right', locked: true, value: () => '' },
  ]);

  constructor() {
    this.lookup.loadStores().subscribe();
  }

  label(c: string): string {
    return opsLabel(c);
  }
  contactLine(v: Vendor): string {
    return [v.phone, v.email].filter((x) => !!x).join(' · ') || 'No phone or email';
  }
  statusLabel(s: string): string {
    return s === 'CHECKED_IN' ? 'Checked in' : opsLabel(s);
  }
  time(iso: string): string {
    return storeTime(iso);
  }
  countStatus(s: VendorVisitStatus): number | undefined {
    return this.visits.data() ? this.visitRows().filter((v) => v.status === s).length : undefined;
  }
  reloadVendors(): void {
    this.vendors.reload();
    this.allVisits.reload();
  }
  private reloadVisits(): void {
    this.visits.reload();
    this.allVisits.reload();
  }

  // ------------------------------------------------------------ vendors
  private vendorFields(): FieldDef[] {
    return [
      { key: 'name', label: 'Name', type: 'text', required: true, full: true },
      { key: 'category', label: 'Category', type: 'select', required: true, options: enumOptions(VENDOR_CATEGORIES, opsLabel), default: 'OTHER' },
      { key: 'contactName', label: 'Contact person', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text', placeholder: '+91 98xxxxxxxx' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'isActive', label: 'Active', type: 'checkbox', default: true },
    ];
  }
  editVendor(v: Vendor | null): void {
    this.ui
      .form({
        title: v ? 'Edit vendor' : 'New vendor',
        entity: 'vendor',
        fields: this.vendorFields(),
        value: v ? { ...v } : null,
        submit: (p) => (v ? this.api.patch(`/vendors/${v.id}`, p, silent()) : this.api.post('/vendors', p, null, silent())),
      })
      .subscribe(() => {
        this.ui.toast(v ? 'Saved' : 'Created');
        this.reloadVendors();
      });
  }
  removeVendor(v: VendorRow): void {
    const msg = v.visits ? `"${v.name}" has ${v.visits} visit(s) on record, so it will be deactivated instead of deleted.` : `Delete "${v.name}"?`;
    this.ui.confirm({ title: v.visits ? 'Deactivate vendor?' : 'Delete vendor?', message: msg, confirmText: v.visits ? 'Deactivate' : 'Delete', danger: true }).subscribe(() =>
      this.api.delete(`/vendors/${v.id}`).subscribe(() => {
        this.ui.toast(v.visits ? 'Deactivated' : 'Deleted');
        this.reloadVendors();
      }),
    );
  }

  // ------------------------------------------------------------ visits
  schedule(v?: VendorVisit): void {
    this.api.get<Vendor[]>('/vendors').subscribe((list) => this.vendors.set(list));
    const fields: FieldDef[] = [
      { key: 'vendorId', label: 'Vendor', type: 'select', required: true, options: () => (this.vendors.data() ?? []).filter((x) => x.isActive).map((x) => ({ value: x.id, label: x.name })) },
      { key: 'storeId', label: 'Store', type: 'select', required: true, options: () => this.lookup.scopedStores().map((s) => ({ value: s.id, label: s.name })) },
      { key: 'purpose', label: 'Purpose', type: 'text', required: true, full: true, placeholder: 'e.g. Deep cleaning of trial rooms' },
      { key: 'scheduledAt', label: 'Scheduled at (store time)', type: 'datetime', required: true },
    ];
    this.ui
      .form({
        title: v ? 'Edit visit' : 'Schedule vendor visit',
        entity: 'visit',
        fields,
        value: v ? { ...v } : null,
        submit: (p) => (v ? this.api.patch(`/vendor-visits/${v.id}`, p, silent()) : this.api.post('/vendor-visits', p, null, silent())),
      })
      .subscribe(() => {
        this.ui.toast(v ? 'Visit updated' : 'Visit scheduled');
        this.reloadVisits();
      });
  }

  checkIn(v: VendorVisit): void {
    if (this.busyId() === v.id) return;
    this.busyId.set(v.id);
    this.api.patch(`/vendor-visits/${v.id}/check-in`).subscribe({
      next: () => {
        this.busyId.set(null);
        this.ui.toast(`${v.vendorName} checked in`);
        this.reloadVisits();
      },
      error: () => this.busyId.set(null),
    });
  }

  checkOut(v: VendorVisit): void {
    this.ui
      .form({
        title: `Check out · ${v.vendorName}`,
        entity: 'check-out',
        fields: [
          { key: 'rating', label: 'Rating (1–5)', type: 'select', options: [5, 4, 3, 2, 1].map((n) => ({ value: n, label: `${'★'.repeat(n)}${'☆'.repeat(5 - n)} (${n})` })) },
          { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'How was the work? Anything to follow up?' },
        ],
        submitLabel: 'Check out',
        submit: (p) => this.api.patch(`/vendor-visits/${v.id}/check-out`, p, silent()),
      })
      .subscribe(() => {
        this.ui.toast('Visit completed');
        this.reloadVisits();
      });
  }

  cancel(v: VendorVisit): void {
    this.ui.confirm({ title: 'Cancel visit?', message: `Cancel ${v.vendorName}'s visit on ${storeDateTime(v.scheduledAt)}?`, confirmText: 'Cancel visit', danger: true }).subscribe(() =>
      this.api.patch(`/vendor-visits/${v.id}`, { status: 'CANCELLED' }).subscribe(() => {
        this.ui.toast('Visit cancelled');
        this.reloadVisits();
      }),
    );
  }
}
