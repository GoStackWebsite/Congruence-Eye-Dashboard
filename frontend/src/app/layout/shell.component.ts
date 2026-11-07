import { BreakpointObserver } from '@angular/cdk/layout';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../core/auth/auth.service';
import { NavItem, NavModule } from '../core/auth/permissions';
import { BreadcrumbService } from '../core/services/breadcrumb.service';
import { FilterService } from '../core/services/filter.service';
import { LookupService } from '../core/services/lookup.service';
import { NavCountsService } from '../core/services/nav-counts.service';
import { NotificationService } from '../core/services/notification.service';
import { ThemeService } from '../core/services/theme.service';
import { humanize } from '../core/utils/format';
import { safeStorage } from '../core/utils/storage';
import { AvatarComponent } from '../shared/ds/avatar.component';
import { ChangePasswordDialogComponent } from './change-password-dialog.component';
import { GlobalFilterComponent } from './global-filter.component';
import { NotificationBellComponent } from './notification-bell.component';
import { BrandMarkComponent } from './brand-mark.component';

interface TabbarItem {
  id: string;
  label: string;
  icon: string;
  route?: string;
  exact?: boolean;
}

/**
 * App shell (DESIGN_SYSTEM.md "Shell"): 64px navy icon rail + collapsible 224px module panel, 56px top bar with
 * breadcrumbs, global filter, refresh, bell and user menu. Below 1024px the rail+panel become a slide-over menu and
 * the filter collapses into a sheet; below 768px a bottom tab bar appears.
 */
