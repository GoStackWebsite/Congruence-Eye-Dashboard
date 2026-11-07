import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatSelectModule } from '@angular/material/select';
import { LookupService } from '../../core/services/lookup.service';
import { useOpsStyles } from './ops.styles';

/** "Store: All stores ▾" dropdown chip for list toolbars (scoped to the user's stores). */
@Component({
  selector: 'ce-store-chip-filter',
  imports: [FormsModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <mat-select class="ops-chip-select" [class.is-set]="value() !== null" [ngModel]="value()" (ngModelChange)="value.set($event)" [placeholder]="label() + ': All stores'" [attr.data-testid]="testId()" [aria-label]="label()">
      <mat-select-trigger><span class="ops-chip-label">{{ label() }}:</span>{{ selectedName() }}</mat-select-trigger>
      <mat-option [value]="null">All stores</mat-option>
      @for (s of lookup.scopedStores(); track s.id) {
        <mat-option [value]="s.id" [attr.data-testid]="testId() + '-option-' + s.id">{{ s.name }}</mat-option>
      }
    </mat-select>
  `,
})
export class StoreChipFilterComponent {
  protected readonly opsCss = useOpsStyles();
  protected readonly lookup = inject(LookupService);
  readonly value = model<number | null>(null);
  readonly label = input('Store');
  readonly testId = input('filter-store');
  protected readonly selectedName = computed(() => this.lookup.scopedStores().find((s) => s.id === this.value())?.name ?? 'All stores');

  constructor() {
    this.lookup.loadStores().subscribe();
  }
}
