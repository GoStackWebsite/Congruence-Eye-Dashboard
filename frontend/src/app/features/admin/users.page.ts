import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth/auth.service';
import { ROLES, Role, User } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { humanize } from '../../core/utils/format';
import { enumOptions } from '../../shared/crud/field';
import { CeColumn, DS, TabItem, Tone } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { AdminField, EntityDrawerComponent } from '../../shared/ds/entity-drawer.component';
import { isoDay, useOpsStyles } from '../../shared/ds/ops.styles';

export const ROLE_TONES: Record<Role, Tone> = {
  SUPER_ADMIN: 'brand',
  ADMIN: 'info',
  REGIONAL_MANAGER: 'info',
  STORE_MANAGER: 'good',
  AUDITOR: 'warning',
  STAFF: 'neutral',
};
const ALL_STORE_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN'];

/** Store names a user can see ("All stores" for admins). */
export function userStoreNames(u: Pick<User, 'role' | 'storeIds'>, name: (id: number) => string): string[] {
  return ALL_STORE_ROLES.includes(u.role) ? [] : (u.storeIds ?? []).map(name);
}

type UserTab = 'all' | 'managers' | 'staff' | 'inactive';

/** Admin › Users: accounts with avatar, role pill and store chips; drawer form; deactivate instead of delete. */
@Component({
  selector: 'ce-users-page',
  imports: [MatIconModule, MatTooltipModule, ...DS, EntityDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <section data-testid="page-admin-users">
      <ce-page title="Users" description="Accounts, roles and store access. Store managers and staff only see their own stores.">
        <ng-container pageActions>
          <button type="button" class="ce-btn ce-btn-primary" (click)="openForm(null)" data-testid="btn-create-user"><mat-icon>person_add</mat-icon> New user</button>
        </ng-container>
        <ce-stat-strip label="User summary">
          <ce-stat-tile variant="strip" id="users-total" label="Users" [value]="all().length" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="users-active" label="Active" [value]="activeCount()" [loading]="busy()" />
          <span class="ce-stat-strip-sep" aria-hidden="true"></span>
          <ce-stat-tile variant="strip" id="users-admins" label="Admins" [value]="count(['SUPER_ADMIN', 'ADMIN'])" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="users-managers" label="Managers" [value]="count(['REGIONAL_MANAGER', 'STORE_MANAGER'])" [loading]="busy()" />
          <ce-stat-tile variant="strip" id="users-staff" label="Staff & auditors" [value]="count(['STAFF', 'AUDITOR'])" [loading]="busy()" />
        </ce-stat-strip>

        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        } @else {
          <div class="trax-panel ops-min0">
            <ce-tabs class="ops-scroll-tabs" [tabs]="tabs()" [value]="tab()" (valueChange)="tab.set($any($event))" label="Filter users" />
            <ce-table
              [rows]="rows()"
              [columns]="cols"
              [loading]="busy()"
              title="User list"
              [searchable]="true"
              searchPlaceholder="Search by name, email or store"
              searchTestId="input-search"
              [columnChooser]="true"
              testId="table-admin-users"
              [rowTestId]="rowId"
              [rowClass]="rowClass"
              [bare]="true"
              [defaultSort]="{ key: 'name', dir: 'asc' }"
              sortStart="asc"
              emptyIcon="group"
              [emptyTitle]="tab() === 'all' ? 'No users yet' : 'No users in this group'"
            >
              <button tableActions type="button" class="ce-btn ce-btn-secondary ce-icon-btn" (click)="data.reload()" matTooltip="Refresh" aria-label="Refresh" data-testid="btn-refresh"><mat-icon>refresh</mat-icon></button>
            <ng-template ceCell="name" let-u>
                <span class="ops-user">
                  <ce-avatar [name]="u.name" [size]="32" />
                  <span class="ops-user-text">
                    <span class="ops-user-name" [title]="u.name">{{ u.name }}</span>
                    <span class="ops-user-mail" [title]="u.email">{{ u.email }}</span>
                  </span>
                </span>
              </ng-template>
              <ng-template ceCell="role" let-u>
                <ce-pill [value]="u.role" [tone]="roleTone(u.role)" [label]="humanize(u.role)" [dot]="false" size="sm" />
              </ng-template>
              <ng-template ceCell="stores" let-u>
                @let names = storeNames(u);
                @if (!names.length && isAllStores(u)) {
                  <span class="ops-chip all">All stores</span>
                } @else if (!names.length) {
                  <span class="dash">--</span>
                } @else {
                  <span class="ops-chips" [title]="names.join(', ')">
                    @for (n of names.slice(0, 2); track n; let last = $last) {
                      <span class="ops-chip">{{ n }}</span>@if (!last || names.length > 2) {<span class="ops-sr">, </span>}
                    }
                    @if (names.length > 2) {
                      <span class="ops-chip more">+{{ names.length - 2 }}</span>
                    }
                  </span>
                }
              </ng-template>
              <ng-template ceCell="isActive" let-u>
                <ce-pill [value]="u.isActive ? 'YES' : 'NO'" [label]="u.isActive ? 'Active' : 'Deactivated'" size="sm" />
              </ng-template>
              <ng-template ceCell="actions" let-u>
                <span class="ops-row-actions">
                  <button type="button" class="ce-icon-btn sm" matTooltip="Edit" aria-label="Edit user" (click)="openForm(u)" data-testid="btn-edit"><mat-icon>edit</mat-icon></button>
                  <button type="button" class="ce-icon-btn sm" [matTooltip]="isMe(u) ? 'You cannot deactivate yourself' : 'Deactivate'" aria-label="Deactivate user" [disabled]="!u.isActive || isMe(u)" (click)="remove(u)" data-testid="btn-delete"><mat-icon>person_off</mat-icon></button>
                </span>
              </ng-template>
            </ce-table>
          </div>
        }
      </ce-page>

      <ce-entity-drawer
        [(open)]="formOpen"
        entity="user"
        [title]="editing() ? 'Edit user' : 'New user'"
        [subtitle]="editing() ? editing()!.email : 'They sign in with this email and the initial password'"
        [fields]="fields"
        [value]="editing()"
        [submit]="submit"
        [mapServerError]="mapError"
        [submitLabel]="editing() ? 'Save changes' : 'Create user'"
        (saved)="onSaved()"
      />
    </section>
  `,
})
export class UsersPage {
  protected readonly opsCss = useOpsStyles();
  private readonly lookup = inject(LookupService);
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  readonly humanize = humanize;
  readonly data = loadOn(() => ({}), () => this.api.get<User[]>('/users'));
  readonly all = computed(() => this.data.data() ?? []);
  readonly busy = computed(() => this.data.loading() && !this.data.data());
  readonly activeCount = computed(() => this.all().filter((u) => u.isActive).length);
  readonly tab = signal<UserTab>('all');
  readonly formOpen = signal(false);
  readonly editing = signal<User | null>(null);
  readonly rowId = (u: User) => `row-user-${u.id}`;
  readonly rowClass = (u: User) => (u.isActive ? null : 'ops-dim');

  readonly rows = computed(() => {
    const t = this.tab();
    return this.all().filter((u) =>
      t === 'all' ? true : t === 'inactive' ? !u.isActive : t === 'managers' ? ['REGIONAL_MANAGER', 'STORE_MANAGER'].includes(u.role) && u.isActive : ['STAFF', 'AUDITOR'].includes(u.role) && u.isActive,
    );
  });
  readonly tabs = computed<TabItem[]>(() => {
    const a = this.all();
    return [
      { value: 'all', label: 'All users', count: a.length },
      { value: 'managers', label: 'Managers', count: a.filter((u) => u.isActive && ['REGIONAL_MANAGER', 'STORE_MANAGER'].includes(u.role)).length },
      { value: 'staff', label: 'Staff & auditors', count: a.filter((u) => u.isActive && ['STAFF', 'AUDITOR'].includes(u.role)).length },
      { value: 'inactive', label: 'Deactivated', count: a.filter((u) => !u.isActive).length },
    ];
  });

  readonly cols: CeColumn<User>[] = [
    { key: 'name', header: 'User', sortable: true, locked: true, value: (u) => u.name },
    { key: 'email', header: 'Email', hidden: true },
    { key: 'role', header: 'Role', value: (u) => humanize(u.role), sortable: true },
    { key: 'stores', header: 'Stores', value: (u) => (this.isAllStores(u) ? 'All stores' : this.storeNames(u).join(', ')) },
    { key: 'isActive', header: 'Status', value: (u) => (u.isActive ? 'Active' : 'Deactivated'), sortable: true },
    { key: 'createdAt', header: 'Created', format: (v) => isoDay(v), sortable: true },
    { key: 'actions', header: 'Action', type: 'actions', value: () => '', align: 'right', locked: true },
  ];

  readonly fields: AdminField[] = [
    { key: 'name', label: 'Full name', type: 'text', required: true, placeholder: 'Priya Raman', full: true },
    { key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'name@congruence.in', full: true },
    {
      key: 'role',
      label: 'Role',
      type: 'select',
      required: true,
      // only a SUPER_ADMIN may create another SUPER_ADMIN
      options: enumOptions(
        ROLES.filter((r) => r !== 'SUPER_ADMIN' || this.auth.role() === 'SUPER_ADMIN'),
        humanize,
      ),
      default: 'STAFF',
    },
    { key: 'password', label: 'Initial password', type: 'password', required: true, createOnly: true, hint: 'At least 8 characters; they can change it after signing in' },
    {
      key: 'storeIds',
      label: 'Stores',
      type: 'multiselect',
      options: () => this.lookup.stores().map((s) => ({ value: s.id, label: s.name })),
      visible: (v) => v['role'] !== 'SUPER_ADMIN' && v['role'] !== 'ADMIN',
      validate: (v, all) => (['STORE_MANAGER', 'STAFF'].includes(String(all['role'])) && !(v as unknown[] | null)?.length ? 'Pick at least one store' : null),
      helper: 'Admins always see every store',
      full: true,
    },
    { key: 'isActive', label: 'Active — can sign in', type: 'checkbox', default: true },
  ];
  readonly mapError = (status: number, msg: string) => (status === 409 || /email/i.test(msg) ? { field: 'email', message: status === 409 ? 'A user with this email already exists' : msg } : null);

  readonly submit = (v: Record<string, unknown>) => {
    const u = this.editing();
    return u ? this.api.patch(`/users/${u.id}`, v, silent()) : this.api.post('/users', v, null, silent());
  };

  constructor() {
    this.lookup.loadStores().subscribe();
  }

  count(roles: Role[]): number {
    return this.all().filter((u) => u.isActive && roles.includes(u.role)).length;
  }
  roleTone(r: Role): Tone {
    return ROLE_TONES[r] ?? 'neutral';
  }
  isAllStores(u: User): boolean {
    return ALL_STORE_ROLES.includes(u.role);
  }
  storeNames(u: User): string[] {
    return userStoreNames(u, this.lookup.storeName());
  }
  isMe(u: User): boolean {
    return this.auth.user()?.id === u.id;
  }

  openForm(u: User | null): void {
    this.editing.set(u);
    this.formOpen.set(true);
  }

  onSaved(): void {
    this.ui.toast(this.editing() ? 'Saved' : 'Created');
    this.data.reload();
    this.lookup.loadUsers(true);
  }

  remove(u: User): void {
    this.ui.confirm({ title: 'Deactivate user?', message: `Deactivate "${u.name}"? They can no longer sign in. Their history is kept and you can re-activate them later.`, confirmText: 'Deactivate', danger: true }).subscribe(() =>
      this.api.delete(`/users/${u.id}`).subscribe(() => {
        this.ui.toast('Deactivated');
        this.data.reload();
      }),
    );
  }
}
