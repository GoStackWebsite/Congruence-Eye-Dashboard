import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LiveQueue } from '../../core/models/api.models';
import { PillComponent } from '../../shared/ds/pill.component';
import { DateTimePipe, DurationPipe } from '../../shared/pipes';

/** Live billing-queue card: length with a capacity bar (breach above `threshold`), wait, staffed status. */
@Component({
  selector: 'ce-queue-card',
  imports: [PillComponent, DurationPipe, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'queue-card', '[class.breach]': 'breach()', '[class.unstaffed]': '!q().counterStaffed' },
  template: `
    <div class="qc-head">
      <span class="qc-name ellipsis" [title]="q().name">{{ q().name }}</span>
      <ce-pill [tone]="q().counterStaffed ? 'good' : 'critical'" [label]="q().counterStaffed ? 'Staffed' : 'Unattended'" size="sm" [attr.data-value]="q().counterStaffed ? 'ONLINE' : 'OFFLINE'" />
    </div>
    @if (store()) {
      <div class="qc-store ellipsis" [title]="store()">{{ store() }}</div>
    }
    <div class="qc-main">
      <span class="q-len">{{ q().queueLength }}</span>
      <span class="qc-unit">in queue</span>
      @if (breach()) {
        <ce-pill tone="critical" label="Over limit" size="sm" />
      }
    </div>
    <div class="qc-bar" role="meter" [attr.aria-valuenow]="q().queueLength" aria-valuemin="0" [attr.aria-valuemax]="threshold()" [attr.aria-label]="'Queue length ' + q().queueLength + ' of ' + threshold()">
      <span [style.width.%]="fill()"></span>
      <i [style.left.%]="markPct()"></i>
    </div>
    <div class="qc-meta">Wait {{ q().avgWaitSec | duration }} · {{ q().ts | dt: 'relative' }}</div>
  `,
})
export class QueueCardComponent {
  readonly q = input.required<LiveQueue>();
  readonly store = input<string | null>(null);
  /** Allowed queue length (breach above it). */
  readonly threshold = input(5);
  protected readonly breach = computed(() => this.q().queueLength > this.threshold());
  private readonly scale = computed(() => Math.max(this.threshold() * 1.6, this.q().queueLength, 1));
  protected readonly fill = computed(() => (this.q().queueLength / this.scale()) * 100);
  protected readonly markPct = computed(() => (this.threshold() / this.scale()) * 100);
}
