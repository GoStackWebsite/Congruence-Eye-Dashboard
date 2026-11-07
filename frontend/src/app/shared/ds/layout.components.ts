import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, computed, effect, inject, input, model, output, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';

/** Row of stats inside one card, separated by hairline dividers (ce-stat-strip). Put ce-stat-tile variant="strip" inside. */
@Component({
  selector: 'ce-stat-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-stat-strip', role: 'group', '[attr.aria-label]': 'label()' },
  template: `<ng-content />`,
})
export class StatStripComponent {
  readonly label = input('Summary');
}

export interface TabItem {
  value: string;
  label: string;
  count?: number | null;
  testId?: string;
}

/**
 * Underline tabs (ce-tabs) with role="tablist"/"tab" semantics and arrow-key navigation. When `queryParam` is set
 * the selected tab is synced to that query parameter (deep-linkable).
 */
@Component({
  selector: 'ce-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-tabs', role: 'tablist', '[attr.aria-label]': 'label()', '(keydown)': 'onKey($event)' },
  template: `
    @for (t of tabs(); track t.value) {
      <button
        type="button"
        role="tab"
        class="ce-tab"
        [class.active]="t.value === value()"
        [attr.aria-selected]="t.value === value()"
        [attr.tabindex]="t.value === value() ? 0 : -1"
        [attr.data-testid]="t.testId ?? 'tab-' + t.value"
        (click)="select(t.value)"
      >
        {{ t.label }}
        @if (t.count !== undefined && t.count !== null) {
          <span class="ce-tab-count">{{ t.count }}</span>
        }
      </button>
    }
  `,
})
export class TabsComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly tabs = input.required<TabItem[]>();
  readonly value = model<string>('');
  readonly queryParam = input<string | null>(null);
  readonly label = input('Tabs');

  constructor() {
    effect(() => {
      const qp = this.queryParam();
      const tabs = this.tabs();
      if (!qp) return;
      const v = this.route.snapshot.queryParamMap.get(qp);
      if (v && tabs.some((t) => t.value === v) && v !== this.value()) queueMicrotask(() => this.value.set(v));
    });
  }

  select(v: string): void {
    this.value.set(v);
    const qp = this.queryParam();
    if (qp) void this.router.navigate([], { relativeTo: this.route, queryParams: { [qp]: v }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  onKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = this.tabs();
    const i = tabs.findIndex((t) => t.value === this.value());
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    if (next) {
      this.select(next.value);
      queueMicrotask(() => ((e.currentTarget as HTMLElement)?.querySelector('.ce-tab.active') as HTMLElement | null)?.focus());
    }
  }
}

/** Segmented control (ce-segmented) for 2–4 options: Checklist / Task, Hourly / Daily / Weekly. */
@Component({
  selector: 'ce-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-segmented', role: 'radiogroup', '[attr.aria-label]': 'label()' },
  template: `
    @for (o of options(); track o.value) {
      <button
        type="button"
        role="radio"
        [attr.aria-checked]="o.value === value()"
        [class.active]="o.value === value()"
        [attr.data-testid]="o.testId ?? null"
        (click)="value.set(o.value)"
      >
        {{ o.label }}
      </button>
    }
  `,
})
export class SegmentedComponent {
  readonly options = input.required<TabItem[]>();
  readonly value = model<string>('');
  readonly label = input('Options');
}

/** Removable chips with "+N more" overflow (ce-chip-list): selected stores, recipients. */
@Component({
  selector: 'ce-chip-list',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-chip-list' },
  template: `
    @for (c of visible(); track c.id) {
      <span class="ce-tag" [attr.data-testid]="tagId(c.id)" [attr.title]="c.title ?? c.label">
        @if (c.badge) {
          <span class="ce-tag-badge">{{ c.badge }}</span>
        }
        <span class="ellipsis">{{ c.label }}</span>
        @if (removable()) {
          <button type="button" class="ce-tag-x" (click)="remove.emit(c.id)" [attr.aria-label]="'Remove ' + c.label"><mat-icon>close</mat-icon></button>
        }
      </span>
    }
    @if (hidden() > 0) {
      <button type="button" class="ce-tag more" (click)="expanded.set(true)" data-testid="chip-list-more">+{{ hidden() }} more</button>
    } @else if (expanded() && items().length > max()) {
      <button type="button" class="ce-tag more" (click)="expanded.set(false)">Show less</button>
    }
    @if (!items().length && emptyText()) {
      <span class="caption">{{ emptyText() }}</span>
    }
  `,
})
export class ChipListComponent {
  readonly items = input.required<{ id: string | number; label: string; badge?: string; title?: string }[]>();
  readonly max = input(12);
  readonly removable = input(true);
  readonly emptyText = input<string | null>(null);
  readonly testIdPrefix = input<string | null>(null);
  readonly remove = output<string | number>();
  protected readonly expanded = signal(false);
  tagId(id: string | number): string | null {
    const p = this.testIdPrefix();
    return p ? p + id : null;
  }
  protected readonly visible = computed(() => (this.expanded() ? this.items() : this.items().slice(0, this.max())));
  protected readonly hidden = computed(() => (this.expanded() ? 0 : Math.max(0, this.items().length - this.max())));
}

