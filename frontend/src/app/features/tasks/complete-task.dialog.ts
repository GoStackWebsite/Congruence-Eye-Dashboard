import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Task, UploadResult } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { errorMessage } from '../../core/utils/format';
import { PROOF_RULE, validateFile } from '../checklists/_ui/ops';
import { OpsBaseStyles } from '../checklists/_ui/styles';

export interface CompleteTaskResult {
  proofUrl?: string;
  remark?: string;
}

/** Builds the PATCH /tasks/:id/status body for completion (only non-empty fields). */
export function completionBody(proofUrl: string | null, remark: string): { status: 'DONE'; proofUrl?: string; remark?: string } {
  const body: { status: 'DONE'; proofUrl?: string; remark?: string } = { status: 'DONE' };
  if (proofUrl) body.proofUrl = proofUrl;
  if (remark.trim()) body.remark = remark.trim();
  return body;
}

/** "Mark done" sheet: camera-first proof (photo or video, ≤ 50 MB) and a remark for the verifier. */
@Component({
  selector: 'ce-complete-task-dialog',
  imports: [FormsModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule, OpsBaseStyles],
  template: `
    <ce-ops-base-styles />
    <h2 mat-dialog-title>Complete task</h2>
    <mat-dialog-content data-testid="dialog-complete-task" class="stack" style="gap: 14px">
      <div>
        <div class="strong ellipsis" [title]="data.title">{{ data.title }}</div>
        <div class="caption">{{ data.storeName }} · attach proof for the verifier (optional)</div>
      </div>
      <input #file type="file" accept="image/*,video/*" capture="environment" hidden (change)="upload(file)" data-testid="input-proof-file" />
      @if (proofUrl(); as u) {
        <div class="ops-file-row">
          @if (isVideo()) {
            <video [src]="u" controls preload="metadata" style="width: 120px; border-radius: 8px" data-testid="proof-preview"></video>
          } @else {
            <img [src]="u" alt="Completion proof" style="width: 96px; height: 72px; object-fit: cover; border-radius: 8px" data-testid="proof-preview" />
          }
          <div class="meta">
            <div class="strong">{{ isVideo() ? 'Video' : 'Photo' }} attached</div>
            <div class="caption">{{ fileName() || 'Proof' }}</div>
          </div>
          <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="file.click()" [disabled]="uploading()" data-testid="btn-upload-proof">
            @if (uploading()) {
              <mat-spinner diameter="14" />
            }
            Retake
          </button>
        </div>
      } @else {
        <button type="button" class="ops-drop" [class.invalid]="!!fileError()" (click)="file.click()" [disabled]="uploading()" data-testid="btn-upload-proof" style="font: inherit; width: 100%">
          @if (uploading()) {
            <mat-spinner diameter="28" />
            <span class="t">Uploading…</span>
          } @else {
            <span class="material-symbols-outlined">add_a_photo</span>
            <span class="t">Take a photo or video</span>
            <span class="s">JPG, PNG, WebP, MP4, WebM or MOV · up to 50 MB</span>
          }
        </button>
      }
      @if (fileError()) {
        <div class="ops-err" role="alert"><span class="material-symbols-outlined">error</span>{{ fileError() }}</div>
      }
      <div>
        <label class="ce-field-label" for="ct-remark">Remark</label>
        <textarea id="ct-remark" class="fl-text" style="min-height: 84px; font-size: 14px; border-width: 1px; border-radius: 8px; width: 100%; padding: 10px 12px; border: 1px solid var(--c-border-strong); background: var(--c-surface); color: var(--c-text); font-family: var(--font)" rows="3" maxlength="1000" [(ngModel)]="remark" placeholder="What was done? Anything the verifier should know?" data-testid="input-remark"></textarea>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button type="button" class="ce-btn ce-btn-ghost" mat-dialog-close data-testid="btn-cancel">Cancel</button>
      <button type="button" class="ce-btn ce-btn-primary" [disabled]="uploading()" (click)="done()" data-testid="btn-complete-task"><mat-icon>task_alt</mat-icon> Mark done</button>
    </mat-dialog-actions>
  `,
})
export class CompleteTaskDialog {
  readonly data = inject<Task>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<CompleteTaskDialog, CompleteTaskResult>);
  private readonly api = inject(ApiService);
  readonly proofUrl = signal<string | null>(this.data.proofUrl ?? null);
  readonly uploading = signal(false);
  readonly isVideo = signal(/\.(mp4|webm|mov)$/i.test(this.data.proofUrl ?? ''));
  readonly fileName = signal<string | null>(null);
  readonly fileError = signal<string | null>(null);
  remark = this.data.remark ?? '';

  upload(input: HTMLInputElement): void {
    const f = input.files?.[0];
    if (!f) return;
    const err = validateFile(f, PROOF_RULE);
    this.fileError.set(err);
    if (err) {
      input.value = '';
      return;
    }
    const fd = new FormData();
    fd.append('file', f, f.name);
    this.uploading.set(true);
    this.api.upload<UploadResult>('/uploads', fd, silent()).subscribe({
      next: (r) => {
        this.proofUrl.set(r.url);
        this.isVideo.set(f.type.startsWith('video/'));
        this.fileName.set(f.name);
        this.uploading.set(false);
        input.value = '';
      },
      error: (e) => {
        this.uploading.set(false);
        this.fileError.set(`Upload failed: ${errorMessage(e)}`);
        input.value = '';
      },
    });
  }

  done(): void {
    const b = completionBody(this.proofUrl(), this.remark);
    this.ref.close({ proofUrl: b.proofUrl, remark: b.remark });
  }
}
