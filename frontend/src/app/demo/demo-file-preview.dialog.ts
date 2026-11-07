import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { BytesPipe, DateTimePipe, HumanizePipe } from '../shared/pipes';
import { parseCsv } from './demo-utils';

export const PREVIEW_ROWS = 50;

interface DemoDocument {
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  category: string;
  storeName: string | null;
  uploadedByName: string;
  createdAt: string;
}

/** Shown instead of a file download in the online demo (downloads are not possible there). */
@Component({
  selector: 'ce-demo-file-preview',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, BytesPipe, DateTimePipe, HumanizePipe],
  template: `
    <h2 mat-dialog-title>{{ data.filename }}</h2>
    <mat-dialog-content data-testid="dialog-demo-file-preview">
      <div class="info-banner" style="margin-bottom: 12px">
        <mat-icon>info</mat-icon>
        <span>Online demo: downloads are disabled, so the file is previewed here.</span>
      </div>
      @if (doc(); as d) {
        <div class="stack" data-testid="demo-document-preview">
          <div class="row"><span class="material-symbols-outlined" style="font-size: 40px">description</span>
            <div>
              <div class="strong">{{ d.title }}</div>
              <div class="muted small">{{ d.fileName }} · {{ d.size | bytes }} · {{ d.mimeType }}</div>
              <div class="muted small">{{ d.category | humanize }} · {{ d.storeName ?? 'All stores' }} · uploaded by {{ d.uploadedByName }} · {{ d.createdAt | dt }}</div>
            </div>
          </div>
          <p class="muted">The document file itself isn't included in the online demo. In the installed product this downloads the original {{ d.fileName }}.</p>
        </div>
      } @else if (rows().length) {
        <div class="muted small" style="margin-bottom: 8px" data-testid="demo-preview-count">
          Showing {{ rows().length - 1 }} of {{ totalRows() }} row(s){{ isXlsx() ? ' — XLSX exports are previewed as a table' : '' }}
        </div>
        <div class="table-scroll" style="max-height: 60vh">
          <table class="ce-table demo-preview-table" data-testid="demo-preview-table">
            <thead>
              <tr>
                @for (h of rows()[0]; track $index) {
                  <th class="mat-mdc-header-cell" style="padding: 6px 10px; text-align: left; white-space: nowrap">{{ h }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (r of rows().slice(1); track $index) {
                <tr>
                  @for (c of r; track $index) {
                    <td style="padding: 4px 10px; border-top: 1px solid var(--ce-border); white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis" [title]="c">{{ c }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (loaded()) {
        <p class="muted" data-testid="demo-preview-empty">This file is empty for the selected filters ({{ data.blob.size | bytes }}).</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button mat-dialog-close data-testid="btn-close">Close</button>
    </mat-dialog-actions>
  `,
})
export class DemoFilePreviewDialog {
  readonly data = inject<{ blob: Blob; filename: string }>(MAT_DIALOG_DATA);
  readonly rows = signal<string[][]>([]);
  readonly totalRows = signal(0);
  readonly doc = signal<DemoDocument | null>(null);
  readonly loaded = signal(false);
  readonly isXlsx = signal(/\.xlsx$/i.test(this.data.filename));

  constructor() {
    void this.read();
  }

  private async read(): Promise<void> {
    const text = await this.data.blob.text();
    if (this.data.blob.type === 'application/x-demo-document') {
      try {
        this.doc.set(JSON.parse(text).demoDocument);
      } catch {
        /* fall through to text preview */
      }
    } else if (text.trim()) {
      const all = parseCsv(text);
      this.totalRows.set(Math.max(0, all.length - 1));
      this.rows.set(all.slice(0, PREVIEW_ROWS + 1));
    }
    this.loaded.set(true);
  }
}
