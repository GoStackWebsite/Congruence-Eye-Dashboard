import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { catchError, of } from 'rxjs';
import { Traffic } from '../../core/models/api.models';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { shortDate } from '../../core/utils/dates';
import { formatPct } from '../../core/utils/format';
import { cartesian, donut } from '../../shared/charts/chart-builders';
import { DS } from '../../shared/ds';
import { safePct } from './analytics-helpers';
import { GenderDwellComponent } from './gender-dwell.component';

/** Traffic › Demographics: gender & age of classified visitors (reference 01 "Age" and "Gender & dwell time"). */
@Component({
  selector: 'ce-demographics-page',
  imports: [...DS, GenderDwellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-demographics">
      <ce-page title="Demographics" description="Estimated gender and age band of visitors, where the camera could classify them" [lastRefreshed]="true">
        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        } @else if (data.loaded() && !total()) {
          <ce-card><ce-empty-state kind="filtered" icon="groups" title="No demographic data for these filters" /></ce-card>
        }
        @let d = data.data();
        @let busy = !d && data.loading();
        <div class="stat-grid stat-grid-4">
          <ce-stat-tile variant="band" id="male" label="Male" [value]="d?.gender?.male" [loading]="busy" [sub]="share(d?.gender?.male)" />
          <ce-stat-tile variant="band" id="female" label="Female" [value]="d?.gender?.female" [loading]="busy" [sub]="share(d?.gender?.female)" />
          <ce-stat-tile variant="band" id="unknown" label="Unclassified" [value]="d?.gender?.unknown" [loading]="busy" [sub]="share(d?.gender?.unknown)" hint="Visitors the camera could not classify (back to camera, occluded)" />
          <ce-stat-tile variant="band" id="dominant-age" label="Dominant age band" [text]="dominantAge() ?? '--'" [loading]="busy" [sub]="dominantShare()" />
        </div>

        <div class="an-grid-1-1">
          <ce-card title="Age" icon="cake" [subtitle]="'As of ' + rangeEnd()" info="Share of classified visitors in each age band." data-testid="card-age">
            @if (ageRows().length) {
              <ul class="age-list" data-testid="age-list">
                @for (a of ageRows(); track a.band) {
                  <li [attr.data-testid]="'age-' + a.band">
                    <span class="age-band">{{ a.label }}</span>
                    <span class="age-pct">{{ a.pctText }}</span>
                    <span class="age-bar"><span [style.width.%]="a.pct ?? 0"></span></span>
                  </li>
                }
              </ul>
            } @else if (busy) {
              <ce-skeleton kind="text" [count]="6" />
            } @else {
              <ce-empty-state kind="filtered" icon="cake" title="No age data" [compact]="true" />
            }
          </ce-card>
          <ce-card title="Gender & dwell time" icon="wc" [subtitle]="'As of ' + rangeEnd()" info="Male / female share of classified visitors and the average time spent in store.">
            @if (d) {
              <ce-gender-dwell [male]="d.gender.male" [female]="d.gender.female" [dwellSec]="traffic.data()?.totals?.avgDwellSec" [dominantAge]="dominantAge()" />
            } @else {
              <ce-skeleton kind="text" [count]="4" />
            }
          </ce-card>
        </div>

        <div class="an-grid-1-2">
          <ce-chart-card title="Gender" info="Visitors by estimated gender, including those the camera could not classify." [options]="genderChart()" [hasData]="total() > 0" [loading]="data.loading()" [error]="data.error()" (retry)="data.reload()" chartTestId="chart-gender" height="280px" />
          <ce-chart-card title="Age bands" info="Number of classified visitors per age band." [options]="ageChart()" [hasData]="total() > 0" [loading]="data.loading()" chartTestId="chart-age" height="280px" />
        </div>
        <ce-chart-card title="Gender by age band" info="Male and female visitors stacked per age band." [options]="genderByAgeChart()" [hasData]="total() > 0" [loading]="data.loading()" chartTestId="chart-gender-by-age" height="300px" />
      </ce-page>
    </section>
  `,
})
export class DemographicsPage {
  private readonly api = inject(AnalyticsApi);
  private readonly filter = inject(FilterService);
  readonly data = loadOn(() => this.filter.params(), (p) => this.api.demographics(p));
  readonly traffic = loadOn(() => this.filter.params(), (p) => this.api.traffic(p).pipe(catchError(() => of(null as Traffic | null))));

  readonly rangeEnd = computed(() => shortDate(this.filter.range().to));
  readonly total = computed(() => {
    const g = this.data.data()?.gender;
    return g ? g.male + g.female + g.unknown : 0;
  });
  share(v: number | null | undefined): string | null {
    const p = safePct(v, this.total());
    return p === null ? null : `${p.toFixed(1)}% of visitors`;
  }
  private readonly known = computed(() => (this.data.data()?.age ?? []).filter((x) => x.band !== 'U'));
  readonly dominantAge = computed(() => {
    const a = this.known();
    return a.length && a.some((x) => x.count > 0) ? a.reduce((m, x) => (x.count > m.count ? x : m)).band : null;
  });
  readonly dominantShare = computed(() => {
    const a = this.known();
    const sum = a.reduce((s, x) => s + x.count, 0);
    const top = a.find((x) => x.band === this.dominantAge());
    const p = top ? safePct(top.count, sum) : null;
    return p === null ? null : `${p.toFixed(0)}% of classified visitors`;
  });
  readonly ageRows = computed(() => {
    const a = this.known();
    const sum = a.reduce((s, x) => s + x.count, 0);
    return a.map((x) => {
      const pct = safePct(x.count, sum);
      return { band: x.band, label: `Age ${x.band}`, pct, pctText: pct === null ? '--' : formatPct(pct, 0) };
    });
  });

  protected readonly genderChart = computed(() => {
    const g = this.data.data()?.gender;
    return {
      ...donut([
        { name: 'Male', value: g?.male ?? 0 },
        { name: 'Female', value: g?.female ?? 0 },
        { name: 'Unknown', value: g?.unknown ?? 0 },
      ]),
      color: ['#2E90FA', '#EE46BC', '#98A2B3'],
    };
  });
  protected readonly ageChart = computed(() => {
    const a = this.data.data()?.age ?? [];
    return cartesian(
      a.map((x) => (x.band === 'U' ? 'Unknown' : x.band)),
      [{ name: 'Visitors', type: 'bar', data: a.map((x) => x.count) }],
    );
  });
  protected readonly genderByAgeChart = computed(() => {
    const a = this.data.data()?.genderByAge ?? [];
    return {
      ...cartesian(
        a.map((x) => (x.band === 'U' ? 'Unknown' : x.band)),
        [
          { name: 'Male', type: 'bar', stack: 'g', data: a.map((x) => x.male) },
          { name: 'Female', type: 'bar', stack: 'g', data: a.map((x) => x.female) },
        ],
      ),
      color: ['#2E90FA', '#EE46BC'],
    };
  });
}
