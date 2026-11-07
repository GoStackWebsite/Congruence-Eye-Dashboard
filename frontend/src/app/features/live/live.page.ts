import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { filter, interval } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LiveData } from '../../core/models/api.models';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { NotificationService } from '../../core/services/notification.service';
import { DS } from '../../shared/ds';
import { DateTimePipe, DurationPipe, HumanizePipe } from '../../shared/pipes';
import { SnapshotComponent } from '../../shared/ui/snapshot.component';
import { StorePickerComponent } from '../../shared/ui/store-picker.component';
import { QueueCardComponent } from '../analytics/queue-card.component';

const EVENT_ICON: Record<string, string> = { ENTRY: 'login', EXIT: 'logout', ZONE_ENTER: 'pin_drop', ZONE_EXIT: 'wrong_location' };
/** Space per person used for the occupancy gauge's estimated capacity. */
export const SQFT_PER_PERSON = 25;

/** Semicircle gauge path for 0..1 (SVG arc on a 120×66 box). */
export function gaugeArc(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  const a = Math.PI * (1 - f);
  const x = 60 + 50 * Math.cos(a);
  const y = 60 - 50 * Math.sin(a);
  return `M 10 60 A 50 50 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
}

/** Store Ops › Live view: a control-room page — camera wall, occupancy gauge, live queues, event feed. */
@Component({
  selector: 'ce-live-page',
  imports: [FormsModule, MatIconModule, MatSlideToggleModule, MatTooltipModule, ...DS, StorePickerComponent, SnapshotComponent, QueueCardComponent, DurationPipe, DateTimePipe, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-live">
      <ce-page title="Live view" [description]="data.data() ? 'As of ' + (data.data()!.asOf | dt: 'time') + ' · refreshes every 15 s and on live events' : 'Real-time occupancy, queues and cameras'">
        <span pageBadge class="live-badge" [class.paused]="!auto()"><span class="live-dot"></span>{{ auto() ? 'Live' : 'Paused' }}</span>
        <ng-container pageActions>
          <ce-store-picker [(value)]="storeId" testId="select-live-store" />
          <mat-slide-toggle [ngModel]="auto()" (ngModelChange)="auto.set($event)" data-testid="toggle-live-auto">Auto-refresh</mat-slide-toggle>
          <button type="button" class="ce-btn ce-btn-secondary ce-btn-icon" (click)="refresh()" matTooltip="Refresh now" aria-label="Refresh now" data-testid="btn-live-refresh"><mat-icon>refresh</mat-icon></button>
        </ng-container>

        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="refresh()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        }
        @if (data.data(); as d) {
          @if (offline().length) {
            <ce-info-banner tone="warning" title="Partial data" data-testid="live-offline-banner">
              {{ offline().length }} of {{ d.cameras.length }} cameras offline ({{ offlineNames() }}) — live numbers may be low.
            </ce-info-banner>
          }
          <div class="live-top">
            <ce-card title="Occupancy" icon="groups" subtitle="People in store now" [info]="'Estimated capacity = store area ÷ ' + sqft + ' sq ft per person'" data-testid="live-occupancy-card">
              <div class="gauge">
                <svg viewBox="0 0 120 70" role="img" [attr.aria-label]="'Occupancy ' + d.currentOccupancy + (capacity() ? ' of about ' + capacity() : '')">
                  <path d="M 10 60 A 50 50 0 0 1 110 60" class="g-track" />
                  <path [attr.d]="arc()" class="g-fill" [class.hi]="occFrac() > 0.85" [class.mid]="occFrac() > 0.6 && occFrac() <= 0.85" />
                </svg>
                <div class="g-value">
                  <ce-stat-tile variant="strip" id="live-occupancy" label="Current occupancy" [value]="d.currentOccupancy" />
                  @if (capacity()) {
                    <span class="caption">of ~{{ capacity() }} capacity · {{ occPct() }}</span>
                  }
                </div>
              </div>
            </ce-card>
            <ce-stat-strip class="live-strip" label="Today">
              <ce-stat-tile variant="strip" id="live-today-footfall" label="Today's footfall" [value]="d.todayFootfall" />
              <ce-stat-tile variant="strip" id="live-last-hour" label="Last hour" [value]="d.lastHourFootfall" />
              <ce-stat-tile variant="strip" id="live-transactions" label="Today's transactions" [value]="d.todayTransactions" />
              <ce-stat-tile variant="strip" id="live-conversion" label="Today's conversion" format="pct" [value]="d.todayFootfall ? d.todayConversionPct : null" />
            </ce-stat-strip>
          </div>

          <div class="an-grid-2-1">
            <ce-card title="Cameras" icon="videocam" [subtitle]="onlineCount() + ' of ' + d.cameras.length + ' online'" info="Latest snapshot from each camera; refreshed with the page.">
              <div class="cam-wall" data-testid="live-cameras">
                @for (c of d.cameras; track c.id) {
                  <figure class="cam-tile" [class.offline]="c.status !== 'ONLINE'" [attr.data-testid]="'camera-tile-' + c.id">
                    <div class="media-stage">
                      <ce-snapshot [cameraId]="c.id" [refresh]="tick()" [alt]="c.name" [neverSeen]="!c.lastHeartbeatAt" />
                      <span class="cam-rec" [class.off]="c.status !== 'ONLINE'"><span></span>{{ c.status === 'ONLINE' ? 'LIVE' : c.status === 'OFFLINE' ? 'OFFLINE' : 'UNKNOWN' }}</span>
                    </div>
                    <figcaption>
                      <span class="ellipsis" [title]="c.name">{{ c.name }}</span>
                      <ce-pill [value]="c.status" size="sm" />
                    </figcaption>
                    <div class="cam-hb">{{ c.lastHeartbeatAt ? 'Heartbeat ' + (c.lastHeartbeatAt | dt: 'relative') : 'No heartbeat yet' }}</div>
                  </figure>
                } @empty {
                  <ce-empty-state kind="no-data" icon="videocam_off" title="No cameras" message="Add cameras under Admin › Stores › Cameras." [compact]="true" />
                }
              </div>
            </ce-card>
            <div class="live-side">
              <ce-card title="Queues" icon="queue" subtitle="Billing counters now">
                <div class="queue-cards one-col" data-testid="live-queues">
                  @for (q of d.queues; track q.zoneId) {
                    <ce-queue-card [q]="q" [attr.data-testid]="'queue-card-' + q.zoneId" />
                  } @empty {
                    <ce-empty-state kind="no-data" icon="queue" title="No queue zones configured" [compact]="true" />
                  }
                </div>
              </ce-card>
              <ce-card title="Recent events" icon="bolt" subtitle="Newest first">
                <ul class="event-feed" data-testid="live-events" tabindex="0" aria-label="Recent events">
                  @for (e of d.recentEvents; track $index) {
                    <li>
                      <span class="ev-icon" [class]="'ev-icon ev-' + e.type" aria-hidden="true"><mat-icon>{{ icon(e.type) }}</mat-icon></span>
                      <div class="ev-main">
                        <div class="ev-title">{{ e.type | humanize }}{{ e.zoneName ? ' · ' + e.zoneName : '' }}</div>
                        <div class="ev-meta">
                          {{ e.cameraName ?? cameraName(d, e.cameraId) }}
                          @if (e.gender && e.gender !== 'U') {
                            · {{ e.gender === 'M' ? 'Male' : 'Female' }}
                          }
                          @if (e.ageBand && e.ageBand !== 'U') {
                            · {{ e.ageBand }}
                          }
                          @if (e.dwellSec) {
                            · dwell {{ e.dwellSec | duration }}
                          }
                        </div>
                      </div>
                      <span class="ev-time">{{ e.ts | dt: 'time' }}</span>
                    </li>
                  } @empty {
                    <li class="ev-empty"><ce-empty-state kind="no-data" icon="sensors_off" title="No recent events" [compact]="true" /></li>
                  }
                </ul>
              </ce-card>
            </div>
          </div>
        } @else if (data.loading()) {
          <ce-skeleton kind="tiles" [count]="5" />
          <ce-skeleton kind="chart" height="320px" />
        } @else if (!data.error()) {
          <ce-card><ce-empty-state icon="sensors" title="Select a store" message="Pick a store to watch its cameras, queues and events live." /></ce-card>
        }
      </ce-page>
    </section>
  `,
})
export class LivePage {
  private readonly api = inject(AnalyticsApi);
  private readonly lookup = inject(LookupService);
  protected readonly sqft = SQFT_PER_PERSON;
  readonly storeId = signal<number | null>(null);
  readonly auto = signal(true);
  readonly tick = signal(0);

