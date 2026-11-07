import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { Subject, Subscription, catchError, of, timer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { Alert, AppNotification } from '../models/api.models';
import { ApiService, silent } from './api.service';

export type StreamState = 'idle' | 'sse' | 'polling';

/**
 * Notification centre: initial load + Server-Sent Events (`/api/stream?token=`)
 * with `alert`, `notification` and `live` events. If SSE fails, falls back to
 * polling `/api/notifications` every 60 s and retries SSE every 5 minutes.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);

  readonly items = signal<AppNotification[]>([]);
  readonly unreadCount = computed(() => this.items().filter((n) => !n.isRead).length);
  readonly state = signal<StreamState>('idle');

  /** Emits for every SSE `alert` event. */
  readonly alert$ = new Subject<Alert>();
  /** Emits a storeId for every SSE `live` event. */
  readonly live$ = new Subject<number>();

  private es: EventSource | null = null;
  private pollSub: Subscription | null = null;
  private retrySub: Subscription | null = null;

  start(): void {
    this.stop();
    this.load();
    this.connect();
  }

  stop(): void {
    this.es?.close();
    this.es = null;
    this.pollSub?.unsubscribe();
    this.pollSub = null;
    this.retrySub?.unsubscribe();
    this.retrySub = null;
    this.state.set('idle');
  }

  load(): void {
    if (!this.auth.isLoggedIn()) return;
    this.api
      .get<AppNotification[]>('/notifications', null, silent())
      .pipe(catchError(() => of(null)))
      .subscribe((list) => {
        if (list) this.items.set(list);
      });
  }

  markRead(n: AppNotification): void {
    if (n.isRead) return;
    this.items.update((list) => list.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
    this.api.patch(`/notifications/${n.id}/read`, {}, silent()).pipe(catchError(() => of(null))).subscribe();
  }

  markAllRead(): void {
    this.items.update((list) => list.map((x) => ({ ...x, isRead: true })));
    this.api.post('/notifications/read-all', {}, null, silent()).pipe(catchError(() => of(null))).subscribe();
  }

  private connect(): void {
    const token = this.auth.token();
    if (!token) return;
    // the online demo has no server to stream from → polling only
    if (environment.demo || typeof EventSource === 'undefined') {
      this.startPolling();
      return;
    }
    try {
      const url = `${environment.apiBaseUrl}${environment.streamPath}?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      this.es = es;
      es.onopen = () => this.zone.run(() => this.state.set('sse'));
      es.addEventListener('notification', (ev) =>
        this.zone.run(() => {
          const n = this.parse<AppNotification>(ev);
          if (n && typeof n.id === 'number') {
            this.items.update((list) => [n, ...list.filter((x) => x.id !== n.id)].slice(0, 100));
          } else {
            this.load();
          }
        }),
      );
      es.addEventListener('alert', (ev) =>
        this.zone.run(() => {
          const a = this.parse<Alert>(ev);
          if (a) this.alert$.next(a);
          this.load();
        }),
      );
      es.addEventListener('live', (ev) =>
        this.zone.run(() => {
          const d = this.parse<{ storeId: number }>(ev);
          if (d && typeof d.storeId === 'number') this.live$.next(d.storeId);
        }),
      );
      es.onerror = () =>
        this.zone.run(() => {
          // EventSource auto-reconnects while CONNECTING; if it gives up (CLOSED) or never opened, poll instead.
          if (es.readyState === EventSource.CLOSED || this.state() !== 'sse') {
            es.close();
            if (this.es === es) this.es = null;
            this.startPolling();
          }
        });
    } catch {
      this.startPolling();
    }
  }

  private startPolling(): void {
    if (this.pollSub) return;
    this.state.set('polling');
    this.pollSub = timer(environment.notificationPollMs, environment.notificationPollMs).subscribe(() => this.load());
    // periodically retry SSE
    this.retrySub?.unsubscribe();
    this.retrySub = timer(5 * 60_000).subscribe(() => {
      if (!this.auth.isLoggedIn()) return;
      this.pollSub?.unsubscribe();
      this.pollSub = null;
      this.connect();
    });
  }

  private parse<T>(ev: Event): T | null {
    try {
      return JSON.parse((ev as MessageEvent).data) as T;
    } catch {
      return null;
    }
  }
}
