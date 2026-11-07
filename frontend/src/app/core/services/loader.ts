import { DestroyRef, Signal, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { errorMessage } from '../utils/format';

export interface Loadable<T> {
  readonly data: Signal<T | undefined>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<string | null>;
  /** True once the first response (or error) arrived. */
  readonly loaded: Signal<boolean>;
  reload(): void;
  set(value: T | undefined): void;
}

/**
 * Reactive data loader: re-fetches whenever `params()` changes (switchMap cancels
 * stale requests). Returning `null` from params skips the fetch.
 * Must be called in an injection context (field initialiser / constructor).
 */
export function loadOn<P, T>(params: () => P | null, fetch: (p: P) => Observable<T>): Loadable<T> {
  const destroyRef = inject(DestroyRef);
  const data = signal<T | undefined>(undefined);
  const loading = signal(false);
  const error = signal<string | null>(null);
  const loaded = signal(false);
  const tick = signal(0);

  const trigger = computed(() => ({ p: params(), t: tick() }));
  const sub = toObservable(trigger)
    .pipe(
      switchMap(({ p }) => {
        if (p === null || p === undefined) {
          loading.set(false);
          return of({ skip: true as const });
        }
        loading.set(true);
        error.set(null);
        return fetch(p).pipe(
          map((v) => ({ value: v })),
          catchError((e) => of({ err: errorMessage(e) })),
        );
      }),
    )
    .subscribe((r) => {
      if ('value' in r) {
        data.set(r.value as T);
        error.set(null);
      } else if ('err' in r) {
        error.set(r.err ?? 'Error');
      }
      loading.set(false);
      loaded.set(true);
    });
  destroyRef.onDestroy(() => sub.unsubscribe());

  return {
    data: data.asReadonly(),
    loading: loading.asReadonly(),
    error: error.asReadonly(),
    loaded: loaded.asReadonly(),
    reload: () => tick.update((t) => t + 1),
    set: (v) => data.set(v),
  };
}
