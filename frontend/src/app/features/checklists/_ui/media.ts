import { DestroyRef, Signal, inject, signal } from '@angular/core';

/** Reactive `matchMedia` (injection context). False when matchMedia is unavailable (tests/SSR). */
export function mediaSignal(query: string): Signal<boolean> {
  const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null;
  const s = signal(!!mql?.matches);
  if (mql) {
    const on = (e: MediaQueryListEvent) => s.set(e.matches);
    mql.addEventListener('change', on);
    inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', on));
  }
  return s.asReadonly();
}
