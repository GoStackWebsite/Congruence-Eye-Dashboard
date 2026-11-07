import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Permission } from './permissions';

/** Requires a logged-in user; otherwise redirects to /login?returnUrl=… */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.isLoggedIn()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** Only for anonymous users (login page). */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).parseUrl(auth.homeRoute()) : true;
};

/** Role gate based on the PERMISSIONS map; unauthorised users go to their home page. */
export function permissionGuard(permission: Permission): CanActivateFn & CanMatchFn {
  return () => {
    const auth = inject(AuthService);
    if (!auth.isLoggedIn()) return inject(Router).parseUrl('/login');
    if (auth.can(permission)) return true;
    return inject(Router).parseUrl(auth.homeRoute());
  };
}
