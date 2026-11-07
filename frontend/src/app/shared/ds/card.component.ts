import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Card (ce-card): title with an info tooltip (metric definition), subtitle, header actions (`[cardActions]`),
 * body. `flush` removes body padding for tables; `icon` adds a tinted leading icon like the Tango chart cards.
 */
@Component({
  selector: 'ce-card',
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-card', '[class.flush]': 'flush()', '[class.fill]': 'fill()' },
  template: `
    @if (title() || subtitle()) {
      <header class="ce-card-head">
        @if (icon()) {
          <span class="ce-card-icon" aria-hidden="true"><span class="material-symbols-outlined">{{ icon() }}</span></span>
        }
        <div class="ce-card-titles">
          <h2 class="ce-card-title">
            <span>{{ title() }}</span>
            @if (info()) {
              <mat-icon class="ce-info" [matTooltip]="info()!" tabindex="0" role="img" aria-hidden="false" [attr.aria-label]="'About: ' + info()">info</mat-icon>
            }
            <ng-content select="[cardBadge]" />
          </h2>
          @if (subtitle()) {
            <p class="ce-card-sub">{{ subtitle() }}</p>
          }
        </div>
        <div class="ce-card-actions"><ng-content select="[cardActions]" /></div>
      </header>
    }
    <div class="ce-card-body"><ng-content /></div>
    <ng-content select="[cardFooter]" />
  `,
})
export class CardComponent {
  readonly title = input<string | null>(null);
  readonly subtitle = input<string | null>(null);
  readonly info = input<string | null>(null);
  readonly icon = input<string | null>(null);
  readonly flush = input(false);
  /** Stretch to the grid row height. */
  readonly fill = input(false);
}
