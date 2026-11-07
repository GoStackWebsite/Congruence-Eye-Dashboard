import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { LookupService } from '../../core/services/lookup.service';
import type { EChartsCoreOption } from 'echarts/core';
import { Journey } from '../../core/models/api.models';
import { AnalyticsApi } from '../../core/services/analytics.api';
import { FilterService } from '../../core/services/filter.service';
import { loadOn } from '../../core/services/loader';
import { formatDuration, formatNumber, formatPct } from '../../core/utils/format';
import { shortDate } from '../../core/utils/dates';
import { DS } from '../../shared/ds';
import { NumPipe } from '../../shared/pipes';

/**
 * ECharts sankey must be acyclic. Zone-to-zone transitions can contain cycles (A→B and B→A),
 * so we keep the heavier direction of each pair, drop self links and anything that would
 * close a cycle (links processed heaviest first).
 */
export function toAcyclicSankey(j: Journey): { nodes: { name: string }[]; links: { source: string; target: string; value: number }[] } {
  const name = new Map<number, string>();
  for (const n of j.nodes) name.set(n.id, n.name || `Zone ${n.id}`);
  // disambiguate duplicate names (sankey keys by name)
  const seen = new Map<string, number>();
  for (const [id, nm] of name) {
    const c = seen.get(nm) ?? 0;
    if (c) name.set(id, `${nm} (${id})`);
    seen.set(nm, c + 1);
  }
  const sorted = [...j.links].filter((l) => l.source !== l.target && l.count > 0).sort((a, b) => b.count - a.count);
  const adj = new Map<number, Set<number>>();
  const reaches = (from: number, to: number): boolean => {
    const stack = [from];
    const visited = new Set<number>();
    while (stack.length) {
      const n = stack.pop()!;
      if (n === to) return true;
      if (visited.has(n)) continue;
      visited.add(n);
      for (const m of adj.get(n) ?? []) stack.push(m);
    }
    return false;
  };
  const kept: { source: string; target: string; value: number }[] = [];
  for (const l of sorted) {
    if (!name.has(l.source) || !name.has(l.target)) continue;
    if (reaches(l.target, l.source)) continue;
    if (!adj.has(l.source)) adj.set(l.source, new Set());
    adj.get(l.source)!.add(l.target);
    kept.push({ source: name.get(l.source)!, target: name.get(l.target)!, value: l.count });
  }
  const used = new Set(kept.flatMap((l) => [l.source, l.target]));
  return { nodes: [...name.values()].filter((n) => used.has(n)).map((n) => ({ name: n })), links: kept };
}

const HIGHLIGHTS: { key: keyof NonNullable<Journey['highlights']>; title: string; icon: string; metric: string; fmt: 'number' | 'pct' | 'duration' }[] = [
  { key: 'highestFootfall', title: 'Highest footfall', icon: 'directions_walk', metric: 'Top zone footfall', fmt: 'number' },
  { key: 'highestImpression', title: 'Highest impression', icon: 'visibility', metric: 'Highest zone impression', fmt: 'pct' },
  { key: 'highestBounced', title: 'Highest bounced', icon: 'logout', metric: 'Top zone bounced rate', fmt: 'pct' },
  { key: 'highestEngaged', title: 'Highest engaged', icon: 'touch_app', metric: 'Top engagers zone rate', fmt: 'pct' },
  { key: 'highestDwell', title: 'Highest dwell time', icon: 'timer', metric: 'Top zone avg dwell time', fmt: 'duration' },
];

/** Value of a highlight formatted for its band ("4,452", "39.4%", "4m 2s"). */
export function highlightValue(fmt: 'number' | 'pct' | 'duration', v: number | null | undefined): string {
  return fmt === 'pct' ? formatPct(v) : fmt === 'duration' ? formatDuration(v) : formatNumber(v);
}

/** Node colours by sankey depth (entrance → deeper zones), as in reference 04. */
const DEPTH_COLORS = ['#36BFFA', '#6172F3', '#7A5AF8', '#2E90FA', '#9E77ED', '#53B1FD', '#6172F3', '#7A5AF8', '#2E90FA', '#9E77ED', '#53B1FD', '#6172F3'];

/** The 5 highlight cards shown above the sankey (missing highlights are skipped). */
export function journeyHighlightCards(j: Journey | null | undefined) {
  if (!j?.highlights) return [];
  return HIGHLIGHTS.filter((h) => j.highlights![h.key]).map((h) => ({
    ...h,
    zoneName: j.highlights![h.key]!.zoneName,
    label: j.highlights![h.key]!.label,
    value: j.highlights![h.key]!.value,
    valueText: highlightValue(h.fmt, j.highlights![h.key]!.value),
  }));
}

