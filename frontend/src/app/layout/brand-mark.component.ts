import { ChangeDetectionStrategy, Component, input } from '@angular/core';

let uid = 0;

/** Congruence Eye logo mark: an aperture/eye in a rounded square with the brand gradient (logo use only). */
@Component({
  selector: 'ce-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'brand-mark', '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    <svg viewBox="0 0 40 40" [attr.width]="size()" [attr.height]="size()" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient [attr.id]="gid" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#2563EB" />
          <stop offset="1" stop-color="#7C3AED" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" [attr.fill]="'url(#' + gid + ')'" />
      <path d="M7 20c3.4-5.6 8-8.4 13-8.4S29.6 14.4 33 20c-3.4 5.6-8 8.4-13 8.4S10.4 25.6 7 20Z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" />
      <circle cx="20" cy="20" r="4.6" fill="#fff" />
      <circle cx="21.6" cy="18.4" r="1.5" [attr.fill]="'url(#' + gid + ')'" />
    </svg>
  `,
})
export class BrandMarkComponent {
  readonly size = input(36);
  protected readonly gid = `ce-brand-grad-${++uid}`;
}
