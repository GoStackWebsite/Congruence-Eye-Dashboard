import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { NAV, NavItem, NavModule, navFor, navMatch } from '../auth/permissions';

export interface Crumb {
  label: string;
  link?: string | null;
}

interface RouteMeta {
  url: string;
  /** Route data `crumb`: label of a detail page appended after the nav item (e.g. "Edit rule"). */
  crumb: string | null;
  /** Route data `navId`: nav item a detail route belongs to (when its URL doesn't start with the item's route). */
  navId: string | null;
  /** Route data `filter`: the global filter applies to this page. */
  filter: boolean;
}

function readMeta(root: ActivatedRouteSnapshot, url: string): RouteMeta {
  let r: ActivatedRouteSnapshot | null = root;
  const meta: RouteMeta = { url, crumb: null, navId: null, filter: false };
  while (r) {
    const d = r.data ?? {};
    if (d['crumb'] !== undefined) meta.crumb = d['crumb'];
    if (d['navId'] !== undefined) meta.navId = d['navId'];
    if (d['filter'] !== undefined) meta.filter = !!d['filter'];
    r = r.firstChild;
  }
  return meta;
}

/** Breadcrumbs (Module › Group › Page › detail) and the active rail module, derived from the nav + route data. */
@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly meta = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => readMeta(this.router.routerState.snapshot.root, this.router.url)),
    ),
    { initialValue: { url: '/', crumb: null, navId: null, filter: false } as RouteMeta },
  );

  readonly modules = computed<NavModule[]>(() => navFor(this.auth.role()));

  readonly match = computed(() => {
    const m = this.meta();
    const mods = this.modules();
    if (m.navId) {
      for (const module of mods.length ? mods : NAV)
        for (const group of module.groups) {
          const item = group.items.find((i: NavItem) => i.id === m.navId);
          if (item) return { module, group, item };
        }
    }
    return navMatch(mods, m.url);
  });

  readonly crumbs = computed<Crumb[]>(() => {
    const hit = this.match();
    const m = this.meta();
    const out: Crumb[] = [];
    if (hit) {
      out.push({ label: hit.module.label, link: hit.module.items[0]?.route ?? null });
      if (hit.group.label && hit.group.label !== hit.module.label && hit.group.label !== hit.item.label && hit.module.groups.length > 1) out.push({ label: hit.group.label, link: null });
      out.push({ label: hit.item.label, link: m.crumb ? hit.item.route : null });
    }
    if (m.crumb) out.push({ label: m.crumb, link: null });
    if (!out.length) out.push({ label: 'Not found', link: null });
    return out;
  });
}