  readonly data = loadOn(
    () => {
      const s = this.storeId();
      this.tick();
      return s ? s : null;
    },
    (s) => this.api.live(s),
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    interval(environment.liveRefreshMs)
      .pipe(
        filter(() => this.auto() && !document.hidden),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe(() => this.refresh());
    inject(NotificationService)
      .live$.pipe(
        filter((sid) => sid === this.storeId() && this.auto()),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe(() => this.refresh());
  }

  readonly offline = computed(() => (this.data.data()?.cameras ?? []).filter((c) => c.status === 'OFFLINE'));
  readonly offlineNames = computed(() => this.offline().map((c) => c.name).slice(0, 3).join(', ') + (this.offline().length > 3 ? '…' : ''));
  readonly onlineCount = computed(() => (this.data.data()?.cameras ?? []).filter((c) => c.status === 'ONLINE').length);
  readonly capacity = computed(() => {
    const st = this.lookup.stores().find((s) => s.id === this.storeId());
    return st?.areaSqft ? Math.max(1, Math.round(st.areaSqft / SQFT_PER_PERSON)) : null;
  });
  readonly occFrac = computed(() => {
    const occ = this.data.data()?.currentOccupancy ?? 0;
    const cap = this.capacity();
    return cap ? occ / cap : 0;
  });
  readonly occPct = computed(() => `${Math.round(this.occFrac() * 100)}% full`);
  readonly arc = computed(() => gaugeArc(this.occFrac()));

  refresh(): void {
    this.tick.update((t) => t + 1);
  }

  cameraName(d: LiveData, id: number): string {
    return d.cameras.find((c) => c.id === id)?.name ?? `Camera ${id}`;
  }

  icon(t: string): string {
    return EVENT_ICON[t] ?? 'radio_button_checked';
  }
}
