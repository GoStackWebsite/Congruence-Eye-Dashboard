import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatDuration, formatNumber } from '../../core/utils/format';

/** Reference-01 "Gender & dwell time" block: male / female share with person icons, average dwell with a clock. */
@Component({
  selector: 'ce-gender-dwell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-gender-dwell' },
  template: `
    <div class="gd-top">
      <div class="gd-stat male" data-testid="gd-male">
        <span class="material-symbols-outlined" aria-hidden="true">man</span>
        <div>
          <div class="gd-value">{{ pct().male }}</div>
          <div class="gd-label">Male · {{ n(male()) }}</div>
        </div>
      </div>
      <div class="gd-stat female" data-testid="gd-female">
        <span class="material-symbols-outlined" aria-hidden="true">woman</span>
        <div>
          <div class="gd-value">{{ pct().female }}</div>
          <div class="gd-label">Female · {{ n(female()) }}</div>
        </div>
      </div>
    </div>
    <div class="gd-dwell" data-testid="gd-dwell">
      <span class="gd-clock" aria-hidden="true"><span class="material-symbols-outlined">timer</span></span>
      <div>
        <div class="gd-dwell-label">Avg dwell time</div>
        <div class="gd-dwell-value">{{ dwell() }}</div>
        <div class="caption">Avg dwell · dominant age {{ dominantAge() ?? '--' }}</div>
      </div>
    </div>
  `,
})
export class GenderDwellComponent {
  readonly male = input<number | null | undefined>(null);
  readonly female = input<number | null | undefined>(null);
  readonly dwellSec = input<number | null | undefined>(null);
  readonly dominantAge = input<string | null>(null);
  protected readonly pct = computed(() => {
    const m = this.male() ?? 0;
    const f = this.female() ?? 0;
    const t = m + f;
    return t ? { male: `${Math.round((m / t) * 100)}%`, female: `${Math.round((f / t) * 100)}%` } : { male: '--', female: '--' };
  });
  protected readonly dwell = computed(() => formatDuration(this.dwellSec()));
  n(v: number | null | undefined): string {
    return formatNumber(v);
  }
}
