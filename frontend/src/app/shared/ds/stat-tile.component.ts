import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Kpi } from '../../core/models/api.models';
import { KpiFormat, formatKpiValue, trendOf } from '../ui/kpi-card.component';

export type StatVariant = 'band' | 'compact' | 'strip';

/**
 * Stat tile (ce-stat-tile).
 * - `band`: Tango style — tinted header band with the big value and its label, optional detail body below.
 * - `compact`: icon, label, value and a delta chip vs the previous period.
 * - `strip`: value over label, used inside ce-stat-strip.
 * With `id` the host carries data-testid="kpi-<id>" and the value data-testid="kpi-value" (same contract as
 * ce-kpi-card). With `link` the tile is a router link.
 */
@Component({
  selector: 'ce-stat-tile',
  imports: [NgTemplateOutlet, MatIconModule, MatTooltipModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"ce-stat ce-stat-v-" + variant() + (link() ? " is-link" : "") + (hero() ? " hero" : "")',
    '[attr.data-testid]': 'testId() ?? (id() ? "kpi-" + id() : null)',
  },
  template: `
    <ng-template #valueTpl>
      @if (loading()) {
        <span class="ce-skel ce-skel-value" aria-hidden="true"></span>
      } @else {
        <span class="ce-stat-value" data-testid="kpi-value" [class.linked]="!!link()">{{ display() }}</span>@if (link()) {<mat-icon class="ce-stat-go" aria-hidden="true">arrow_outward</mat-icon>}
      }
    </ng-template>
    <ng-template #labelTpl>
      <span class="ce-stat-label">
        <span class="ellipsis">{{ label() }}</span>
        @if (hint()) {
          <mat-icon class="ce-info" [matTooltip]="hint()!" [attr.aria-label]="'About ' + label()">info</mat-icon>
        }
      </span>
    </ng-template>
    <ng-template #projTpl><ng-content /></ng-template>
    <ng-template #deltaTpl>
      @if (showDelta() && !loading()) {
        <span
          class="ce-delta"
          data-testid="kpi-change"
          [class.good]="trend().good === true"
          [class.bad]="trend().good === false"
          [attr.aria-label]="'Change vs previous period ' + deltaText()"
        >
          <mat-icon aria-hidden="true">{{ trend().dir === 'up' ? 'trending_up' : trend().dir === 'down' ? 'trending_down' : 'trending_flat' }}</mat-icon>
          <span>{{ deltaText() }}</span>
          <span class="ce-delta-vs">{{ previousText() ? 'vs ' + previousText() : deltaLabel() }}</span>
        </span>
      } @else if (sub()) {
        <span class="ce-stat-sub">{{ sub() }}</span>
      }
    </ng-template>

    @switch (variant()) {
      @case ('band') {
        @if (link()) {
          <a class="ce-stat-band" [routerLink]="link()">
            <ng-container [ngTemplateOutlet]="valueTpl" /><ng-container [ngTemplateOutlet]="labelTpl" />
          </a>
        } @else {
          <div class="ce-stat-band"><ng-container [ngTemplateOutlet]="valueTpl" /><ng-container [ngTemplateOutlet]="labelTpl" /></div>
        }
        <div class="ce-stat-body">
          <ng-container [ngTemplateOutlet]="deltaTpl" />
          <ng-container [ngTemplateOutlet]="projTpl" />
        </div>
      }
      @case ('compact') {
        <div class="ce-stat-head">
          @if (icon()) {
            <span class="ce-stat-icon" aria-hidden="true"><span class="material-symbols-outlined">{{ icon() }}</span></span>
          }
          <ng-container [ngTemplateOutlet]="labelTpl" />
        </div>
        @if (link()) {
          <a class="ce-stat-link" [routerLink]="link()"><ng-container [ngTemplateOutlet]="valueTpl" /></a>
        } @else {
          <ng-container [ngTemplateOutlet]="valueTpl" />
        }
        <ng-container [ngTemplateOutlet]="deltaTpl" />
        <ng-container [ngTemplateOutlet]="projTpl" />
      }
      @default {
        @if (link()) {
          <a class="ce-stat-link" [routerLink]="link()"><ng-container [ngTemplateOutlet]="valueTpl" /></a>
        } @else {
          <ng-container [ngTemplateOutlet]="valueTpl" />
        }
        <ng-container [ngTemplateOutlet]="labelTpl" />
        <ng-container [ngTemplateOutlet]="deltaTpl" />
        <ng-container [ngTemplateOutlet]="projTpl" />
      }
    }
  `,
})
export class StatTileComponent {
  readonly id = input<string | null>(null);
  /** Explicit host test id (wins over the "kpi-<id>" convention). */
  readonly testId = input<string | null>(null);
  readonly label = input.required<string>();
  readonly variant = input<StatVariant>('compact');
  readonly icon = input<string | null>(null);
  readonly hint = input<string | null>(null);
  readonly format = input<KpiFormat>('number');
  readonly value = input<number | null | undefined>(undefined);
  readonly kpi = input<Kpi | null | undefined>(undefined);
  /** Pre-formatted value text (wins over value/kpi). */
  readonly text = input<string | null>(null);
  readonly compare = input(false);
  readonly lowerIsBetter = input(false);
  /** Delta in % supplied directly (when there is no Kpi object). */
  readonly delta = input<number | null>(null);
  readonly deltaLabel = input('vs previous period');
  readonly loading = input(false);
  readonly sub = input<string | null>(null);
  readonly link = input<string | unknown[] | null>(null);
  readonly hero = input(false);

  protected readonly current = computed(() => { const k = this.kpi(); return k ? k.value : this.value(); });
  protected readonly display = computed(() => this.text() ?? formatKpiValue(this.current(), this.format()));
  private readonly change = computed(() => this.kpi()?.changePct ?? this.delta());
  protected readonly trend = computed(() => trendOf(this.change(), this.lowerIsBetter()));
  protected readonly showDelta = computed(() => {
    const c = this.change();
    return c !== null && c !== undefined && (this.compare() || this.delta() !== null);
  });
  protected readonly deltaText = computed(() => {
    const c = this.change();
    return c === null || c === undefined ? '' : `${c > 0 ? '+' : ''}${c.toFixed(1)}%`;
  });
  protected readonly previousText = computed(() => {
    const p = this.kpi()?.previous;
    return p === undefined || p === null ? '' : formatKpiValue(p, this.format());
  });
}
