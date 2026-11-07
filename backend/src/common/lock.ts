/** Minimal keyed async mutex (serialises pipeline writes; SQLite allows a single writer). */
export class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release: () => void;
    const gate = new Promise<void>((r): void => {
      release = r;
    });
    const tail = prev.then(() => gate);
    this.tails.set(key, tail);
    try {
      await prev.catch((): void => undefined);
      return await fn();
    } finally {
      release!();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