/**
 * Form section card (ce-form-section): title, info tooltip, optional description, body. Sentence inputs go in
 * `.ce-sentence` rows: `If store opens later than <input class="ce-inline-input"> minutes`.
 */
@Component({
  selector: 'ce-form-section',
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-form-section', '[attr.id]': 'anchor()' },
  template: `
    <header class="ce-fs-head">
      <h3 class="ce-fs-title">
        {{ title() }}
        @if (info()) {
          <mat-icon class="ce-info" [matTooltip]="info()!" tabindex="0" role="img" aria-hidden="false" [attr.aria-label]="'About: ' + info()">info</mat-icon>
        }
      </h3>
      @if (description()) {
        <p class="ce-fs-desc">{{ description() }}</p>
      }
      <div class="ce-fs-actions"><ng-content select="[sectionActions]" /></div>
    </header>
    <div class="ce-fs-body"><ng-content /></div>
  `,
})
export class FormSectionComponent {
  readonly title = input.required<string>();
  readonly info = input<string | null>(null);
  readonly description = input<string | null>(null);
  readonly anchor = input<string | null>(null);
}

/** Label + helper text + switch (ce-toggle-row). Body content (sentence inputs) shows only while on. */
@Component({
  selector: 'ce-toggle-row',
  imports: [MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-toggle-row', '[class.on]': 'checked()' },
  template: `
    <div class="ce-tr-head">
      <mat-slide-toggle [checked]="checked()" (change)="checked.set($event.checked)" [disabled]="disabled()" [attr.data-testid]="testId()" [aria-label]="label()" />
      <div class="ce-tr-text">
        <div class="ce-tr-label">{{ label() }}</div>
        @if (helper()) {
          <div class="ce-tr-helper">{{ helper() }}</div>
        }
      </div>
    </div>
    @if (checked() || alwaysShowBody()) {
      <div class="ce-tr-body" [class.muted-body]="!checked()"><ng-content /></div>
    }
  `,
})
export class ToggleRowComponent {
  readonly label = input.required<string>();
  readonly helper = input<string | null>(null);
  readonly checked = model(false);
  readonly disabled = input(false);
  readonly testId = input<string | null>(null);
  readonly alwaysShowBody = input(false);
}

/** Light tinted banner (ce-info-banner): info / warning / success / danger. */
@Component({
  selector: 'ce-info-banner',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"ce-banner tone-" + tone()', '[attr.role]': 'tone() === "danger" ? "alert" : "status"' },
  template: `
    <mat-icon class="ce-banner-icon" aria-hidden="true">{{ iconName() }}</mat-icon>
    <div class="ce-banner-text">
      @if (title()) {
        <div class="ce-banner-title">{{ title() }}</div>
      }
      <ng-content />
    </div>
    <div class="ce-banner-actions"><ng-content select="[bannerActions]" /></div>
  `,
})
export class InfoBannerComponent {
  readonly tone = input<'info' | 'warning' | 'success' | 'danger'>('info');
  readonly title = input<string | null>(null);
  readonly icon = input<string | null>(null);
  protected readonly iconName = computed(
    () => this.icon() ?? { info: 'info', warning: 'warning', success: 'check_circle', danger: 'error' }[this.tone()],
  );
}

/** Shimmer placeholders (ce-skeleton) for tiles, charts, tables and text. */
@Component({
  selector: 'ce-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-skeleton', '[attr.aria-busy]': 'true', 'aria-label': 'Loading' },
  template: `
    @switch (kind()) {
      @case ('tiles') {
        <div class="ce-skel-tiles">
          @for (i of arr(); track i) {
            <div class="ce-skel-tile"><span class="ce-skel" style="width: 45%; height: 22px"></span><span class="ce-skel" style="width: 70%"></span></div>
          }
        </div>
      }
      @case ('chart') {
        <div class="ce-skel-chart" [style.height]="height()">
          @for (i of bars; track i) {
            <span class="ce-skel" [style.height.%]="i"></span>
          }
        </div>
      }
      @case ('table') {
        <div class="ce-skel-table">
          @for (i of arr(); track i) {
            <div class="ce-skel-row"><span class="ce-skel" style="width: 28%"></span><span class="ce-skel" style="width: 14%"></span><span class="ce-skel" style="width: 18%"></span><span class="ce-skel" style="width: 10%"></span></div>
          }
        </div>
      }
      @default {
        @for (i of arr(); track i) {
          <span class="ce-skel ce-skel-line" [style.width.%]="i === arr().length - 1 ? 60 : 100"></span>
        }
      }
    }
  `,
})
export class SkeletonComponent {
  readonly kind = input<'tiles' | 'chart' | 'table' | 'text'>('text');
  readonly count = input(3);
  readonly height = input('240px');
  protected readonly arr = computed(() => Array.from({ length: this.count() }, (_, i) => i));
  protected readonly bars = [40, 65, 52, 80, 58, 72, 45, 90, 62, 70, 55, 76];
}

