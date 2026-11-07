import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Soft background / ink pairs; picked deterministically from the name so a person keeps their colour. */
export const AVATAR_TONES: [string, string][] = [
  ['#e0f2fe', '#026aa2'],
  ['#ebe9fe', '#5925dc'],
  ['#fce7f6', '#c11574'],
  ['#dcfae6', '#067647'],
  ['#fef0c7', '#b54708'],
  ['#e0eaff', '#3538cd'],
  ['#fee4e2', '#b42318'],
  ['#f2f4f7', '#344054'],
];

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s._@-]/gu, ' ')
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarTone(name: string | null | undefined): [string, string] {
  let h = 0;
  for (const ch of name ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** Initials avatar with a deterministic colour (ce-avatar). */
@Component({
  selector: 'ce-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ce-avatar',
    '[style.--av-size]': 'size() + "px"',
    '[style.background]': 'tone()[0]',
    '[style.color]': 'tone()[1]',
    '[attr.title]': 'name()',
    role: 'img',
    '[attr.aria-label]': 'name()',
  },
  template: `{{ initials() }}`,
})
export class AvatarComponent {
  readonly name = input<string | null | undefined>('');
  readonly size = input(28);
  protected readonly initials = computed(() => initialsOf(this.name()));
  protected readonly tone = computed(() => avatarTone(this.name()));
}
