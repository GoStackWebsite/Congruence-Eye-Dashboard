import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { humanize } from '../../core/utils/format';
import { STATUS_LABELS, TONE_ICON, Tone, toneOf } from '../ds/status-tones';

/** Page title row with optional actions slot. */
@Component({
  selector: 'ce-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-header">
      <div class="page-title-block">
        <h1 class="page-title" data-testid="page-title">{{ title() }}</h1>
        @if (subtitle()) {
          <p class="page-subtitle">{{ subtitle() }}</p>
        }
      </div>
      <div class="page-actions"><ng-content /></div>
    </div>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
}

/**
 * Empty state (ce-empty-state): icon, title, explanation, optional action (projected). `kind` picks default copy and
 * icon for "no data yet", "no results for filters", "no permission" and "error".
 */
export const EMPTY_KINDS = {
  'no-data': { icon: 'inbox', title: 'No data yet', message: 'Data will appear here once the stores start reporting.' },
  filtered: { icon: 'filter_alt_off', title: 'No results for these filters', message: 'Try a different store selection or date range.' },
  'no-permission': { icon: 'lock', title: 'You don\'t have access', message: 'Ask an administrator for access to this area.' },
  error: { icon: 'cloud_off', title: 'Couldn\'t load this', message: 'Check your connection and try again.' },
} as const;
export type EmptyKind = keyof typeof EMPTY_KINDS;

@Component({
  selector: 'ce-empty-state',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'empty-state', '[attr.data-kind]': 'kind()' },
  template: `
    <div class="empty-state" [class.compact]="compact()">
      <span class="empty-icon" aria-hidden="true"><mat-icon>{{ icon() ?? preset().icon }}</mat-icon></span>
      <div class="empty-title">{{ title() ?? preset().title }}</div>
      @if (message() !== null ? message() : !title() ? preset().message : null; as msg) {
        <div class="empty-message">{{ msg }}</div>
      }
      <div class="empty-actions"><ng-content /></div>
    </div>
  `,
})
export class EmptyStateComponent {
  readonly kind = input<EmptyKind>('no-data');
  readonly icon = input<string | null>(null);
  readonly title = input<string | null>(null);
  readonly message = input<string | null>(null);
  readonly compact = input(false);
  protected readonly preset = computed(() => EMPTY_KINDS[this.kind()]);
}

/** Top progress bar + skeleton blocks while loading; error banner when failed. */
@Component({
  selector: 'ce-load-state',
  imports: [MatProgressBarModule, MatIconModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" class="load-bar" data-testid="loading" />
      @if (!hasData()) {
        <div class="skeleton-grid">
          @for (i of rowsArr(); track i) {
            <div class="skeleton skeleton-block"></div>
          }
        </div>
      }
    }
    @if (error() && !loading()) {
      <div class="error-banner" role="alert" data-testid="error-banner">
        <mat-icon aria-hidden="true">error</mat-icon>
        <span>{{ error() }}</span>
      </div>
    }
  `,
})
export class LoadStateComponent {
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly hasData = input(false);
  readonly rows = input(3);
  protected readonly rowsArr = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}

/** Tone of a status value (for chips whose data-value is a different enum than their colour key). */
export function chipTone(value: string | null | undefined): string {
  return toneOf(value);
}

/** Status chip: colour + icon + label (never colour alone). */
@Component({
  selector: 'ce-chip',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="ce-chip" [class]="'ce-chip tone-' + tone()" [attr.data-testid]="testId()" [attr.data-value]="value()"
    ><span class="ce-pill-dot" aria-hidden="true"></span><mat-icon aria-hidden="true">{{ icon() }}</mat-icon>{{ label() || humanized() }}</span
  >`,
})
export class StatusChipComponent {
  readonly value = input.required<string | null | undefined>();
  readonly label = input<string | null>(null);
  readonly toneOverride = input<string | null>(null, { alias: 'tone' });
  readonly testId = input<string | null>('chip');
  protected readonly tone = computed(() => this.toneOverride() ?? toneOf(this.value()));
  protected readonly icon = computed(() => TONE_ICON[this.tone() as Tone] ?? 'circle');
  protected readonly humanized = computed(() => STATUS_LABELS[this.value() ?? ''] ?? humanize(this.value() ?? ''));
}

export interface ConfirmData {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}

@Component({
  selector: 'ce-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content data-testid="dialog-confirm">{{ data.message }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false" data-testid="btn-cancel">Cancel</button>
      <button mat-flat-button [class.danger]="data.danger" [mat-dialog-close]="true" data-testid="btn-confirm">
        {{ data.confirmText ?? 'Confirm' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
}

export const UI = [PageHeaderComponent, EmptyStateComponent, LoadStateComponent, StatusChipComponent] as const;