/** Right side panel (ce-drawer, 480/640 px; full screen on phones) with header, scrollable body and footer. */
@Component({
  selector: 'ce-drawer',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape($event)' },
  template: `
    @if (open()) {
      <div class="ce-drawer-backdrop" (click)="close()" aria-hidden="true"></div>
      <aside class="ce-drawer" [class.wide]="size() === 'lg'" role="dialog" aria-modal="true" [attr.aria-label]="title()" [attr.data-testid]="testId()">
        <header class="ce-drawer-head">
          <div class="ce-drawer-titles">
            <h2>{{ title() }}</h2>
            @if (subtitle()) {
              <p>{{ subtitle() }}</p>
            }
          </div>
          <button type="button" class="ce-icon-btn" (click)="close()" aria-label="Close" data-testid="btn-drawer-close"><mat-icon>close</mat-icon></button>
        </header>
        <div class="ce-drawer-body"><ng-content /></div>
        <footer class="ce-drawer-foot"><ng-content select="[drawerFooter]" /></footer>
      </aside>
    }
  `,
})
export class DrawerComponent {
  readonly open = model(false);
  readonly title = input('');
  readonly subtitle = input<string | null>(null);
  readonly size = input<'md' | 'lg'>('md');
  readonly testId = input<string | null>('drawer');
  readonly closed = output<void>();
  close(): void {
    this.open.set(false);
    this.closed.emit();
  }

  /**
   * Escape closes the drawer — unless something on top of it handled the key first: an open mat-select / mat-menu /
   * autocomplete / dialog (they call preventDefault()) or any CDK overlay still showing (the Escape is theirs).
   */
  onEscape(e: Event): void {
    if (!this.open() || e.defaultPrevented) return;
    if (drawerHasOverlayOnTop()) return;
    this.close();
  }
}

/** True while a CDK overlay (select panel, menu, autocomplete, dialog, datepicker) is attached above the page. */
export function drawerHasOverlayOnTop(doc: Document = document): boolean {
  return Array.from(doc.querySelectorAll('.cdk-overlay-container .cdk-overlay-pane')).some(
    (p) => p.childElementCount > 0 && !p.classList.contains('mat-mdc-tooltip-panel') && !p.querySelector('mat-snack-bar-container, .mat-mdc-tooltip'),
  );
}

export interface MetricItem {
  icon: string;
  label: string;
  value: string;
  tone?: 'brand' | 'male' | 'female' | 'neutral';
  testId?: string;
}

/** Icon + label + value rows (ce-metric-list), as in the zone side panel. */
@Component({
  selector: 'ce-metric-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-metric-list' },
  template: `
    @for (m of items(); track m.label) {
      <div class="ce-metric" [attr.data-testid]="m.testId ?? null">
        <span class="ce-metric-icon" [class]="'ce-metric-icon tone-' + (m.tone ?? 'brand')" aria-hidden="true"><span class="material-symbols-outlined">{{ m.icon }}</span></span>
        <span class="ce-metric-label">{{ m.label }}</span>
        <span class="ce-metric-value">{{ m.value }}</span>
      </div>
    }
  `,
})
export class MetricListComponent {
  readonly items = input.required<MetricItem[]>();
}

/**
 * Horizontal day tabs (ce-date-strip): Nov 28 · Nov 29 · … with an optional "All" tab. Scrolls horizontally with fade
 * edges and chevron buttons when the days don't fit; the selected day is kept in view.
 */
