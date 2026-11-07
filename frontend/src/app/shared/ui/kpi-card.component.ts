import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Kpi } from '../../core/models/api.models';
import { formatDuration, formatInr, formatNumber, formatPct } from '../../core/utils/format';

export type KpiFormat = 'number' | 'inr' | 'inrCompact' | 'pct' | 'duration' | 'decimal';

export function formatKpiValue(value: number | null | undefined, format: KpiFormat): string {
  switch (format) {
    case 'inr':
      return formatInr(value);
    case 'inrCompact':
      return formatInr(value, 'compact');
    case 'pct':
      return formatPct(value);
    case 'duration':
      return formatDuration(value);
    case 'decimal':
      return formatNumber(value, 1);
    default:
      return formatNumber(value);
  }
}

/** Direction of change and whether it's good, given "lower is better" metrics. */
export function trendOf(changePct: number | null | undefined, lowerIsBetter = false): { dir: 'up' | 'down' | 'flat'; good: boolean | null } {
  if (changePct === null || changePct === undefined || !Number.isFinite(changePct)) return { dir: 'flat', good: null };
  if (Math.abs(changePct) < 0.05) return { dir: 'flat', good: null };
  const dir = changePct > 0 ? 'up' : 'down';
  const good = lowerIsBetter ? dir === 'down' : dir === 'up';
  return { dir, good };
}

@Component({
  selector: 'ce-kpi-card',
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'kpi-card', '[attr.data-testid]': '"kpi-" + id()' },
  template: `
    <div class="kpi-head">
      @if (icon()) {
        <mat-icon class="kpi-icon" aria-hidden="true">{{ icon() }}</mat-icon>
      }
      <span class="kpi-label">{{ label() }}</span>
      @if (hint()) {
        <mat-icon class="kpi-hint" [matTooltip]="hint()!" aria-label="About this metric">info</mat-icon>
      }
    </div>
    @if (loading()) {
      <div class="skeleton skeleton-text lg" style="width: 60%"></div>
    } @else {
      <div class="kpi-value" data-testid="kpi-value">{{ display() }}</div>
    }
    @if (showChange() && !loading()) {
      <div
        class="kpi-change"
        data-testid="kpi-change"
        [class.good]="trend().good === true"
        [class.bad]="trend().good === false"
        [attr.aria-label]="'Change vs previous period ' + changeText()"
      >
        <mat-icon aria-hidden="true">{{ trend().dir === 'up' ? 'arrow_upward' : trend().dir === 'down' ? 'arrow_downward' : 'remove' }}</mat-icon>
        <span>{{ changeText() }}</span>
        @if (previousText()) {
          <span class="kpi-prev">vs {{ previousText() }}</span>
        }
      </div>
    } @else if (sub()) {
      <div class="kpi-sub">{{ sub() }}</div>
    }
  `,
})
export class KpiCardComponent {
  readonly id = input.required<string>();
  readonly label = input.required<string>();
  readonly icon = input<string>('');
  readonly hint = input<string | null>(null);
  readonly format = input<KpiFormat>('number');
  /** Either a raw value or a Kpi object with previous/changePct. */
  readonly value = input<number | null | undefined>(undefined);
  readonly kpi = input<Kpi | null | undefined>(undefined);
  readonly lowerIsBetter = input(false);
  readonly compare = input(false);
  readonly loading = input(false);
  readonly sub = input<string | null>(null);
  /** Pre-formatted text that replaces the numeric value (e.g. "6pm – 7pm"). */
  readonly text = input<string | null>(null);

  protected readonly current = computed(() => { const k = this.kpi(); return k ? k.value : this.value(); });
  protected readonly display = computed(() => this.text() ?? formatKpiValue(this.current(), this.format()));
  protected readonly trend = computed(() => trendOf(this.kpi()?.changePct, this.lowerIsBetter()));
  protected readonly showChange = computed(() => this.compare() && this.kpi()?.changePct !== undefined && this.kpi()?.changePct !== null);
  protected readonly changeText = computed(() => {
    const c = this.kpi()?.changePct;
    return c === undefined || c === null ? '' : `${c > 0 ? '+' : ''}${c.toFixed(1)}%`;
  });
  protected readonly previousText = computed(() => {
    const p = this.kpi()?.previous;
    return p === undefined || p === null ? '' : formatKpiValue(p, this.format());
  });
}
