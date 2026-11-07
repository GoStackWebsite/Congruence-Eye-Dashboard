import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { catchError, finalize, of, switchMap } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { AiResult, AnswerInput, Assignment, Question, Submission, SubmissionCreate, UploadResult } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { V2Api } from '../../core/services/v2.api';
import { groupBySection, missingRequired, previewScore, serverAnswerIssues } from '../../core/utils/checklist-score';
import { errorMessage } from '../../core/utils/format';
import { safeStorage } from '../../core/utils/storage';
import { DS } from '../../shared/ds';
import { PctPipe } from '../../shared/pipes';
import { UiService } from '../../shared/ui/ui.service';
import { AnswerDraft, FillQuestionComponent, isAnswered, missingReason } from './_ui/fill-question.component';
import { mediaSignal } from './_ui/media';
import { IMAGE_RULE, VIDEO_RULE, dueInfo, storeDate, storeDateTime, validateFile } from './_ui/ops';
import { FILL_STYLES } from './_ui/styles';
import { HasUnsavedChanges } from '../../shared/ds/unsaved-changes.guard';

/** Friendly message when the AI preview is unavailable (ai-service down / timeout). */
export function aiErrorMessage(e: unknown): string {
  const m = errorMessage(e);
  return `AI check unavailable right now (${m}). You can still submit — the answer won't be penalised.`;
}

/** Index of the question to open first: the first redo question, else the first unanswered one, else 0. */
export function startIndex(questions: Question[], answers: Record<number, AnswerDraft>, redo: Set<number>): number {
  const r = questions.findIndex((q) => redo.has(q.id!));
  if (r >= 0) return r;
  return 0;
}

const FILLABLE = ['PENDING', 'IN_PROGRESS', 'OVERDUE', 'REDO'];

/**
 * Trax › Fill checklist — mobile-first (store staff fill these on phones every day). One question card at a time with
 * a sticky progress bar and section stepper, big tap targets, camera-first evidence, inline AI check, Save draft,
 * Previous / Next, a final review listing unanswered required questions, Submit with confirmation and a score screen.
 * Desktop: the same card in a centred 720 px column with the question outline on the left.
 */
