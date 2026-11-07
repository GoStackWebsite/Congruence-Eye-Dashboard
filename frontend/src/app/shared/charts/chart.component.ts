import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { ThemeService } from '../../core/services/theme.service';
import { CHART_THEME } from './chart-theme';

/** The bits of an ECharts instance the app uses. */
export interface ChartInstance {
  getDataURL(opts: { type?: string; pixelRatio?: number; backgroundColor?: string }): string;
}

/**
 * Theme-aware ECharts wrapper. Re-creates the chart instance when the theme flips
 * (light/dark are separate registered themes, not an automatic inversion).
 */
@Component({
  selector: 'ce-chart',
  imports: [NgxEchartsDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (t of [themeName()]; track t) {
      <div
        class="ce-chart"
        echarts
        [options]="options()"
        [theme]="t"
        [autoResize]="true"
        [style.height]="height()"
        [attr.data-testid]="testId()"
        role="img"
        [attr.aria-label]="ariaLabel()"
        (chartClick)="chartClick.emit($event)"
        (chartInit)="onInit($event)"
      ></div>
    }
  `,
  styles: `
    :host { display: block; width: 100%; }
    .ce-chart { width: 100%; }
  `,
})
export class ChartComponent {
  private readonly theme = inject(ThemeService);
  readonly options = input.required<EChartsCoreOption>();
  readonly height = input('300px');
  readonly testId = input<string | null>(null);
  readonly ariaLabel = input('Chart');
  readonly chartClick = output<unknown>();
  /** Emits the ECharts instance once created (again after a theme switch). */
  readonly chartReady = output<ChartInstance>();
  private instance: ChartInstance | null = null;
  onInit(chart: unknown): void {
    this.instance = chart as ChartInstance;
    this.chartReady.emit(this.instance);
  }

  /** PNG data URL of the current chart (2× pixel ratio, card background), or null before init. */
  toDataUrl(background = this.theme.isDark() ? '#161B26' : '#FFFFFF'): string | null {
    return this.instance?.getDataURL?.({ type: 'png', pixelRatio: 2, backgroundColor: background }) ?? null;
  }

  protected readonly themeName = computed(() => (this.theme.isDark() ? CHART_THEME.dark : CHART_THEME.light));
}
