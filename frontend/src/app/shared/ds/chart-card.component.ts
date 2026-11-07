import { ChangeDetectionStrategy, Component, computed, input, model, output, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { EChartsCoreOption } from 'echarts/core';
import { saveBlob } from '../../core/services/api.service';
import { toCsv } from '../../core/utils/csv';
import { chartTable } from '../charts/chart-builders';
import { ChartComponent } from '../charts/chart.component';
import { EmptyKind, EmptyStateComponent } from '../ui/ui.components';
import { CardComponent } from './card.component';
import { SegmentedComponent, SkeletonComponent, TabItem } from './layout.components';

export interface ChartCsv {
  header: string[];
  rows: (string | number | null | undefined)[][];
}

/** "Footfall & conversion" → "footfall-conversion" */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** data: URL → Blob (for PNG downloads). */
export function dataUrlToBlob(url: string): Blob {
  const [head, b64] = url.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(b64 ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Chart card (ce-chart-card): ce-card + ce-chart with the analytics-page chrome — info tooltip with the metric
 * definition, optional granularity segmented control, and a Download menu (PNG via ECharts getDataURL, CSV of the
 * series). Handles loading (skeleton), empty (no data yet / no results for the filters) and error (retry).
 * Extra header controls go in `[chartActions]`; content below the chart (legends, notes) is projected.
 */
@Component({
  selector: 'ce-chart-card',
  imports: [MatIconModule, MatMenuModule, MatTooltipModule, CardComponent, ChartComponent, SegmentedComponent, SkeletonComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-chart-card' },
  template: `
    <ce-card [title]="title()" [subtitle]="subtitle()" [info]="info()" [icon]="icon()" [fill]="true">
      <div cardActions class="cc-actions">
        <ng-content select="[chartActions]" />
        @if (granularities().length) {
          <ce-segmented [options]="granularities()" [(value)]="granularity" label="Granularity" />
        }
        @if (downloadable()) {
          <button
            type="button"
            class="ce-icon-btn sm"
            [matMenuTriggerFor]="dl"
            matTooltip="Download"
            [attr.aria-label]="'Download ' + title()"
            [attr.data-testid]="'btn-download-' + key()"
            [disabled]="!hasData()"
          >
            <mat-icon>download</mat-icon>
          </button>
          <mat-menu #dl="matMenu" xPosition="before">
            <button mat-menu-item (click)="downloadPng()" [attr.data-testid]="'btn-download-png-' + key()"><mat-icon>image</mat-icon> PNG image</button>
            <button mat-menu-item (click)="downloadCsv()" [disabled]="!table()" [attr.data-testid]="'btn-download-csv-' + key()"><mat-icon>csv</mat-icon> CSV data</button>
          </mat-menu>
        }
      </div>
      @if (error()) {
        <ce-empty-state kind="error" [message]="error()" [compact]="true">
          <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="retry.emit()" [attr.data-testid]="'btn-retry-' + key()">Retry</button>
        </ce-empty-state>
      } @else if (loading() && !hasData()) {
        <ce-skeleton kind="chart" [height]="height()" />
      } @else if (!hasData()) {
        <div class="cc-empty" [style.min-height]="height()">
          <ce-empty-state [kind]="emptyKind()" [icon]="emptyIcon()" [title]="emptyTitle()" [message]="emptyMessage()" [compact]="true" />
        </div>
      } @else {
        <ce-chart [options]="options()!" [height]="height()" [testId]="chartTestId()" [ariaLabel]="ariaLabel() || title()" (chartClick)="chartClick.emit($event)" />
      }
      <ng-content />
    </ce-card>
  `,
})
export class ChartCardComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly info = input<string | null>(null);
  readonly icon = input<string | null>(null);
  readonly options = input<EChartsCoreOption | null>(null);
  readonly height = input('300px');
  readonly chartTestId = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  /** false → no data (shows the empty state). Defaults to "options present". */
  readonly hasDataInput = input<boolean | null>(null, { alias: 'hasData' });
  readonly emptyKind = input<EmptyKind>('filtered');
  readonly emptyTitle = input<string | null>('No data for these filters');
  readonly emptyMessage = input<string | null>('Try a different store selection or date range.');
  readonly emptyIcon = input<string | null>(null);
  readonly granularities = input<TabItem[]>([]);
  readonly granularity = model<string>('');
  readonly downloadable = input(true);
  /** Download file base name (defaults to the title). */
  readonly filename = input<string | null>(null);
  /** CSV override; by default derived from the chart series. */
  readonly csv = input<ChartCsv | null>(null);
  readonly retry = output<void>();
  readonly chartClick = output<unknown>();

  private readonly chart = viewChild(ChartComponent);
  protected readonly key = computed(() => this.chartTestId()?.replace(/^chart-/, '') || slugify(this.title()));
  protected readonly hasData = computed(() => this.hasDataInput() ?? !!this.options());
  protected readonly table = computed<ChartCsv | null>(() => this.csv() ?? chartTable(this.options() as Record<string, unknown> | null));
  private readonly base = computed(() => slugify(this.filename() ?? this.title()));

  downloadPng(): void {
    const url = this.chart()?.toDataUrl();
    if (url) saveBlob(dataUrlToBlob(url), `${this.base()}.png`);
  }

  downloadCsv(): void {
    const t = this.table();
    if (!t) return;
    const csv = toCsv(t.rows, t.header.map((label, i) => ({ label, value: (r: (string | number | null | undefined)[]) => r[i] })));
    saveBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${this.base()}.csv`);
  }
}
