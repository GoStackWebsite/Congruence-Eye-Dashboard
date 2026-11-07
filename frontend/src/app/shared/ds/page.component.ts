import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { BreadcrumbService } from '../../core/services/breadcrumb.service';
import { FilterService } from '../../core/services/filter.service';

/**
 * Page frame (ce-page): optional breadcrumbs, title + one-line description + "Last refreshed at", right-aligned
 * actions (`[pageActions]`), optional underline tabs (`[pageTabs]`), then the page body.
 */
@Component({
  selector: 'ce-page',
  imports: [RouterLink, DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ce-page' },
  template: `
    <header class="ce-page-head">
      @if (backLink()) {
        <a class="ce-page-back" [routerLink]="backLink()" aria-label="Back" data-testid="btn-page-back"><mat-icon>arrow_back</mat-icon></a>
      }
      <div class="ce-page-titles">
        @if (breadcrumbs()) {
          <nav class="ce-page-crumbs" aria-label="Breadcrumb">
            @for (c of crumbs.crumbs(); track $index; let last = $last) {
              @if (c.link && !last) {
                <a [routerLink]="c.link">{{ c.label }}</a>
              } @else {
                <span [class.current]="last">{{ c.label }}</span>
              }
              @if (!last) {
                <mat-icon class="sep" aria-hidden="true">chevron_right</mat-icon>
              }
            }
          </nav>
        }
        <div class="ce-page-title-row">
          <h1 class="ce-page-title" data-testid="page-title">{{ title() }}</h1>
          <ng-content select="[pageBadge]" />
        </div>
        @if (description() || refreshedAt()) {
          <p class="ce-page-desc">
            @if (description()) {
              <span>{{ description() }}</span>
            }
            @if (refreshedAt()) {
              <span class="ce-page-refreshed" data-testid="page-last-refreshed">Last refreshed at {{ refreshedAt() | date: 'h:mm a' }}</span>
            }
          </p>
        }
      </div>
      <div class="ce-page-actions"><ng-content select="[pageActions]" /></div>
    </header>
    <ng-content select="[pageTabs]" />
    <div class="ce-page-body"><ng-content /></div>
  `,
})
export class PageComponent {
  protected readonly crumbs = inject(BreadcrumbService);
  private readonly filter = inject(FilterService);
  readonly title = input.required<string>();
  readonly description = input<string | null>(null);
  /** true → follows the global filter's refresh time; a Date → that time; false → hidden. */
  readonly lastRefreshed = input<boolean | Date | null>(false);
  readonly breadcrumbs = input(false);
  readonly backLink = input<string | unknown[] | null>(null);
  protected readonly refreshedAt = computed(() => {
    const v = this.lastRefreshed();
    if (v === true) return this.filter.lastRefreshed();
    return v instanceof Date ? v : null;
  });
}