@Component({
  selector: 'ce-date-strip',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-date-strip', '[class.fade-l]': 'canLeft()', '[class.fade-r]': 'canRight()' },
  template: `
    @if (canLeft()) {
      <button type="button" class="ce-ds-nav l" (click)="scrollBy(-1)" aria-label="Earlier days" data-testid="date-strip-prev"><mat-icon>chevron_left</mat-icon></button>
    }
    <div class="ce-ds-scroller" #scroller role="tablist" [attr.aria-label]="label()" (scroll)="measure()">
      @if (allLabel()) {
        <button type="button" role="tab" class="ce-ds-day" [class.active]="value() === null" [attr.aria-selected]="value() === null" (click)="value.set(null)" data-testid="date-strip-all">
          {{ allLabel() }}
        </button>
      }
      @for (d of days(); track d) {
        <button type="button" role="tab" class="ce-ds-day" [class.active]="value() === d" [attr.aria-selected]="value() === d" (click)="value.set(d)" [attr.data-testid]="'date-strip-' + d">
          {{ fmt(d) }}
        </button>
      }
    </div>
    @if (canRight()) {
      <button type="button" class="ce-ds-nav r" (click)="scrollBy(1)" aria-label="Later days" data-testid="date-strip-next"><mat-icon>chevron_right</mat-icon></button>
    }
  `,
})
export class DateStripComponent {
  /** ISO dates (YYYY-MM-DD). */
  readonly days = input.required<string[]>();
  readonly value = model<string | null>(null);
  readonly allLabel = input<string | null>('All days');
  readonly label = input('Days');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  protected readonly canLeft = signal(false);
  protected readonly canRight = signal(false);
  private static readonly F = new Intl.DateTimeFormat('en-IN', { month: 'short', day: '2-digit', timeZone: 'UTC' });

  constructor() {
    afterRenderEffect(() => {
      this.days();
      const v = this.value();
      const el = this.scroller()?.nativeElement;
      if (!el) return;
      const active = el.querySelector('.ce-ds-day.active') as HTMLElement | null;
      if (active && v !== undefined) {
        const l = active.offsetLeft;
        const r = l + active.offsetWidth;
        if (l < el.scrollLeft) el.scrollLeft = l - 24;
        else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 24;
      }
      this.measure();
    });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.measure()) : null;
    afterNextRender(() => {
      const el = this.scroller()?.nativeElement;
      if (el && ro) ro.observe(el);
    });
    inject(DestroyRef).onDestroy(() => ro?.disconnect());
  }

  measure(): void {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    this.canLeft.set(el.scrollLeft > 2);
    this.canRight.set(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }

  scrollBy(dir: number): void {
    const el = this.scroller()?.nativeElement;
    el?.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: 'smooth' });
  }

  fmt(d: string): string {
    return DateStripComponent.F.format(new Date(`${d}T00:00:00Z`));
  }
}

/** Thin progress bar (ce-progress) with an optional gradient (engagers rate) and label/value row. */
@Component({
  selector: 'ce-progress',
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-progress' },
  template: `
    @if (label() || valueText()) {
      <div class="ce-progress-row">
        <span class="ce-progress-label"
          >{{ label() }}
          @if (info()) {
            <mat-icon class="ce-info" [matTooltip]="info()!" [attr.aria-label]="'About ' + label()">info</mat-icon>
          }</span
        >
        <span class="ce-progress-value">{{ valueText() }}</span>
      </div>
    }
    <div class="ce-progress-track" role="progressbar" [attr.aria-valuenow]="clamped()" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="label() || 'Progress'">
      <div class="ce-progress-fill" [class.gradient]="gradient()" [style.width.%]="clamped()" [style.background]="color() ?? null"></div>
    </div>
  `,
})
export class ProgressComponent {
  /** 0–100. */
  readonly value = input<number | null | undefined>(0);
  readonly label = input<string | null>(null);
  readonly valueText = input<string | null>(null);
  readonly info = input<string | null>(null);
  readonly gradient = input(false);
  readonly color = input<string | null>(null);
  protected readonly clamped = computed(() => Math.max(0, Math.min(100, Number(this.value()) || 0)));
}

/** Heatmap legend (ce-gradient-legend): title, gradient bar, ticks. */
@Component({
  selector: 'ce-gradient-legend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-gradient-legend', role: 'img', '[attr.aria-label]': 'title() + ": " + ticks().join(", ")' },
  template: `
    @if (title()) {
      <div class="ce-gl-title">{{ title() }}</div>
    }
    <div class="ce-gl-bar" [style.background]="gradient()"></div>
    <div class="ce-gl-ticks">
      @for (t of ticks(); track $index) {
        <span>{{ t }}</span>
      }
    </div>
  `,
})
export class GradientLegendComponent {
  readonly title = input('');
  readonly gradient = input('var(--c-heat)');
  readonly ticks = input<(string | number)[]>([]);
}
