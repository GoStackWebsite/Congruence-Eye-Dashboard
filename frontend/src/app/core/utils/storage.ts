/** localStorage access that never throws (private mode, blocked storage, SSR, tests). */
export const safeStorage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  getString(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    try {
      globalThis.localStorage?.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
