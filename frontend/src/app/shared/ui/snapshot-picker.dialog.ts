import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { SNAPSHOT_KINDS, SnapshotImage } from '../../core/models/api.models';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { DateTimePipe, HumanizePipe } from '../pipes';
import { EmptyStateComponent, LoadStateComponent } from './ui.components';

export interface SnapshotPickerData {
  storeId: number;
  cameraId: number;
  title?: string;
}

/** Picks one snapshot of a camera from the image directory (e.g. a "full shelf" reference for SHELF zones). */
@Component({
  selector: 'ce-snapshot-picker',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatPaginatorModule, LoadStateComponent, EmptyStateComponent, DateTimePipe, HumanizePipe],
  template: `
    <h2 mat-dialog-title>{{ data.title ?? 'Choose a snapshot' }}</h2>
    <mat-dialog-content data-testid="dialog-snapshot-picker">
      <div class="toolbar" style="margin-bottom: 12px">
        <mat-form-field subscriptSizing="dynamic" style="width: 200px">
          <mat-label>Kind</mat-label>
          <mat-select [ngModel]="kind()" (ngModelChange)="kind.set($event); page.set(1)" data-testid="filter-picker-kind">
            <mat-option [value]="null">All</mat-option>
            @for (k of kinds; track k) {
              <mat-option [value]="k">{{ k | humanize }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      <ce-load-state [loading]="images.loading()" [error]="images.error()" [hasData]="!!images.data()" [rows]="1" />
      <div class="gallery">
        @for (img of images.data()?.items ?? []; track img.id) {
          <button type="button" class="gallery-item" [style.outline]="selected()?.id === img.id ? '3px solid var(--ce-primary)' : 'none'" (click)="selected.set(img)" [attr.data-testid]="'picker-image-' + img.id">
            <img [src]="img.url" [alt]="img.cameraName + ' ' + img.ts" loading="lazy" />
            <div class="gi-meta">{{ img.ts | dt }} · {{ img.kind | humanize }}</div>
          </button>
        }
      </div>
      @if (images.loaded() && !(images.data()?.items ?? []).length) {
        <ce-empty-state icon="hide_image" title="No snapshots for this camera" />
      }
      <mat-paginator [length]="images.data()?.total ?? 0" [pageIndex]="page() - 1" [pageSize]="12" [hidePageSize]="true" (page)="onPage($event)" />
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close data-testid="btn-cancel">Cancel</button>
      <button mat-flat-button [disabled]="!selected()" (click)="ref.close(selected())" data-testid="btn-select-snapshot">Use this snapshot</button>
    </mat-dialog-actions>
  `,
})
export class SnapshotPickerDialog {
  readonly data = inject<SnapshotPickerData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<SnapshotPickerDialog, SnapshotImage>);
  private readonly v2 = inject(V2Api);
  readonly kinds = SNAPSHOT_KINDS;
  readonly kind = signal<string | null>(null);
  readonly page = signal(1);
  readonly selected = signal<SnapshotImage | null>(null);
  readonly images = loadOn(
    () => ({ k: this.kind(), p: this.page() }),
    ({ k, p }) => this.v2.imageDirectory({ storeIds: [this.data.storeId], cameraId: this.data.cameraId, kind: k, page: p, pageSize: 12 }),
  );

  onPage(e: PageEvent): void {
    this.page.set(e.pageIndex + 1);
  }
}