@Component({
  selector: 'ce-journey-page',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule, ...DS, NumPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-journey">
      <ce-page title="Customer journey" description="How shoppers move between zones after entering the store" [lastRefreshed]="true">
        <ng-container pageActions>
          <mat-form-field subscriptSizing="dynamic" style="width: 300px">
            <mat-label>Stores (same-named zones merge)</mat-label>
            <mat-select multiple [ngModel]="storeIds()" (ngModelChange)="storeIds.set($event)" data-testid="select-journey-stores">
              @for (s of lookup.scopedStores(); track s.id) {
                <mat-option [value]="s.id" [attr.data-testid]="'select-journey-stores-option-' + s.id">{{ s.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </ng-container>

        @if (data.error() && !data.data()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        }
        @if (highlights().length) {
          <div class="jr-highlights" data-testid="journey-highlights">
            @for (h of highlights(); track h.key) {
              <ce-stat-tile variant="band" [label]="h.metric" [text]="h.valueText" [testId]="'journey-highlight-' + h.key">
                <div class="ce-stat-detail-title ellipsis" [title]="h.zoneName">{{ h.zoneName }}</div>
                <div class="ce-stat-detail">Zone with the {{ h.title.toLowerCase() }} · <b>{{ h.label }}</b></div>
              </ce-stat-tile>
            }
          </div>
        } @else if (data.loading()) {
          <ce-skeleton kind="tiles" [count]="5" />
        }

        <ce-chart-card
          title="Customer journey"
          icon="route"
          [subtitle]="(totalTransitions() | num) + ' transitions · ' + (data.data()?.totalFootfall ?? 0 | num) + ' footfall · ' + rangeLabel()"
          info="Zone-to-zone movements after entering the store. Band width = number of shoppers moving between the zones. Cycles (A→B→A) are folded into the stronger direction."
          [options]="chart()"
          [hasData]="sankey().links.length > 0"
          [loading]="data.loading()"
          emptyKind="no-data"
          emptyTitle="No journey data"
          emptyMessage="Journeys appear once zone transitions are recorded for this store and period."
          chartTestId="chart-journey-sankey"
          height="540px"
          ariaLabel="Sankey diagram of zone transitions"
          [csv]="linksCsv()"
        />

        @if (sankey().links.length) {
          <ce-card title="Top transitions" icon="swap_horiz" subtitle="Most frequent zone-to-zone moves">
            <ul class="jr-links" data-testid="journey-top-links">
              @for (l of topLinks(); track $index) {
                <li>
                  <span class="jr-rank">{{ $index + 1 }}</span>
                  <span class="jr-path ellipsis" [title]="l.source + ' → ' + l.target">{{ l.source }} <span class="jr-arrow">→</span> {{ l.target }}</span>
                  <span class="jr-bar"><span [style.width.%]="(l.value / maxLink()) * 100"></span></span>
                  <b>{{ l.value | num }}</b>
                </li>
              }
            </ul>
          </ce-card>
        }
      </ce-page>
    </section>
  `,
})
export class JourneyPage {
  private readonly api = inject(AnalyticsApi);
  private readonly filter = inject(FilterService);
  protected readonly lookup = inject(LookupService);
  readonly storeIds = signal<number[]>([]);

  readonly data = loadOn(
    () => {
      const s = this.storeIds();
      return s.length ? { s, p: this.filter.params() } : null;
    },
    ({ s, p }) => this.api.journeyMulti(s, p),
  );
  readonly highlights = computed(() => journeyHighlightCards(this.data.data()));
  readonly rangeLabel = computed(() => {
    const r = this.filter.range();
    return r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} – ${shortDate(r.to)}`;
  });

  constructor() {
    this.lookup.loadStores().subscribe();
    effect(() => {
      const stores = this.lookup.scopedStores();
      if (this.storeIds().length || !stores.length) return;
      const pref = this.filter.selectedStoreIds().filter((id) => stores.some((s) => s.id === id));
      this.storeIds.set(pref.length ? pref : [stores[0].id]);
    });
  }

  readonly sankey = computed(() => (this.data.data() ? toAcyclicSankey(this.data.data()!) : { nodes: [], links: [] }));
  readonly totalTransitions = computed(() => (this.data.data()?.links ?? []).reduce((s, l) => s + l.count, 0));
  readonly topLinks = computed(() => this.sankey().links.slice(0, 8));
  readonly maxLink = computed(() => Math.max(1, ...this.topLinks().map((l) => l.value)));
  readonly linksCsv = computed(() => ({ header: ['From', 'To', 'Shoppers'], rows: this.sankey().links.map((l) => [l.source, l.target, l.value]) }));

  readonly chart = computed<EChartsCoreOption>(() => {
    const s = this.sankey();
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: { dataType: string; data: { source: string; target: string; value: number }; name: string; value: number }) =>
          p.dataType === 'edge' ? `${p.data.source} → ${p.data.target}: <b>${formatNumber(p.data.value)}</b>` : `${p.name}: <b>${formatNumber(p.value)}</b>`,
      },
      series: [
        {
          type: 'sankey',
          data: s.nodes,
          links: s.links,
          left: 8,
          right: 120,
          nodeAlign: 'justify',
          top: 12,
          bottom: 12,
          nodeGap: 16,
          nodeWidth: 10,
          draggable: true,
          emphasis: { focus: 'adjacency' },
          levels: DEPTH_COLORS.map((c, depth) => ({ depth, itemStyle: { color: c }, lineStyle: { color: 'source', opacity: 0.18 } })),
          lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.2 },
          itemStyle: { borderWidth: 0 },
          label: {
            fontSize: 10,
            width: 86,
            overflow: 'truncate',
            backgroundColor: 'rgba(255,255,255,0.75)',
            borderRadius: 3,
            padding: [2, 4],
            color: '#344054',
            formatter: (p: { name: string; value: number }) => `${p.name.toUpperCase()} (${formatNumber(p.value)})`,
          },
        },
      ],
    };
  });
}