@Component({
  selector: 'ce-fill-checklist-page',
  imports: [NgTemplateOutlet, RouterLink, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, ...DS, ...FILL_STYLES, FillQuestionComponent, PctPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles /><ce-ops-fill-styles /><ce-ops-fill-inputs-styles /><ce-ops-fill-actions-styles />
    <section class="fl-page" data-testid="page-checklist-fill">
      @if (result(); as r) {
        <div class="fl-result" data-testid="checklist-score-result">
          <div class="ring" [style.--p]="r.scorePct" [style.--ring]="r.scorePct >= 85 ? 'var(--c-success)' : r.scorePct >= 60 ? 'var(--c-warning)' : 'var(--c-danger)'" role="img" [attr.aria-label]="'Score ' + (r.scorePct | pct)">
            <span class="v" data-testid="result-score-pct">{{ r.scorePct | pct }}</span>
          </div>
          <h1>Checklist submitted</h1>
          <p data-testid="result-score">Score {{ r.score }} / {{ r.maxScore }} · {{ r.templateName }} · {{ r.storeName }}</p>
          @if (r.flags) {
            <span class="flags" data-testid="result-flags"><span class="material-symbols-outlined">flag</span>{{ r.flags }} answer(s) flagged for follow-up</span>
          }
          <p class="caption">Your manager will review it. You'll be notified if anything needs a redo.</p>
          <div class="acts">
            <a class="ce-btn ce-btn-secondary" routerLink="/checklists/assignments" data-testid="btn-back-to-checklists">Back to my checklists</a>
            <a class="ce-btn ce-btn-primary" [routerLink]="['/checklists/submissions', r.id]" data-testid="btn-view-submission">View submission</a>
          </div>
        </div>
      } @else if (loading()) {
        <div class="ops-state" aria-busy="true">
          <ce-skeleton kind="text" [count]="2" />
          <ce-skeleton kind="chart" height="320px" />
        </div>
      } @else if (error()) {
        <ce-empty-state kind="error" [message]="error()">
          <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="load()" data-testid="btn-retry">Retry</button>
          <a class="ce-btn ce-btn-ghost ce-btn-sm" routerLink="/checklists/assignments">Back to my checklists</a>
        </ce-empty-state>
      } @else if (assignment(); as asg) {
        <header class="fl-head">
          <a class="ce-page-back" routerLink="/checklists/assignments" aria-label="Back to my checklists" data-testid="btn-back"><mat-icon>arrow_back</mat-icon></a>
          <div class="t">
            <h1 data-testid="page-title" [title]="asg.templateName">{{ asg.templateName }}</h1>
            <div class="meta">
              <span [title]="asg.storeName"><span class="material-symbols-outlined">storefront</span>{{ asg.storeName }}</span>
              <span [class]="due().tone" data-testid="fill-due"><span class="material-symbols-outlined">schedule</span>{{ dueText() }}</span>
              @if (asg.status === 'REDO' || asg.status === 'OVERDUE' || asg.status === 'IN_PROGRESS') {
                <ce-pill [value]="asg.status" size="sm" />
              }
            </div>
          </div>
        </header>

        @if (readOnly()) {
          <ce-info-banner tone="info" title="Nothing to fill" data-testid="fill-readonly">
            This checklist is {{ asg.status === 'APPROVED' ? 'approved' : 'already submitted' }}{{ notAssignee() ? ' or assigned to someone else' : '' }}.
            @if (asg.submissionId) {
              <a [routerLink]="['/checklists/submissions', asg.submissionId]">View the submission</a>
            }
          </ce-info-banner>
        }
        @if (restoredLocal()) {
          <ce-info-banner tone="warning" icon="phonelink_lock" title="Unsaved answers restored" data-testid="local-draft-banner">
            {{ restoredLocal() }} answer(s) you had not saved yet (e.g. when your session expired) were kept on this device. Save the draft or submit to keep them.
          </ce-info-banner>
        }
        @if (resumedDraft()) {
          <ce-info-banner tone="info" icon="history" data-testid="draft-banner">Resumed your saved draft{{ lastSaved() ? ' (saved ' + lastSaved() + ')' : '' }}.</ce-info-banner>
        }
        @if (asg.status === 'REDO') {
          <ce-info-banner tone="warning" icon="replay" title="Redo requested" data-testid="redo-banner">
            {{ reviewerComment() ? '“' + reviewerComment() + '”' : 'The reviewer asked for a redo.' }} {{ redoIds().size }} question(s) need attention.
          </ce-info-banner>
        }
        @if (!questions().length) {
          <ce-empty-state icon="checklist" title="This checklist has no questions" message="Ask your manager to update the checklist template." />
        } @else {
          <div class="fl-progress" data-testid="fill-progress">
            <div class="row1">
              <span><b data-testid="fill-answered">{{ answeredCount() }}</b> of <b>{{ questions().length }}</b> answered</span>
              <span class="spacer"></span>
              <span class="ops-hide-xs" data-testid="score-preview">Score preview: {{ preview().score }} / {{ preview().maxScore }} ({{ preview().pct | pct }})</span>
              @if (savingDraft()) {
                <span>Saving…</span>
              } @else if (lastSaved()) {
                <span class="ops-hide-xs">· Saved {{ lastSaved() }}</span>
              }
            </div>
            <div class="track" role="progressbar" aria-label="Checklist progress" [attr.aria-valuenow]="progressPct()" aria-valuemin="0" aria-valuemax="100">
              <div class="fill" [style.width.%]="progressPct()"></div>
            </div>
            <div class="fl-steps" role="tablist" aria-label="Sections">
              @for (g of sectionStats(); track g.section) {
                <button type="button" role="tab" class="fl-step" [class.active]="mode() === 'question' && g.section === currentSection()" [class.done]="g.done === g.total" (click)="goSection(g.section)" [attr.aria-selected]="g.section === currentSection()" [attr.data-testid]="'fill-section-' + g.section">
                  <span class="material-symbols-outlined">{{ g.done === g.total ? 'check_circle' : 'radio_button_unchecked' }}</span>
                  <span class="nm">{{ g.section }}</span>
                  <span class="ct">{{ g.done }}/{{ g.total }}</span>
                </button>
              }
            </div>
          </div>

          <div class="fl-body">
            @if (wide()) {
              <aside class="fl-outline" aria-label="Questions">
                <ng-container [ngTemplateOutlet]="outline" />
              </aside>
            }
            <div class="fl-main">
              @if (mode() === 'review') {
                <div class="fl-review" data-testid="fill-review">
                  <h2>Review &amp; submit</h2>
                  <div class="sum">
                    <div><div class="v">{{ answeredCount() }}/{{ questions().length }}</div><div class="l">Answered</div></div>
                    <div><div class="v" [class.bad-text]="missing().length > 0">{{ missing().length }}</div><div class="l">Required missing</div></div>
                    <div><div class="v">{{ preview().pct | pct }}</div><div class="l">Score preview</div></div>
                  </div>
                  @if (serverIssueQs().length && !missing().length) {
                    <ce-info-banner tone="danger" title="The server did not accept these answers" data-testid="fill-server-issues">{{ serverMessage() }}. Tap a question to fix it.</ce-info-banner>
                    <div class="fl-missing">
                      @for (q of serverIssueQs(); track q.id) {
                        <button type="button" (click)="goTo(q.id!)" [attr.data-testid]="'review-server-' + q.id">
                          <span class="material-symbols-outlined">error</span>
                          <span class="t"><span class="q">{{ q.text }}</span><span class="e">{{ reason(q) }}</span></span>
                          <span class="material-symbols-outlined" style="color: var(--c-text-3)">chevron_right</span>
                        </button>
                      }
                    </div>
                  }
                  @if (missing().length) {
                    <ce-info-banner tone="danger" title="Answer these before submitting" data-testid="fill-missing">Tap a question to go back to it.</ce-info-banner>
                    <div class="fl-missing">
                      @for (q of missing(); track q.id) {
                        <button type="button" (click)="goTo(q.id!)" [attr.data-testid]="'review-missing-' + q.id">
                          <span class="material-symbols-outlined">error</span>
                          <span class="t"><span class="q">{{ q.text }}</span><span class="e">{{ reason(q) }}</span></span>
                          <span class="material-symbols-outlined" style="color: var(--c-text-3)">chevron_right</span>
                        </button>
                      }
                    </div>
                  } @else if (!serverIssueQs().length) {
                    <ce-info-banner tone="success" title="All required questions are answered">Once you submit, the checklist goes to your manager for review and can't be edited.</ce-info-banner>
                  }
                  @if (unansweredOptional() > 0) {
                    <div class="caption">{{ unansweredOptional() }} optional question(s) left blank.</div>
                  }
                  <button type="button" class="ce-btn ce-btn-primary" style="height: 48px; font-size: 15px" (click)="submit()" [disabled]="submitting() || readOnly() || missing().length > 0" data-testid="btn-submit-checklist">
                    @if (submitting()) {
                      <mat-spinner diameter="18" />
                      Submitting…
                    } @else {
                      <span class="material-symbols-outlined">send</span> Submit checklist
                    }
                  </button>
                </div>
              } @else if (current(); as q) {
                <ce-fill-question
                  [question]="q"
                  [answer]="answers()[q.id!]"
                  [position]="index() + 1"
                  [total]="questions().length"
                  [invalid]="invalidIds().has(q.id!)"
                  [redo]="redoIds().has(q.id!)"
                  [errorText]="reason(q)"
                  [uploading]="uploading() === q.id"
                  [uploadError]="uploadErrors()[q.id!] || null"
                  [aiChecking]="aiChecking() === q.id"
                  [aiResult]="aiResults()[q.id!]"
                  (valueChange)="set(q, $event)"
                  (remarkChange)="setRemark(q, $event)"
                  (toggleRemark)="toggleRemark(q)"
                  (photoPicked)="upload(q, $event)"
                  (videoPicked)="uploadVideo(q, $event)"
                  (checkAi)="checkAi(q)"
                />
              }
            </div>
          </div>

          <div class="fl-actions">
            <div class="inner">
              <button type="button" class="ce-btn ce-btn-secondary" (click)="prev()" [disabled]="mode() === 'question' && index() === 0" data-testid="btn-fill-prev" aria-label="Previous question">
                <span class="material-symbols-outlined">chevron_left</span><span class="ops-hide-xs">Previous</span>
              </button>
              @if (!wide()) {
                <button type="button" class="ce-btn ce-btn-secondary" (click)="outlineOpen.set(true)" data-testid="btn-fill-outline" aria-label="All questions">
                  <span class="material-symbols-outlined">format_list_numbered</span>
                </button>
              }
              <button type="button" class="ce-btn ce-btn-ghost" (click)="saveDraft()" [disabled]="savingDraft() || readOnly()" data-testid="btn-save-draft">
                <span class="material-symbols-outlined">save</span> {{ savingDraft() ? 'Saving…' : 'Save draft' }}
              </button>
              <span class="spacer"></span>
              <span class="pos">{{ mode() === 'review' ? 'Review' : index() + 1 + ' / ' + questions().length }}</span>
              @if (mode() === 'review') {
                <button type="button" class="ce-btn ce-btn-primary" (click)="submit()" [disabled]="submitting() || readOnly() || missing().length > 0" data-testid="btn-fill-submit">Submit</button>
              } @else if (index() < questions().length - 1) {
                <button type="button" class="ce-btn ce-btn-primary" (click)="next()" data-testid="btn-fill-next">Next <span class="material-symbols-outlined">chevron_right</span></button>
              } @else {
                <button type="button" class="ce-btn ce-btn-primary" (click)="review()" data-testid="btn-fill-review">Review <span class="material-symbols-outlined">fact_check</span></button>
              }
            </div>
          </div>
          @if (!wide()) {
            <ce-drawer [(open)]="outlineOpen" title="All questions" [subtitle]="answeredCount() + ' of ' + questions().length + ' answered'" testId="drawer-fill-outline">
              <ng-container [ngTemplateOutlet]="outline" />
            </ce-drawer>
          }
        }
      }
    </section>

    <ng-template #outline>
      @for (g of sections(); track g.section) {
        <div class="fl-ol-sec">
          <div class="sec-head">
            <span class="nm" [title]="g.section">{{ g.section }}</span>
            <span class="ct">{{ doneIn(g.section) }}/{{ g.questions.length }}</span>
            <button type="button" class="ce-icon-btn sm" (click)="saveDraft(g.section)" [disabled]="savingDraft() || readOnly()" [matTooltip]="'Save “' + g.section + '” as draft'" [attr.aria-label]="'Save section ' + g.section" [attr.data-testid]="'btn-save-section-' + g.section">
              <mat-icon>save</mat-icon>
            </button>
          </div>
          @for (q of g.questions; track q.id) {
            <button
              type="button"
              class="fl-ol-q"
              [class.active]="mode() === 'question' && current()?.id === q.id"
              [class.answered]="answeredIds().has(q.id!)"
              [class.invalid]="invalidIds().has(q.id!)"
              [class.redo]="redoIds().has(q.id!) && !answeredIds().has(q.id!)"
              (click)="goTo(q.id!); outlineOpen.set(false)"
              [attr.data-testid]="'fill-nav-' + q.id"
              [title]="q.text"
            >
              <span class="dot">
                @if (answeredIds().has(q.id!)) {
                  <span class="material-symbols-outlined">check</span>
                } @else if (invalidIds().has(q.id!)) {
                  !
                }
              </span>
              <span class="txt">{{ q.text }}</span>
              @if (q.required) {
                <span class="caption">*</span>
              }
            </button>
          }
        </div>
      }
      <button type="button" class="fl-ol-q" style="margin-top: 8px" [class.active]="mode() === 'review'" (click)="review(); outlineOpen.set(false)" data-testid="fill-nav-review">
        <span class="dot"><span class="material-symbols-outlined">fact_check</span></span><span class="txt">Review &amp; submit</span>
      </button>
    </ng-template>
  `,
})
export class FillChecklistPage implements HasUnsavedChanges {
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly http = inject(HttpClient);
  private readonly v2 = inject(V2Api);
  private readonly auth = inject(AuthService);
  readonly assignmentId = input.required<string>();

  readonly wide = mediaSignal('(min-width: 1024px)');
  readonly assignment = signal<Assignment | null>(null);
  readonly answers = signal<Record<number, AnswerDraft>>({});
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly uploading = signal<number | null>(null);
  readonly uploadErrors = signal<Record<number, string>>({});
  readonly invalidIds = signal<Set<number>>(new Set());
  readonly redoIds = signal<Set<number>>(new Set());
  readonly reviewerComment = signal<string | null>(null);
  readonly result = signal<Submission | null>(null);
  readonly savingDraft = signal(false);
  readonly resumedDraft = signal(false);
  readonly lastSaved = signal<string | null>(null);
  readonly aiChecking = signal<number | null>(null);
  readonly aiResults = signal<Record<number, AiResult>>({});
  readonly index = signal(0);
  readonly mode = signal<'question' | 'review'>('question');
  readonly outlineOpen = signal(false);
  /** Questions changed since the last save (a section save clears only its own questions). */
  private readonly dirtyIds = signal<Set<number>>(new Set());
  /** Number of unsaved answers restored from this device's backup (0 = none). */
  readonly restoredLocal = signal(0);
  private readonly files = new Map<number, File>();
  private confirming = false;

  readonly template = computed(() => this.assignment()?.template ?? null);
  readonly sections = computed(() => groupBySection((this.template()?.questions ?? []).filter((q) => q.id !== undefined)));
  /** Flat list in section order (the order the outline and Next follow). */
  readonly questions = computed<Question[]>(() => this.sections().flatMap((g) => g.questions));
  readonly current = computed<Question | null>(() => this.questions()[this.index()] ?? null);
  readonly currentSection = computed(() => this.current()?.section || 'General');
  readonly preview = computed(() => previewScore(this.questions(), this.answers()));
  readonly answeredIds = computed(() => {
    const a = this.answers();
    return new Set(this.questions().filter((q) => isAnswered(q, a[q.id!])).map((q) => q.id!));
  });
  readonly answeredCount = computed(() => this.answeredIds().size);
  readonly progressPct = computed(() => (this.questions().length ? Math.round((this.answeredCount() / this.questions().length) * 100) : 0));
  readonly sectionStats = computed(() => this.sections().map((g) => ({ section: g.section, total: g.questions.length, done: g.questions.filter((q) => this.answeredIds().has(q.id!)).length })));
  readonly missing = computed(() => missingRequired(this.questions(), this.answers()));
  /** Contract v4: answers the server refused on submit (question id → reason); cleared as each one is edited. */
  readonly serverIssues = signal<Record<number, string>>({});
  readonly serverMessage = signal('');
  readonly serverIssueQs = computed(() => {
    const m = this.serverIssues();
    return this.questions().filter((q) => m[q.id!]);
  });
  readonly unansweredOptional = computed(() => this.questions().filter((q) => !q.required && !this.answeredIds().has(q.id!)).length);
  readonly notAssignee = computed(() => {
    const a = this.assignment();
    return !!a && a.assigneeId !== this.auth.user()?.id;
  });
  readonly readOnly = computed(() => {
    const a = this.assignment();
    return !!a && !FILLABLE.includes(a.status);
  });
  readonly due = computed(() => {
    const a = this.assignment();
    const iso = a?.dueAt ?? (a?.dueDate ? `${a.dueDate}T23:59:00+05:30` : null);
    return dueInfo(iso, !!a && !FILLABLE.includes(a.status));
  });
  readonly dueText = computed(() => {
    const a = this.assignment();
    if (!a) return '';
    const d = this.due();
    const when = a.dueAt ? storeDateTime(a.dueAt) : storeDate(a.dueDate);
    if (d.tone === 'overdue') return `${d.label} · due ${when}`;
    if (d.tone === 'soon') return `${d.label} (${when})`;
    return `Due ${when}`;
  });

  constructor() {
    // Unsaved answers are mirrored to this device until they reach the server (draft or submission), so a session
    // that expires mid-checklist, a crash or a closed tab never loses the staff member's work.
    effect(() => {
      const dirty = this.dirtyIds();
      const a = this.assignment();
      this.answers();
      // signed out (session expired): keep the copy made while signed in, never write one for "nobody"
      if (!a || this.loading() || !this.auth.user()) return;
      if (!dirty.size || this.result()) safeStorage.remove(this.backupKey(a.id));
      else safeStorage.set(this.backupKey(a.id), { at: new Date().toISOString(), answers: this.draftPayload(), dirty: [...dirty] });
    });
  }

  private backupKey(assignmentId: number): string {
    return `ce.fillBackup.${this.auth.user()?.id ?? 0}.${assignmentId}`;
  }

  /** Re-applies a local backup of unsaved answers (see the constructor). */
  private restoreBackup(a: Assignment): void {
    const b = safeStorage.get<{ at: string; answers: AnswerInput[]; dirty: number[] } | null>(this.backupKey(a.id), null);
    if (!b?.answers?.length || !FILLABLE.includes(a.status)) return;
    const ids = new Set(this.questions().map((q) => q.id!));
    const dirty = (b.dirty ?? []).filter((id) => ids.has(id));
    if (!dirty.length) return;
    this.answers.update((cur) => {
      const next = { ...cur };
      for (const d of b.answers) {
        if (!next[d.questionId] || !dirty.includes(d.questionId)) continue;
        next[d.questionId] = { value: d.value ?? '', photoUrl: d.photoUrl ?? null, remark: d.remark ?? '', showRemark: !!d.remark };
      }
      return next;
    });
    this.dirtyIds.set(new Set(dirty));
    this.restoredLocal.set(dirty.length);
  }

  ngOnInit(): void {
    this.load();
  }

  hasUnsavedChanges(): boolean {
    return this.dirtyIds().size > 0 && !this.result();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) e.preventDefault();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .get<Assignment>(`/checklists/assignments/${this.assignmentId()}`, null, silent())
      .pipe(
        switchMap((a) => {
          this.assignment.set(a);
          this.initAnswers();
          if (a.draftAnswers?.length) this.applyDraft(a.draftAnswers);
          if (a.status === 'REDO' && a.submissionId) {
            return this.api.get<Submission>(`/checklists/submissions/${a.submissionId}`, null, silent()).pipe(catchError(() => of(null)));
          }
          return of(null);
        }),
      )
      .subscribe({
        next: (prev) => {
          if (prev) this.prefill(prev);
          const asg = this.assignment();
          if (asg) this.restoreBackup(asg);
          this.index.set(startIndex(this.questions(), this.answers(), this.redoIds()));
          this.loading.set(false);
        },
        error: (e) => {
          this.loading.set(false);
          const status = (e as { status?: number })?.status;
          this.error.set(status === 404 ? 'This checklist no longer exists.' : status === 403 ? 'This checklist is not assigned to you.' : `Could not load this checklist. ${errorMessage(e)}`);
        },
      });
  }

  private initAnswers(): void {
    const init: Record<number, AnswerDraft> = {};
    for (const q of this.questions()) init[q.id!] = { value: '', photoUrl: null, remark: '', showRemark: false };
    this.answers.set(init);
  }

  private applyDraft(draft: AnswerInput[]): void {
    this.answers.update((cur) => {
      const next = { ...cur };
      for (const d of draft) {
        if (!next[d.questionId]) continue;
        next[d.questionId] = { value: d.value ?? '', photoUrl: d.photoUrl ?? null, remark: d.remark ?? '', showRemark: !!d.remark };
      }
      return next;
    });
    this.resumedDraft.set(true);
  }

  private prefill(prev: Submission): void {
    this.reviewerComment.set(prev.reviewerComment);
    const redo = new Set<number>();
    this.answers.update((cur) => {
      const next = { ...cur };
      for (const ans of prev.answers ?? []) {
        if (!next[ans.questionId]) continue;
        next[ans.questionId] = { value: ans.value ?? '', photoUrl: ans.photoUrl, remark: ans.remark ?? '', showRemark: !!ans.remark };
        if (ans.redo) redo.add(ans.questionId);
      }
      return next;
    });
    this.redoIds.set(redo);
  }

  // ------------------------------------------------------------ navigation
  goTo(id: number): void {
    const i = this.questions().findIndex((q) => q.id === id);
    if (i < 0) return;
    this.index.set(i);
    this.mode.set('question');
    this.scrollTop();
  }
  goSection(section: string): void {
    const q = this.questions().find((x) => (x.section || 'General') === section);
    if (q) this.goTo(q.id!);
  }
  next(): void {
    if (this.index() < this.questions().length - 1) {
      this.index.update((i) => i + 1);
      this.scrollTop();
    } else this.review();
  }
  prev(): void {
    if (this.mode() === 'review') {
      this.mode.set('question');
      this.index.set(this.questions().length - 1);
    } else if (this.index() > 0) this.index.update((i) => i - 1);
    this.scrollTop();
  }
  review(): void {
    this.mode.set('review');
    this.invalidIds.set(new Set(this.missing().map((q) => q.id!)));
    this.scrollTop();
  }
  private scrollTop(): void {
    queueMicrotask(() => window.scrollTo?.({ top: 0, behavior: 'smooth' }));
  }

  doneIn(section: string): number {
    return this.sectionStats().find((s) => s.section === section)?.done ?? 0;
  }
  reason(q: Question): string {
    return this.serverIssues()[q.id!] ?? missingReason(q, this.answers()[q.id!]);
  }

  // ------------------------------------------------------------ answers
  private patch(q: Question, p: Partial<AnswerDraft>): void {
    this.answers.update((cur) => ({ ...cur, [q.id!]: { ...cur[q.id!], ...p } }));
    this.dirtyIds.update((s) => new Set(s).add(q.id!));
    if (this.serverIssues()[q.id!]) {
      const { [q.id!]: _fixed, ...rest } = this.serverIssues();
      this.serverIssues.set(rest);
    }
    if (this.invalidIds().has(q.id!)) {
      // re-check: the question stays invalid only while it is still missing
      queueMicrotask(() => {
        if (!this.missing().some((m) => m.id === q.id)) {
          const s = new Set(this.invalidIds());
          s.delete(q.id!);
          this.invalidIds.set(s);
        }
      });
    }
  }
  set(q: Question, value: string): void {
    this.patch(q, { value: value ?? '' });
  }
  setRemark(q: Question, remark: string): void {
    this.patch(q, { remark });
  }
  toggleRemark(q: Question): void {
    this.answers.update((cur) => ({ ...cur, [q.id!]: { ...cur[q.id!], showRemark: !cur[q.id!].showRemark } }));
  }
  private setUploadError(q: Question, msg: string | null): void {
    this.uploadErrors.update((m) => {
      const { [q.id!]: _drop, ...rest } = m;
      return msg ? { ...rest, [q.id!]: msg } : rest;
    });
  }

  upload(q: Question, input: HTMLInputElement): void {
    const file = input.files?.[0];
    if (!file) return;
    const err = validateFile(file, IMAGE_RULE);
    this.setUploadError(q, err);
    if (err) {
      input.value = '';
      return;
    }
    const fd = new FormData();
    fd.append('file', file, file.name);
    this.uploading.set(q.id!);
    this.files.set(q.id!, file);
    this.aiResults.update((m) => {
      const { [q.id!]: _drop, ...rest } = m;
      return rest;
    });
    this.api.upload<UploadResult>('/uploads', fd, silent()).subscribe({
      next: (r) => {
        this.uploading.set(null);
        this.patch(q, { photoUrl: r.url, ...(q.type === 'PHOTO' ? { value: r.url } : {}) });
        input.value = '';
      },
      error: (e) => {
        this.uploading.set(null);
        this.setUploadError(q, `Upload failed: ${errorMessage(e)}`);
        input.value = '';
      },
    });
  }

  uploadVideo(q: Question, input: HTMLInputElement): void {
    const file = input.files?.[0];
    if (!file) return;
    const err = validateFile(file, VIDEO_RULE);
    this.setUploadError(q, err);
    if (err) {
      input.value = '';
      return;
    }
    const fd = new FormData();
    fd.append('file', file, file.name);
    this.uploading.set(q.id!);
    this.api.upload<UploadResult>('/uploads', fd, silent()).subscribe({
      next: (r) => {
        this.uploading.set(null);
        this.patch(q, { value: r.url });
        input.value = '';
      },
      error: (e) => {
        this.uploading.set(null);
        this.setUploadError(q, `Upload failed: ${errorMessage(e)}`);
        input.value = '';
      },
    });
  }

  /** Previews the AI verdict for the photo before submitting (ERROR is shown but never blocks submission). */
  checkAi(q: Question): void {
    if (this.aiChecking() !== null) return;
    const type = q.aiCheck === 'UNIFORM' ? 'UNIFORM' : 'REFERENCE_MATCH';
    const photo = this.answers()[q.id!]?.photoUrl;
    const local = this.files.get(q.id!);
    this.aiChecking.set(q.id!);
    const run = (blob: Blob) =>
      this.v2
        .aiCheck(blob, type, q.referenceImageUrl)
        .pipe(catchError((e) => of<AiResult>({ status: 'ERROR', score: 0, message: aiErrorMessage(e), issues: [] })))
        .subscribe((r) => {
          this.aiChecking.set(null);
          this.aiResults.update((m) => ({ ...m, [q.id!]: r }));
        });
    if (local) run(local);
    else if (photo) {
      this.http
        .get(photo, { responseType: 'blob' })
        .pipe(catchError(() => of(null)))
        .subscribe((b) => (b ? run(new File([b], 'photo.jpg', { type: b.type || 'image/jpeg' })) : this.aiChecking.set(null)));
    } else this.aiChecking.set(null);
  }

  // ------------------------------------------------------------ draft & submit
  /** Answers worth persisting (anything the user touched), optionally limited to one section. */
  draftPayload(section?: string): AnswerInput[] {
    const ans = this.answers();
    return this.questions()
      .filter((q) => !section || (q.section || 'General') === section)
      .map((q) => ({ q, d: ans[q.id!] }))
      .filter(({ d }) => d && (d.value || d.photoUrl || d.remark.trim()))
      .map(({ q, d }) => {
        const out: AnswerInput = { questionId: q.id!, value: d.value ?? '' };
        if (d.photoUrl) out.photoUrl = d.photoUrl;
        if (d.remark.trim()) out.remark = d.remark.trim();
        return out;
      });
  }

  saveDraft(section?: string): void {
    const a = this.assignment();
    if (!a || this.savingDraft()) return;
    const answers = this.draftPayload(section);
    if (!answers.length) {
      this.ui.toast(section ? `Nothing answered in “${section}” yet` : 'Nothing answered yet');
      return;
    }
    this.savingDraft.set(true);
    this.v2.saveDraft(a.id, answers).subscribe({
      next: () => {
        this.savingDraft.set(false);
        const saved = new Set(answers.map((x) => x.questionId));
        this.dirtyIds.update((s) => (section ? new Set([...s].filter((id) => !saved.has(id) && (this.questions().find((q) => q.id === id)?.section || 'General') !== section)) : new Set()));
        if (!this.dirtyIds().size) this.restoredLocal.set(0);
        this.lastSaved.set(new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }));
        this.assignment.update((x) => (x ? { ...x, status: x.status === 'PENDING' ? 'IN_PROGRESS' : x.status } : x));
        this.ui.toast(section ? `Saved “${section}” as draft` : 'Draft saved');
      },
      error: () => this.savingDraft.set(false),
    });
  }

  submit(): void {
    const a = this.assignment();
    if (!a || this.submitting()) return;
    const missing = this.missing();
    this.invalidIds.set(new Set(missing.map((q) => q.id!)));
    if (missing.length) {
      this.mode.set('review');
      this.ui.toast(`${missing.length} required question(s) need an answer`);
      return;
    }
    // a double tap must not stack two confirmation dialogs
    if (this.confirming) return;
    this.confirming = true;
    this.ui
      .confirm({
        title: 'Submit checklist?',
        message: `${this.answeredCount()} of ${this.questions().length} questions answered · score preview ${this.preview().score} / ${this.preview().maxScore}. You can't edit it after submitting.`,
        confirmText: 'Submit',
      })
      .pipe(finalize(() => (this.confirming = false)))
      .subscribe(() => this.doSubmit(a));
  }

  private doSubmit(a: Assignment): void {
    if (this.submitting()) return;
    const ans = this.answers();
    const body: SubmissionCreate = {
      assignmentId: a.id,
      templateId: a.templateId,
      storeId: a.storeId,
      answers: this.questions().map((q) => {
        const d = ans[q.id!];
        const out: { questionId: number; value: string; photoUrl?: string; remark?: string } = { questionId: q.id!, value: d.value ?? '' };
        if (d.photoUrl) out.photoUrl = d.photoUrl;
        if (d.remark.trim()) out.remark = d.remark.trim();
        return out;
      }),
    };
    this.submitting.set(true);
    this.api.post<Submission>('/checklists/submissions', body, null, silent()).subscribe({
      next: (s) => {
        this.submitting.set(false);
        this.serverIssues.set({});
        this.dirtyIds.set(new Set());
        this.result.set(s);
        window.scrollTo?.({ top: 0 });
      },
      error: (e) => {
        this.submitting.set(false);
        const issues = serverAnswerIssues(e);
        if (!issues) {
          this.ui.toast(errorMessage(e));
          return;
        }
        // show the server's verdict on the questions themselves, not just in a toast
        this.serverMessage.set(issues.message.replace(/\.$/, ''));
        this.serverIssues.set(issues.byQuestion);
        this.invalidIds.set(new Set(Object.keys(issues.byQuestion).map(Number)));
        this.mode.set('review');
        this.scrollTop();
      },
    });
  }
}