@Component({
  selector: 'ce-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    DatePipe,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
    GlobalFilterComponent,
    NotificationBellComponent,
    AvatarComponent,
    BrandMarkComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app-shell" [class.handset]="isHandset()" [class.phone]="isPhone()" [class.panel-open]="panelVisible()" [class.panel-overlay]="panelOverlay()">
      @if (isHandset() && mobileOpen()) {
        <div class="nav-backdrop" (click)="mobileOpen.set(false)" aria-hidden="true"></div>
      }
      <div class="nav-wrap" [class.open]="mobileOpen()" data-testid="sidenav">
        <nav class="rail" aria-label="Modules">
          <a class="rail-logo" routerLink="/" data-testid="brand" aria-label="Congruence Eye — home" (click)="mobileOpen.set(false)">
            <ce-brand-mark [size]="36" />
          </a>
          <div class="rail-items">
            @for (m of modules(); track m.id) {
              <button
                type="button"
                class="rail-item"
                [class.active]="m.id === activeModuleId()"
                [class.viewing]="m.id === viewModuleId() && panelVisible()"
                [attr.data-testid]="'rail-' + m.id"
                [attr.aria-label]="m.label"
                [attr.aria-current]="m.id === activeModuleId() ? 'page' : null"
                [matTooltip]="m.label"
                matTooltipPosition="right"
                [matTooltipDisabled]="isHandset()"
                (click)="openModule(m)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">{{ m.icon }}</span>
                @if (isHandset()) {
                  <span class="rail-label">{{ m.label }}</span>
                }
                @if (moduleBadge(m)) {
                  <span class="rail-dot" aria-hidden="true"></span>
                }
              </button>
            }
          </div>
          <div class="rail-bottom">
            <button type="button" class="rail-item" [matMenuTriggerFor]="helpMenu" matTooltip="Help" matTooltipPosition="right" aria-label="Help" data-testid="btn-help">
              <span class="material-symbols-outlined" aria-hidden="true">help</span>
            </button>
            <button type="button" class="rail-avatar" [matMenuTriggerFor]="userMenu" [attr.aria-label]="'Account: ' + (auth.user()?.name ?? '')" data-testid="rail-user">
              <ce-avatar [name]="auth.user()?.name" [size]="32" />
            </button>
          </div>
        </nav>

        <aside class="module-panel" [attr.aria-label]="viewModule()?.label + ' pages'" [attr.aria-hidden]="!panelVisible() && !isHandset()">
          @if (viewModule(); as vm) {
            <div class="mp-head">
              <div class="mp-title">{{ vm.label }}</div>
              @if (!isHandset()) {
                <button type="button" class="ce-icon-btn sm" (click)="togglePanel()" aria-label="Collapse menu" matTooltip="Collapse menu">
                  <mat-icon>left_panel_close</mat-icon>
                </button>
              } @else {
                <button type="button" class="ce-icon-btn sm" (click)="mobileOpen.set(false)" aria-label="Close menu" data-testid="btn-close-menu">
                  <mat-icon>close</mat-icon>
                </button>
              }
            </div>
            <div class="mp-scroll">
              @for (g of vm.groups; track g.id) {
                <div class="mp-group" [attr.data-testid]="'nav-group-' + g.id">
                  @if (vm.groups.length > 1) {
                    <div class="mp-group-label">{{ g.label }}</div>
                  }
                  @for (item of g.items; track item.id) {
                    <a
                      class="mp-link"
                      [routerLink]="item.route"
                      routerLinkActive="active"
                      [routerLinkActiveOptions]="{ exact: !!item.exact }"
                      [attr.data-testid]="'nav-' + item.id"
                      (click)="onNavigate()"
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">{{ item.icon }}</span>
                      <span class="mp-label">{{ item.label }}</span>
                      @if (badge(item); as n) {
                        <span class="mp-badge" [class.alert]="item.badge === 'alerts' || item.badge === 'overdue'" [attr.data-testid]="'nav-badge-' + item.id" [attr.aria-label]="n + ' ' + badgeLabel(item)">{{ n > 99 ? '99+' : n }}</span>
                      }
                    </a>
                  }
                </div>
              }
              @if (vm.id === 'home' && shortcuts().length) {
                <div class="mp-group" data-testid="nav-group-shortcuts">
                  <div class="mp-group-label">Shortcuts</div>
                  @for (item of shortcuts(); track item.id) {
                    <a class="mp-link" [routerLink]="item.route" [attr.data-testid]="'shortcut-' + item.id" (click)="onNavigate()">
                      <span class="material-symbols-outlined" aria-hidden="true">{{ item.icon }}</span>
                      <span class="mp-label">{{ item.label }}</span>
                      @if (badge(item); as n) {
                        <span class="mp-badge" [class.alert]="item.badge === 'alerts' || item.badge === 'overdue'">{{ n > 99 ? '99+' : n }}</span>
                      }
                    </a>
                  }
                </div>
              }
            </div>
            @if (demo) {
              <div class="mp-foot">
                <span class="material-symbols-outlined" aria-hidden="true">science</span>
                <span>Demo data · resets on reload</span>
              </div>
            }
          }
        </aside>
      </div>

      <div class="app-main">
        <header class="topbar" data-testid="topbar">
          @if (isHandset()) {
            <button type="button" class="ce-icon-btn" (click)="mobileOpen.set(true)" aria-label="Open menu" data-testid="btn-menu"><mat-icon>menu</mat-icon></button>
          } @else if (!panelVisible()) {
            <button type="button" class="ce-icon-btn" (click)="togglePanel()" aria-label="Expand menu" matTooltip="Expand menu" data-testid="btn-collapse-nav">
              <mat-icon>left_panel_open</mat-icon>
            </button>
          }
          <nav class="crumbs" aria-label="Breadcrumb" data-testid="breadcrumbs">
            @for (c of crumbs.crumbs(); track $index; let last = $last) {
              @if (c.link && !last) {
                <a [routerLink]="c.link" class="crumb">{{ c.label }}</a>
              } @else {
                <span class="crumb" [class.current]="last" [attr.aria-current]="last ? 'page' : null">{{ c.label }}</span>
              }
              @if (!last) {
                <mat-icon class="crumb-sep" aria-hidden="true">chevron_right</mat-icon>
              }
            }
          </nav>
          <span class="spacer"></span>
          @if (showFilter()) {
            @if (!isHandset()) {
              <ce-global-filter />
            } @else {
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" [class.on]="filtersOpen()" (click)="filtersOpen.set(!filtersOpen())" data-testid="btn-filters" [attr.aria-expanded]="filtersOpen()">
                <mat-icon>tune</mat-icon><span class="hide-xs">Filters</span>
              </button>
            }
          }
          <div class="tb-icons">
            <button
              type="button"
              class="ce-icon-btn"
              (click)="theme.toggle()"
              [matTooltip]="theme.isDark() ? 'Light theme' : 'Dark theme'"
              data-testid="btn-theme-toggle"
              [attr.aria-label]="theme.isDark() ? 'Switch to light theme' : 'Switch to dark theme'"
            >
              <mat-icon>{{ theme.isDark() ? 'light_mode' : 'dark_mode' }}</mat-icon>
            </button>
            <ce-notification-bell />
            <button type="button" class="user-btn" [matMenuTriggerFor]="userMenu" data-testid="user-menu" [attr.aria-label]="'Account menu for ' + (auth.user()?.name ?? '')">
              <ce-avatar [name]="auth.user()?.name" [size]="30" />
              <span class="user-meta">
                <span class="user-name">{{ auth.user()?.name }}</span>
                <span class="user-role-sm">{{ roleLabel() }}</span>
              </span>
              <mat-icon class="user-caret">expand_more</mat-icon>
            </button>
          </div>
        </header>
        @if (isHandset() && showFilter() && filtersOpen()) {
          <div class="filter-sheet" data-testid="filter-sheet">
            <ce-global-filter [stacked]="true" />
            <button type="button" class="ce-btn ce-btn-primary" (click)="filtersOpen.set(false)" data-testid="btn-filters-done">Apply</button>
          </div>
        }
        @if (!online()) {
          <div class="offline-banner" role="status" aria-live="polite" data-testid="offline-banner">
            <mat-icon aria-hidden="true">cloud_off</mat-icon>
            <span>You're offline. Showing the last loaded data — changes can't be saved until the connection is back.</span>
          </div>
        }
        @if (demo) {
          <div class="demo-banner" role="status" data-testid="demo-banner">
            <mat-icon aria-hidden="true">science</mat-icon>
            <span><b>Online demo</b> · sample data for 6 Congruence stores · changes reset on reload</span>
          </div>
        }
        <main class="main" id="main">
          <router-outlet />
        </main>
        @if (isPhone()) {
          <nav class="tabbar" aria-label="Quick navigation" data-testid="tabbar">
            @for (t of tabbar(); track t.id) {
              @if (t.route) {
                <a class="tab" [routerLink]="t.route" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!t.exact }" [attr.data-testid]="'tab-' + t.id">
                  <span class="material-symbols-outlined" aria-hidden="true">{{ t.icon }}</span>
                  <span>{{ t.label }}</span>
                </a>
              } @else {
                <button type="button" class="tab" (click)="mobileOpen.set(true)" [attr.data-testid]="'tab-' + t.id">
                  <span class="material-symbols-outlined" aria-hidden="true">{{ t.icon }}</span>
                  <span>{{ t.label }}</span>
                </button>
              }
            }
          </nav>
        }
      </div>
    </div>

    <mat-menu #userMenu="matMenu" xPosition="before" class="user-menu-panel">
      <div class="user-card" (click)="$event.stopPropagation()">
        <ce-avatar [name]="auth.user()?.name" [size]="40" />
        <div class="user-card-text">
          <div class="strong ellipsis">{{ auth.user()?.name }}</div>
          <div class="small muted ellipsis" data-testid="user-email">{{ auth.user()?.email }}</div>
          <div class="user-role-pill" data-testid="user-role">{{ roleLabel() }}</div>
        </div>
      </div>
      <mat-divider />
      <button mat-menu-item (click)="theme.toggle()"><mat-icon>{{ theme.isDark() ? 'light_mode' : 'dark_mode' }}</mat-icon> {{ theme.isDark() ? 'Light theme' : 'Dark theme' }}</button>
      <button mat-menu-item (click)="changePassword()" data-testid="btn-change-password"><mat-icon>key</mat-icon> Change password</button>
      <mat-divider />
      <button mat-menu-item (click)="logout()" data-testid="btn-logout"><mat-icon>logout</mat-icon> Sign out</button>
    </mat-menu>
    <mat-menu #helpMenu="matMenu" xPosition="after" class="help-menu-panel">
      <div class="help-card" (click)="$event.stopPropagation()">
        <div class="strong">Need help?</div>
        <div class="small muted">Congruence IT service desk · Mon–Sat, 9 am – 9 pm</div>
        <div class="small">support&#64;congruence.in</div>
        @if (filter.lastRefreshed(); as t) {
          <div class="caption">Data last refreshed at {{ t | date: 'h:mm a' }}</div>
        }
      </div>
    </mat-menu>
  `,
})
export class ShellComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly crumbs = inject(BreadcrumbService);
  protected readonly filter = inject(FilterService);
  private readonly lookup = inject(LookupService);
  private readonly notifications = inject(NotificationService);
  private readonly counts = inject(NavCountsService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly demo = environment.demo;
  private readonly bp = inject(BreakpointObserver);
  protected readonly isHandset = toSignal(this.bp.observe('(max-width: 1023.98px)').pipe(map((r) => r.matches)), { initialValue: false });
  protected readonly isPhone = toSignal(this.bp.observe('(max-width: 767.98px)').pipe(map((r) => r.matches)), { initialValue: false });
  protected readonly isNarrowDesktop = toSignal(this.bp.observe('(max-width: 1279.98px)').pipe(map((r) => r.matches)), { initialValue: false });

  /** navigator.onLine, kept live by the window online / offline events. */
  protected readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  protected readonly mobileOpen = signal(false);
  protected readonly filtersOpen = signal(false);
  /** Desktop: panel pinned open (persisted). Narrow desktop: panel is a flyout over the content. */
  protected readonly panelPinned = signal(!safeStorage.get<boolean>('ce.navCollapsed', false));
  protected readonly flyoutOpen = signal(false);
  protected readonly panelOverlay = computed(() => !this.isHandset() && this.isNarrowDesktop());
  protected readonly panelVisible = computed(() => (this.isHandset() ? true : this.panelOverlay() ? this.flyoutOpen() : this.panelPinned()));

  protected readonly modules = this.crumbs.modules;
  protected readonly activeModuleId = computed(() => this.crumbs.match()?.module.id ?? null);
  protected readonly viewModuleId = signal<string | null>(null);
  protected readonly viewModule = computed<NavModule | null>(() => {
    const mods = this.modules();
    const id = this.viewModuleId() ?? this.activeModuleId();
    return mods.find((m) => m.id === id) ?? mods[0] ?? null;
  });
  /** Home panel shortcuts to the pages HQ opens every morning (role-filtered; not part of the nav ids). */
  protected readonly shortcuts = computed<NavItem[]>(() => {
    const labels: Record<string, string> = {
      alerts: 'Open alerts',
      'checklist-dashboard': 'Checklist dashboard',
      'ai-summary': 'AI Manager summary',
      live: 'Live view',
      reports: 'Reports & exports',
    };
    const all = this.modules().flatMap((m) => m.items);
    return Object.keys(labels)
      .map((id) => all.find((i) => i.id === id))
      .filter((i): i is NavItem => !!i)
      .map((i) => ({ ...i, label: labels[i.id] }));
  });
  protected readonly showFilter = computed(() => this.crumbs.meta().filter);
  protected readonly roleLabel = computed(() => humanize(this.auth.role()));

  protected readonly tabbar = computed<TabbarItem[]>(() => {
    const out: TabbarItem[] = [];
    if (this.auth.can('dashboard')) out.push({ id: 'home', label: 'Home', icon: 'home', route: '/dashboard' });
    out.push({ id: 'checklists', label: 'Checklists', icon: 'fact_check', route: '/checklists/assignments' });
    out.push({ id: 'tasks', label: 'Tasks', icon: 'task_alt', route: '/tasks' });
    if (this.auth.can('alerts')) out.push({ id: 'alerts', label: 'Alerts', icon: 'notifications_active', route: '/alerts' });
    else out.push({ id: 'tickets', label: 'Tickets', icon: 'confirmation_number', route: '/tickets' });
    out.push({ id: 'more', label: 'More', icon: 'menu' });
    return out;
  });

  constructor() {
    // the panel follows navigation (unless the user is browsing another module's pages in it)
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.viewModuleId.set(null);
        this.mobileOpen.set(false);
        this.flyoutOpen.set(false);
        this.counts.refresh();
      });
  }

  @HostListener('window:offline')
  onOffline(): void {
    this.online.set(false);
  }

  @HostListener('window:online')
  onOnline(): void {
    if (this.online()) return;
    this.online.set(true);
    this.snack.open('Back online', undefined, { duration: 2500 });
    this.filter.refresh();
  }

  ngOnInit(): void {
    this.lookup
      .loadStores()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((stores) => this.filter.setAvailableStores(stores.map((s) => s.id)));
    this.lookup.loadRegions();
    this.notifications.start();
    this.counts.start();
    this.destroyRef.onDestroy(() => {
      this.notifications.stop();
      this.counts.stop();
    });
  }

  badge(item: NavItem): number | null {
    if (!item.badge) return null;
    const n = this.counts.counts()[item.badge];
    return n ? n : null;
  }

  badgeLabel(item: NavItem): string {
    return item.badge === 'alerts' ? 'open alerts' : item.badge === 'overdue' ? 'overdue checklists' : 'open tickets';
  }

  moduleBadge(m: NavModule): boolean {
    return m.items.some((i) => (i.badge === 'alerts' || i.badge === 'overdue') && !!this.badge(i));
  }

  openModule(m: NavModule): void {
    const same = (this.viewModuleId() ?? this.activeModuleId()) === m.id;
    this.viewModuleId.set(m.id);
    if (this.isHandset()) return; // slide-over: just show that module's pages
    if (this.panelOverlay()) {
      // narrow desktop: the panel is a flyout listing the module's pages
      this.flyoutOpen.set(!(same && this.flyoutOpen()));
      return;
    }
    if (!this.panelPinned()) this.togglePanel();
    if (m.id !== this.activeModuleId() && m.items[0]) void this.router.navigateByUrl(m.items[0].route);
  }

  onNavigate(): void {
    this.mobileOpen.set(false);
    this.flyoutOpen.set(false);
  }

  togglePanel(): void {
    if (this.panelOverlay()) {
      this.flyoutOpen.update((v) => !v);
      return;
    }
    this.panelPinned.update((v) => !v);
    safeStorage.set('ce.navCollapsed', !this.panelPinned());
  }

  changePassword(): void {
    this.dialog.open(ChangePasswordDialogComponent, { width: '420px', maxWidth: '96vw' });
  }

  logout(): void {
    this.notifications.stop();
    this.counts.stop();
    this.lookup.clear();
    this.auth.logout();
  }
}
