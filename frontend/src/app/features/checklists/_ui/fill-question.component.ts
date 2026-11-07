import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AiResult, Question } from '../../../core/models/api.models';
import { parseMulti } from '../../../core/utils/checklist-score';

export interface AnswerDraft {
  value: string;
  photoUrl: string | null;
  remark: string;
  showRemark: boolean;
}

/** Why a required question is not complete yet (shown inline and on the review screen). */
export function missingReason(q: Question, a: AnswerDraft | undefined): string {
  if (q.type === 'VIDEO') return 'A video is required';
  if (q.requiresPhoto && !a?.photoUrl) return 'A photo is required';
  return 'This question is required';
}

/** True when the question has any answer (used for progress). */
export function isAnswered(q: Question, a: AnswerDraft | undefined): boolean {
  if (!a) return false;
  if (q.type === 'MCQ_MULTI') return parseMulti(a.value).length > 0;
  return !!(a.value ?? '').trim() || !!a.photoUrl;
}

/**
 * One checklist question as staff fill it on a phone (mobile-first, 44px+ targets): Yes/No as big segmented
 * buttons, MCQ as tappable rows, star rating, number stepper, camera-first photo/video capture with thumbnail and
 * retake, remark, and the "Check with AI" result inline. `preview` renders the same card read-only (builder preview).
 */
