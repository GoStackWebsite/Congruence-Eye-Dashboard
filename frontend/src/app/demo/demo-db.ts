/* eslint-disable @typescript-eslint/no-explicit-any */
import { PresetKey, dataUrlToBlob, daysBetween, localIsoDate, shiftDeep } from './demo-utils';

/** Captured bundles live next to index.html under demo-data/ (relative URLs only). */
const DATA_BASE = 'demo-data/';

export interface DemoMeta {
  captureDate: string;
  capturedAt?: string;
  presets: Record<PresetKey, { from: string; to: string }>;
  storeIds: number[];
  videos: string[];
}

type Any = any;

/**
 * In-memory "database" for the online demo. Bundles are fetched lazily per area, every captured
 * date/timestamp is shifted by (today − captureDate) so the demo always looks current, and
 * collections are mutable for the session (reset on reload).
 */
export class DemoDb {
  private cache = new Map<string, Promise<Any>>();
  meta!: DemoMeta;
  shiftDays = 0;
  /** Exact time elapsed since capture, never negative (applied to ISO timestamps). */
  shiftMs = 0;
  today = localIsoDate();

  // collections
  master!: Any;
  roles!: Any;
  private opsLoaded?: Promise<void>;
  private traxLoaded?: Promise<void>;
  private aiLoaded?: Promise<void>;
  private miscLoaded?: Promise<void>;
  ops!: Any;
  trax!: Any;
  ai!: Any;
  misc!: Any;
  notifications = new Map<number, Any[]>();
  passwords = new Map<number, string>();
  aiCheckCount = 0;
  lastAiByPhoto = new Map<string, Any>();
  uploadsByFile = new Map<string, string>();
  /** Audit entries written before misc.json was loaded (oldest first). */
  pendingAudit: Any[] = [];

  private ready?: Promise<void>;
  private mediaIndex?: Promise<{ packs: number; files: Record<string, number>; fallback: Record<string, string> }>;
  private packs = new Map<number, Promise<Record<string, string>>>();
  private objectUrls = new Map<string, string>();

