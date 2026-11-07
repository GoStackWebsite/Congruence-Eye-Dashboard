import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { humanize } from '../../core/utils/format';
import { STATUS_LABELS, Tone, toneOf } from './status-tones';

/**
 * Status pill (ce-pill): soft tinted background, coloured text, leading dot (or icon). The tone comes from
 * STATUS_TONES unless `tone` is given; the label is never colour-alone.
 */
@Component({
  selector: 'ce-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"ce-pill tone-" + resolvedTone() + (size() === "sm" ? " sm" : "")',
    '[attr.data-value]': 'value()',
  },
  template: `
    @if (icon()) {
      <span class="material-symbols-outlined ce-pill-icon" aria-hidden="true">{{ icon() }}</span>
    } @else if (dot()) {
      <span class="ce-pill-dot" aria-hidden="true"></span>
    }
    <span class="ce-pill-label">{{ text() }}</span>
  `,
})
export class PillComponent {
  readonly value = input<string | null | undefined>(null);
  readonly label = input<string | null>(null);
  readonly tone = input<Tone | null>(null);
  readonly icon = input<string | null>(null);
  readonly dot = input(true);
  readonly size = input<'sm' | 'md'>('md');
  protected readonly resolvedTone = computed(() => this.tone() ?? toneOf(this.value()));
  protected readonly text = computed(() => this.label() ?? STATUS_LABELS[this.value() ?? ''] ?? humanize(this.value() ?? ''));
}
