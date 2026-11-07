import { ChangeDetectionStrategy, Component, effect, inject, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FilterService } from '../../core/services/filter.service';
import { LookupService } from '../../core/services/lookup.service';

/**
 * Single-store picker. When `autoSelect` is on and nothing is chosen, it picks the first
 * store from the global filter selection (or the first store in scope).
 */
@Component({
  selector: 'ce-store-picker',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field subscriptSizing="dynamic" [style.width]="width()">
      <mat-label>{{ label() }}</mat-label>
      <mat-select [ngModel]="value()" (ngModelChange)="value.set($event)" [attr.data-testid]="testId()">
        @if (allowAll()) {
          <mat-option [value]="null">All stores</mat-option>
        }
        @for (s of lookup.scopedStores(); track s.id) {
          <mat-option [value]="s.id" [attr.data-testid]="testId() + '-option-' + s.id">{{ s.name }}</mat-option>
        }
      </mat-select>
    </mat-form-field>
  `,
})
export class StorePickerComponent {
  protected readonly lookup = inject(LookupService);
  private readonly filter = inject(FilterService);
  readonly value = model<number | null>(null);
  readonly label = input('Store');
  readonly testId = input('select-store');
  readonly allowAll = input(false);
  readonly autoSelect = input(true);
  readonly width = input('220px');

  constructor() {
    this.lookup.loadStores().subscribe();
    effect(() => {
      if (!this.autoSelect() || this.value() !== null) return;
      const stores = this.lookup.scopedStores();
      if (!stores.length) return;
      const preferred = this.filter.selectedStoreIds().find((id) => stores.some((s) => s.id === id));
      this.value.set(preferred ?? stores[0].id);
    });
  }
}