  constructor(private readonly fetchJson: (url: string) => Promise<Any> = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url} → ${r.status}`))))) {}

  private load(name: string): Promise<Any> {
    if (!this.cache.has(name)) this.cache.set(name, this.fetchJson(DATA_BASE + name));
    return this.cache.get(name)!;
  }

  /** Loads a bundle and shifts its dates to "now". */
  private async loadShifted(name: string): Promise<Any> {
    await this.init();
    return shiftDeep(await this.load(name), this.shiftDays, this.shiftMs);
  }

  init(): Promise<void> {
    this.ready ??= (async () => {
      this.meta = await this.load('meta.json');
      this.today = localIsoDate();
      this.shiftDays = daysBetween(this.meta.captureDate, this.today);
      const elapsed = Date.now() - Date.parse(this.meta.capturedAt ?? '');
      this.shiftMs = Number.isFinite(elapsed) ? Math.max(0, elapsed) : this.shiftDays * 86_400_000;
      this.master = shiftDeep(await this.load('master.json'), this.shiftDays, this.shiftMs);
      this.roles = shiftDeep(await this.load('roles.json'), this.shiftDays, this.shiftMs);
      for (const r of Object.values<Any>(this.roles)) this.notifications.set(r.userId, r.notifications ?? []);
    })();
    return this.ready;
  }

  ensureOps(): Promise<void> {
    return (this.opsLoaded ??= this.loadShifted('ops.json').then((o) => void (this.ops = o)));
  }
  ensureTrax(): Promise<void> {
    return (this.traxLoaded ??= this.loadShifted('trax.json').then((t) => {
      t.drafts = new Map<number, Any[]>(Object.entries(t.draftAssignments ?? {}).map(([k, v]) => [Number(k), v as Any[]]));
      t.answers = new Map<number, Any[]>(Object.entries(t.submissionAnswers ?? {}).map(([k, v]) => [Number(k), v as Any[]]));
      this.trax = t;
    }));
  }
  ensureAi(): Promise<void> {
    return (this.aiLoaded ??= this.loadShifted('ai.json').then((a) => void (this.ai = a)));
  }
  ensureMisc(): Promise<void> {
    return (this.miscLoaded ??= this.loadShifted('misc.json').then((m) => {
      // changes audited before the audit log was first opened
      for (const e of this.pendingAudit) m.auditLogs.unshift({ ...e, id: nextId(m.auditLogs) });
      this.pendingAudit = [];
      this.misc = m;
    }));
  }

  analytics(preset: PresetKey): Promise<Any> {
    return this.cachedShift(`analytics-${preset}.json`);
  }
  heatmaps(): Promise<Any> {
    return this.cachedShift('heatmap.json');
  }
  journeys(): Promise<Any> {
    return this.cachedShift('journey.json');
  }
  liveAndInfra(): Promise<Any> {
    return this.cachedShift('live.json');
  }

  private shifted = new Map<string, Promise<Any>>();
  private cachedShift(name: string): Promise<Any> {
    if (!this.shifted.has(name)) this.shifted.set(name, this.loadShifted(name));
    return this.shifted.get(name)!;
  }

  // ---------------------------------------------------------------- media
  private index() {
    return (this.mediaIndex ??= this.fetchJson(DATA_BASE + 'media/index.json'));
  }
  private pack(n: number) {
    if (!this.packs.has(n)) this.packs.set(n, this.fetchJson(DATA_BASE + `media/pack-${n}.json`));
    return this.packs.get(n)!;
  }

  /** Returns a blob for a packed media key (an 'uploads/...' path or 'snapshot/camera-<id>'). */
  async mediaBlob(key: string): Promise<Blob | null> {
    const idx = await this.index();
    const real = idx.files[key] !== undefined ? key : idx.fallback[key];
    if (real === undefined || idx.files[real] === undefined) return null;
    const p = await this.pack(idx.files[real]);
    return p[real] ? dataUrlToBlob(p[real]) : null;
  }

  /** A packed image of the store (for simulated probe snapshots): one of its snapshots, else any image. */
  async imageFor(storeId: number, seed = 0): Promise<string | null> {
    const idx = await this.index().catch(() => null);
    if (!idx) return null;
    const keys = Object.keys(idx.files).filter((k) => k.startsWith('uploads/'));
    const own = keys.filter((x) => x.startsWith(`uploads/snapshots/${storeId}/`));
    if (own.length) return own[Math.abs(seed) % own.length];
    return keys.find((x) => x.startsWith(`uploads/snapshots/${storeId}/`)) ?? keys.find((x) => /\.(jpe?g|png)$/i.test(x)) ?? null;
  }

  async mediaUrl(path: string): Promise<string | null> {
    if (this.objectUrls.has(path)) return this.objectUrls.get(path)!;
    const blob = await this.mediaBlob(path);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(path, url);
    return url;
  }

  /**
   * Rewrites every 'uploads/...' string in a response: videos → relative demo-data URL,
   * images → blob: URLs from the media packs (or a same-store fallback image).
   */
  async rewriteMedia<T>(body: T): Promise<T> {
    const paths = new Set<string>();
    const collect = (v: unknown) => {
      if (typeof v === 'string') {
        if (v.startsWith('uploads/')) paths.add(v);
      } else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') Object.values(v as object).forEach(collect);
    };
    collect(body);
    if (!paths.size) return body;
    const map = new Map<string, string>();
    await Promise.all(
      [...paths].map(async (p) => {
        if (/\.(mp4|webm|mov)$/i.test(p)) {
          const known = this.meta.videos.includes(p) ? p : this.meta.videos[0];
          if (known) map.set(p, DATA_BASE + known);
          return;
        }
        const url = await this.mediaUrl(p);
        if (url) map.set(p, url);
      }),
    );
    const walk = (v: unknown): unknown => {
      if (typeof v === 'string') return map.get(v) ?? v;
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        const o: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = walk(x);
        return o;
      }
      return v;
    };
    return walk(body) as T;
  }
}

export function nextId(list: { id: number }[]): number {
  return list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
}
