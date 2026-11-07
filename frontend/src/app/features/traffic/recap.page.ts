import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/auth/auth.service';
import { Recap } from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { addDays, toIsoDate } from '../../core/utils/dates';
import { errorMessage } from '../../core/utils/format';
import { DateTimePipe, DurationPipe, ShortDatePipe } from '../../shared/pipes';
import { StorePickerComponent } from '../../shared/ui/store-picker.component';
import { StatusChipComponent } from '../../shared/ui/ui.components';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DS } from '../../shared/ds';
import { formatDuration } from '../../core/utils/format';
import { InfraHealth } from '../../core/models/api.models';
import { catchError, of } from 'rxjs';
import { UiService } from '../../shared/ui/ui.service';
import { silent } from '../../core/services/api.service';

/** Sorts recaps newest date first, then store name. */
export function sortRecaps(list: Recap[]): Recap[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || a.storeName.localeCompare(b.storeName));
}

@Component({
  selector: 'ce-recap-page',
  imports: [FormsModule, MatIconModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatTooltipModule, ...DS, StorePickerComponent, StatusChipComponent, DateTimePipe, DurationPipe, ShortDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-recap">
      <ce-page title="Recap video" description="A short (under 2 min) time-lapse of the store's day, built from camera snapshots" [lastRefreshed]="true">
        <ce-stat-strip label="Recap summary" data-testid="recap-summary">
          <ce-stat-tile variant="strip" id="recap-total" label="Recaps in period" [value]="data.data() ? rows().length : undefined" [loading]="data.loading() && !data.data()" />
          <ce-stat-tile variant="strip" id="recap-ready" label="Ready to play" [value]="data.data() ? readyCount() : undefined" [loading]="data.loading() && !data.data()" />
          <ce-stat-tile variant="strip" id="recap-avg" label="Avg length" [text]="avgLength()" [loading]="data.loading() && !data.data()" />
          <div class="ce-stat ce-stat-v-strip recap-health" data-testid="recap-store-health">
            <span class="ce-stat-label">Store health</span>
            @if (health(); as h) {
              <span class="rh-row"><ce-pill [value]="h.health" [label]="h.health === 'GOOD' ? 'Good' : h.health === 'DEGRADED' ? 'Degraded' : 'Down'" /></span>
              <span class="ce-stat-sub">{{ h.camerasOnline }}/{{ h.camerasTotal }} cameras online · edge {{ h.edgeStatus === 'ONLINE' ? 'online' : 'offline' }}</span>
            } @else {
              <span class="ce-stat-value">--</span>
              <span class="ce-stat-sub">Pick a recap to see its store</span>
            }
          </div>
        </ce-stat-strip>

        @if (canGenerate()) {
          <ce-card title="Build a recap" icon="movie_edit" info="Builds an H.264 time-lapse from the day's camera snapshots (about 2 frames per minute of opening hours)." data-testid="recap-generate">
            <div class="ce-sentence recap-gen">
              <span class="lead">Build a recap for</span>
              <ce-store-picker [(value)]="genStore" testId="select-recap-store" width="240px" />
              <span>on</span>
              <mat-form-field subscriptSizing="dynamic" style="width: 170px">
                <mat-label>Date</mat-label>
                <input matInput type="date" [ngModel]="genDate()" (ngModelChange)="genDate.set($event)" [max]="today" data-testid="input-recap-date" />
              </mat-form-field>
              <button type="button" class="ce-btn ce-btn-primary" (click)="generate()" [disabled]="generating() || !genStore()" data-testid="btn-generate-recap">
                @if (generating()) {
                  <mat-spinner diameter="16" />
                  Building…
                } @else {
                  <mat-icon>movie_edit</mat-icon> Generate recap
                }
              </button>
            </div>
            @if (genError()) {
              <ce-info-banner tone="danger" data-testid="recap-error">{{ genError() }}</ce-info-banner>
            }
          </ce-card>
        }

        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        }
        <div class="an-grid-2-1">
          <ce-card title="Recap video" icon="smart_display" [subtitle]="selected() ? selected()!.storeName + ' · ' + (selected()!.date | shortDate) : 'No recap selected'" info="Plays the store's day in under two minutes. Use it to review openings, staffing and visual merchandising at a glance." data-testid="recap-player">
            <ng-container cardActions>
              @if (selected(); as r) {
                <ce-pill [value]="r.status === 'READY' ? 'COMPLETED' : r.status === 'FAILED' ? 'FAILED' : 'PENDING'" [label]="r.status === 'READY' ? 'Ready' : r.status === 'FAILED' ? 'Failed' : 'Preparing'" />
                @if (r.status === 'READY' && r.url) {
                  <a class="ce-icon-btn sm" [href]="r.url" [attr.download]="'recap-' + r.storeId + '-' + r.date + '.mp4'" matTooltip="Download MP4" aria-label="Download recap video" data-testid="btn-recap-download"><mat-icon>download</mat-icon></a>
                }
              }
            </ng-container>
            <div class="recap-player">
              @if (selected(); as r) {
                @if (r.status === 'READY' && r.url) {
                  <video [src]="r.url" controls preload="metadata" playsinline data-testid="recap-video"></video>
                  <div class="recap-meta">
                    <span><mat-icon>timer</mat-icon>{{ r.durationSec | duration }}</span>
                    <span><mat-icon>burst_mode</mat-icon>{{ r.frameCount }} frames</span>
                    <span><mat-icon>build</mat-icon>Built {{ r.createdAt | dt }}</span>
                  </div>
                } @else {
                  <ce-empty-state [kind]="r.status === 'FAILED' ? 'error' : 'no-data'" [icon]="r.status === 'FAILED' ? 'error' : 'hourglass_top'" [title]="r.status === 'FAILED' ? 'Recap failed' : 'Recap is being prepared'" [message]="r.error" />
                }
              } @else if (data.loading()) {
                <ce-skeleton kind="chart" height="320px" />
              } @else {
                <ce-empty-state icon="movie" title="Select a recap" message="Pick a store-day from the list to play it." />
              }
            </div>
          </ce-card>
          <ce-card title="Recaps" icon="video_library" [subtitle]="rows().length + ' in the period'">
            @if (rows().length) {
              <ul class="recap-list" data-testid="recap-list" role="listbox" aria-label="Recaps">
                @for (r of rows(); track r.id) {
                  <li [attr.data-testid]="'recap-' + r.id" [class.active]="selected()?.id === r.id" (click)="selected.set(r)" (keydown.enter)="selected.set(r)" (keydown.space)="$event.preventDefault(); selected.set(r)" tabindex="0" role="option" [attr.aria-selected]="selected()?.id === r.id">
                    <span class="rl-icon" aria-hidden="true"><span class="material-symbols-outlined">{{ r.status === 'READY' ? 'play_arrow' : r.status === 'FAILED' ? 'error' : 'hourglass_top' }}</span></span>
                    <div class="rl-main">
                      <div class="ellipsis" [title]="r.storeName">{{ r.storeName }}</div>
                      <div class="caption">{{ r.date | shortDate }} · {{ r.durationSec | duration }}</div>
                    </div>
                    <ce-chip [value]="r.status" [tone]="r.status === 'READY' ? 'good' : r.status === 'FAILED' ? 'critical' : 'warning'" [label]="r.status === 'READY' ? 'Ready' : r.status === 'FAILED' ? 'Failed' : 'Pending'" testId="chip-recap-status" />
                  </li>
                }
              </ul>
            } @else {
              <div class="recap-list" data-testid="recap-list">
                @if (data.loading()) {
                  <ce-skeleton kind="text" [count]="5" />
                } @else {
                  <ce-empty-state kind="filtered" icon="movie" title="No recaps in this period" [compact]="true" />
                }
              </div>
            }
          </ce-card>
        </div>
      </ce-page>
    </section>
  `,
})
export class RecapPage {
  private readonly v2 = inject(V2Api);
  private readonly api = inject(ApiService);
  private readonly filter = inject(FilterService);
  private readonly auth = inject(AuthService);
  private readonly ui = inject(UiService);
  readonly today = toIsoDate(new Date());
  readonly canGenerate = computed(() => this.auth.can('generateRecap'));
  readonly genStore = signal<number | null>(null);
  readonly genDate = signal(toIsoDate(addDays(new Date(), -1)));
  readonly generating = signal(false);
  readonly genError = signal<string | null>(null);
  readonly selected = signal<Recap | null>(null);
  /** A recap generated on this page stays selected even before (or without) the list reload containing it. */
  private justGenerated: number | null = null;

  readonly data = loadOn(() => this.filter.params(), (p) => this.v2.recaps(p));
  readonly rows = computed(() => sortRecaps(this.data.data() ?? []));
  readonly readyCount = computed(() => this.rows().filter((r) => r.status === 'READY').length);
  readonly avgLength = computed(() => {
    const ready = this.rows().filter((r) => r.status === 'READY' && r.durationSec > 0);
    return ready.length ? formatDuration(ready.reduce((s, r) => s + r.durationSec, 0) / ready.length) : '--';
  });
  /** Health of the selected recap's store (infra endpoint; hidden for roles without access). */
  private readonly infra = loadOn(
    () => (this.auth.can('infraHealth') ? this.selected()?.storeId ?? null : null),
    (id) => this.v2.infraHealth([id]).pipe(catchError(() => of(null as InfraHealth | null))),
  );
  readonly health = computed(() => this.infra.data()?.stores?.find((x) => x.storeId === this.selected()?.storeId) ?? null);

  constructor() {
    effect(() => {
      const r = this.rows();
      const sel = this.selected();
      if (!sel || (!r.some((x) => x.id === sel.id) && sel.id !== this.justGenerated)) this.selected.set(r.find((x) => x.status === 'READY') ?? r[0] ?? null);
    });
  }

  generate(): void {
    const storeId = this.genStore();
    if (!storeId) return;
    this.generating.set(true);
    this.genError.set(null);
    // silent: a 422 "no snapshots" is shown inline next to the button
    this.api.post<Recap>('/recaps/generate', { storeId, date: this.genDate() }, null, silent()).subscribe({
      next: (r) => {
        this.generating.set(false);
        this.ui.toast(r.status === 'READY' ? 'Recap ready' : `Recap ${r.status.toLowerCase()}`);
        this.justGenerated = r.id;
        this.selected.set(r);
        this.data.reload();
      },
      error: (e) => {
        this.generating.set(false);
        this.genError.set(errorMessage(e));
      },
    });
  }
}