@Component({
  selector: 'ce-fill-question',
  imports: [MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let q = question();
    @let a = answer();
    @let id = preview() ? null : q.id;
    <article class="fl-card" [class.invalid]="invalid()" [class.redo]="redo()" [attr.data-testid]="id !== null ? 'question-' + id : null" [attr.aria-label]="'Question ' + position()">
      <div class="q-meta">
        <span class="sec">{{ q.section || 'General' }}</span>
        <span>·</span>
        <span>Question {{ position() }} of {{ total() }}</span>
        @if (redo()) {
          <span class="ce-pill tone-serious sm"><span class="ce-pill-dot"></span>Redo requested</span>
        }
      </div>
      <h2 class="q-text">
        {{ q.text || 'Untitled question' }}
        @if (q.required) {
          <span class="req" aria-label="required">*</span>
        }
      </h2>
      @if (hint()) {
        <div class="q-hint">{{ hint() }}</div>
      }

      @switch (q.type) {
        @case ('YES_NO') {
          <div class="fl-yesno" role="radiogroup" [attr.aria-label]="q.text" [attr.data-testid]="id !== null ? 'input-answer-' + id : null">
            <button type="button" class="yes" [class.checked]="a.value === 'YES'" role="radio" [attr.aria-checked]="a.value === 'YES'" (click)="set('YES')" [disabled]="preview()" data-testid="answer-yes">
              <span class="material-symbols-outlined">check_circle</span> Yes
            </button>
            <button type="button" class="no" [class.checked]="a.value === 'NO'" role="radio" [attr.aria-checked]="a.value === 'NO'" (click)="set('NO')" [disabled]="preview()" data-testid="answer-no">
              <span class="material-symbols-outlined">cancel</span> No
            </button>
          </div>
        }
        @case ('MCQ_SINGLE') {
          <div class="fl-options" role="radiogroup" [attr.aria-label]="q.text" [attr.data-testid]="id !== null ? 'input-answer-' + id : null">
            @for (o of q.options ?? []; track o) {
              <label class="fl-opt" [class.checked]="a.value === o">
                <input type="radio" [name]="'q' + (q.id ?? position())" [value]="o" [checked]="a.value === o" (change)="set(o)" [disabled]="preview()" />
                <span>{{ o }}</span>
              </label>
            }
          </div>
        }
        @case ('MCQ_MULTI') {
          <div class="fl-options" role="group" [attr.aria-label]="q.text" [attr.data-testid]="id !== null ? 'input-answer-' + id : null">
            @for (o of q.options ?? []; track o) {
              <label class="fl-opt" [class.checked]="picked().includes(o)">
                <input type="checkbox" [checked]="picked().includes(o)" (change)="toggleMulti(o, $any($event.target).checked)" [disabled]="preview()" />
                <span>{{ o }}</span>
              </label>
            }
          </div>
        }
        @case ('NUMBER') {
          <div class="fl-number">
            <button type="button" (click)="step(-1)" [disabled]="preview()" aria-label="Decrease"><span class="material-symbols-outlined">remove</span></button>
            <input
              type="number"
              inputmode="decimal"
              [value]="a.value"
              (input)="set($any($event.target).value)"
              [disabled]="preview()"
              [attr.aria-label]="q.text"
              [attr.data-testid]="id !== null ? 'input-answer-' + id : null"
            />
            <button type="button" (click)="step(1)" [disabled]="preview()" aria-label="Increase"><span class="material-symbols-outlined">add</span></button>
          </div>
        }
        @case ('RATING') {
          <div class="fl-rating" role="radiogroup" [attr.aria-label]="q.text" [attr.data-testid]="id !== null ? 'input-answer-' + id : null">
            @for (n of [1, 2, 3, 4, 5]; track n) {
              <button type="button" [class.on]="+a.value >= n" (click)="set('' + n)" [disabled]="preview()" role="radio" [attr.aria-checked]="+a.value === n" [attr.aria-label]="n + ' star' + (n > 1 ? 's' : '')" [attr.data-testid]="'rating-' + n">
                <span class="material-symbols-outlined">star</span>
              </button>
            }
            @if (+a.value) {
              <span class="lbl">{{ a.value }} / 5</span>
            }
          </div>
        }
        @case ('PHOTO') {}
        @case ('VIDEO') {
          <div class="fl-capture" [attr.data-testid]="id !== null ? 'input-answer-' + id : null">
            <input #vid type="file" accept="video/*" capture="environment" hidden (change)="videoPicked.emit(vid)" [attr.data-testid]="id !== null ? 'input-video-' + id : null" />
            @if (a.value) {
              <div class="fl-media">
                <div class="thumb"><video [src]="a.value" controls preload="metadata" playsinline [attr.data-testid]="id !== null ? 'video-preview-' + id : null"></video></div>
                <div class="side">
                  <button type="button" class="ce-btn ce-btn-secondary" (click)="vid.click()" [disabled]="uploading() || preview()" [attr.data-testid]="id !== null ? 'btn-upload-video-' + id : null">
                    @if (uploading()) {
                      <mat-spinner diameter="16" />
                    } @else {
                      <span class="material-symbols-outlined">videocam</span>
                    }
                    Retake video
                  </button>
                  <span class="caption">MP4, WebM or MOV · up to 50 MB</span>
                </div>
              </div>
            } @else {
              <button type="button" class="fl-capture-btn" (click)="vid.click()" [disabled]="uploading() || preview()" [attr.data-testid]="id !== null ? 'btn-upload-video-' + id : null">
                @if (uploading()) {
                  <mat-spinner diameter="28" />
                  Uploading…
                } @else {
                  <span class="material-symbols-outlined">videocam</span>
                  Record a video
                  <small>MP4, WebM or MOV · up to 50 MB</small>
                }
              </button>
            }
          </div>
        }
        @default {
          <textarea class="fl-text" [value]="a.value" (input)="set($any($event.target).value)" [disabled]="preview()" placeholder="Type your answer" [attr.aria-label]="q.text" [attr.data-testid]="id !== null ? 'input-answer-' + id : null"></textarea>
        }
      }

      @if (needsPhoto()) {
        <div class="fl-capture">
          <input #file type="file" accept="image/*" capture="environment" hidden (change)="photoPicked.emit(file)" [attr.data-testid]="id !== null ? 'input-photo-' + id : null" />
          @if (a.photoUrl) {
            <div class="fl-media">
              <div class="thumb"><img [src]="a.photoUrl" alt="Captured photo" [attr.data-testid]="id !== null ? 'photo-preview-' + id : null" /></div>
              <div class="side">
                <button type="button" class="ce-btn ce-btn-secondary" (click)="file.click()" [disabled]="uploading() || preview()" [attr.data-testid]="id !== null ? 'btn-upload-photo-' + id : null">
                  @if (uploading()) {
                    <mat-spinner diameter="16" />
                  } @else {
                    <span class="material-symbols-outlined">photo_camera</span>
                  }
                  Retake photo
                </button>
                @if (hasAi()) {
                  <button type="button" class="ce-btn ce-btn-primary" (click)="checkAi.emit()" [disabled]="aiChecking() || uploading() || preview()" [attr.data-testid]="id !== null ? 'btn-ai-check-' + id : null">
                    @if (aiChecking()) {
                      <mat-spinner diameter="16" />
                      Checking…
                    } @else {
                      <span class="material-symbols-outlined">auto_awesome</span>
                      Check with AI
                    }
                  </button>
                }
              </div>
            </div>
          } @else {
            <button type="button" class="fl-capture-btn" (click)="file.click()" [disabled]="uploading() || preview()" [attr.data-testid]="id !== null ? 'btn-upload-photo-' + id : null">
              @if (uploading()) {
                <mat-spinner diameter="28" />
                Uploading…
              } @else {
                <span class="material-symbols-outlined">photo_camera</span>
                {{ q.type === 'PHOTO' ? 'Take photo' : 'Add a photo' }}{{ q.requiresPhoto ? ' *' : '' }}
                <small>Opens the camera · JPG, PNG or WebP</small>
              }
            </button>
          }
        </div>
      }

      @if (uploadError()) {
        <div class="ops-err" role="alert" data-testid="upload-error"><span class="material-symbols-outlined">error</span>{{ uploadError() }}</div>
      }

      @if (hasAi()) {
        @if (aiResult(); as ai) {
          <div class="fl-ai" [attr.data-testid]="id !== null ? 'ai-result-' + id : null" [attr.data-status]="ai.status" role="status">
            <div class="row1">
              <span class="ai-status" data-testid="ai-status">{{ ai.status }}</span>
              <span>AI {{ q.aiCheck === 'UNIFORM' ? 'uniform & grooming' : 'reference match' }}</span>
              @if (ai.status === 'PASS' || ai.status === 'FAIL') {
                <span>· confidence {{ (ai.score * 100).toFixed(0) }}%</span>
              }
            </div>
            <div class="msg" data-testid="ai-message">{{ ai.message }}</div>
            @if (ai.status === 'ERROR' || ai.status === 'SKIPPED') {
              <div class="caption" data-testid="ai-not-penalised">You can still submit — this answer won't be penalised if the AI check can't run.</div>
            }
            @if (ai.issues.length) {
              <ul data-testid="ai-issues">
                @for (i of ai.issues; track i) {
                  <li>{{ i }}</li>
                }
              </ul>
            }
            @if (ai.annotatedUrl) {
              <img [src]="ai.annotatedUrl" alt="AI annotated photo" data-testid="ai-annotated" />
            }
          </div>
        } @else {
          <div class="fl-hint-ai">
            <span class="material-symbols-outlined">auto_awesome</span>
            AI {{ q.aiCheck === 'UNIFORM' ? 'uniform & grooming' : 'reference match' }} check runs on submit{{ a.photoUrl ? ' — or check now' : '' }}
          </div>
        }
      }

      <div class="fl-tools">
        <button type="button" class="ce-btn ce-btn-ghost ce-btn-sm" (click)="toggleRemark.emit()" [disabled]="preview()" [attr.data-testid]="id !== null ? 'btn-remark-' + id : null" [attr.aria-expanded]="a.showRemark">
          <span class="material-symbols-outlined">{{ a.remark ? 'chat' : 'add_comment' }}</span>{{ a.showRemark ? 'Hide remark' : a.remark ? 'Edit remark' : 'Add remark' }}
        </button>
      </div>
      @if (a.showRemark) {
        <input class="fl-remark" [value]="a.remark" (input)="remarkChange.emit($any($event.target).value)" placeholder="Add a remark for the reviewer" maxlength="500" aria-label="Remark" [attr.data-testid]="id !== null ? 'input-remark-' + id : null" />
      }
      @if (invalid()) {
        <div class="question-error" role="alert"><span class="material-symbols-outlined" aria-hidden="true">error</span><span data-testid="question-error">{{ errorText() }}</span></div>
      }
    </article>
  `,
})
export class FillQuestionComponent {
  readonly question = input.required<Question>();
  readonly answer = input<AnswerDraft>({ value: '', photoUrl: null, remark: '', showRemark: false });
  readonly position = input(1);
  readonly total = input(1);
  readonly invalid = input(false);
  readonly redo = input(false);
  readonly errorText = input('This question is required');
  readonly uploading = input(false);
  readonly aiChecking = input(false);
  readonly aiResult = input<AiResult | null | undefined>(null);
  readonly preview = input(false);
  readonly uploadError = input<string | null>(null);

  readonly valueChange = output<string>();
  readonly remarkChange = output<string>();
  readonly toggleRemark = output<void>();
  readonly photoPicked = output<HTMLInputElement>();
  readonly videoPicked = output<HTMLInputElement>();
  readonly checkAi = output<void>();

  protected readonly picked = computed(() => parseMulti(this.answer().value));
  protected readonly needsPhoto = computed(() => {
    const q = this.question();
    return q.type === 'PHOTO' || (q.requiresPhoto && q.type !== 'VIDEO');
  });
  protected readonly hasAi = computed(() => {
    const q = this.question();
    return !!q.aiCheck && q.aiCheck !== 'NONE' && this.needsPhoto();
  });
  protected readonly hint = computed(() => {
    const q = this.question();
    if (q.type === 'NUMBER' && (q.minValue !== null && q.minValue !== undefined || q.maxValue !== null && q.maxValue !== undefined)) {
      return `Expected ${q.minValue ?? '−∞'} – ${q.maxValue ?? '∞'}`;
    }
    if (q.type === 'MCQ_MULTI') return 'Select all that apply';
    if (q.requiresPhoto && q.type !== 'PHOTO' && q.type !== 'VIDEO') return 'A photo is required as evidence';
    return null;
  });

  set(v: string): void {
    if (this.preview()) return;
    this.valueChange.emit(v ?? '');
  }

  step(d: number): void {
    const raw = this.answer().value;
    const cur = Number(raw);
    if (raw === '' || !Number.isFinite(cur)) {
      this.set(String(Number(this.question().minValue ?? 0)));
      return;
    }
    this.set(String(Math.round((cur + d) * 100) / 100));
  }

  toggleMulti(o: string, on: boolean): void {
    const cur = this.picked().filter((x) => x !== o);
    if (on) cur.push(o);
    const ordered = (this.question().options ?? []).filter((x) => cur.includes(x));
    this.set(ordered.length ? JSON.stringify(ordered) : '');
  }
}
