import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Answer, AnswerTaskRequest, PRIORITIES, Question, ReviewRequest, Submission, Task, Template } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { groupBySection, parseMulti } from '../../core/utils/checklist-score';
import { humanize } from '../../core/utils/format';
import { enumOptions } from '../../shared/crud/field';
import { DS } from '../../shared/ds';
import { EntityDrawerComponent } from '../../shared/ds/entity-drawer.component';
import type { AdminField } from '../../shared/ds/entity-drawer.component';
import { PctPipe } from '../../shared/pipes';
import { UiService } from '../../shared/ui/ui.service';
import { QUESTION_TYPE_META, storeDateTime } from './_ui/ops';
import { LIST_STYLES, OpsReviewStyles } from './_ui/styles';

/** Human-readable answer for the review screen. */
export function answerDisplay(q: Question, a: Answer | undefined): string {
  if (!a || a.value === null || a.value === undefined || a.value === '') return a?.photoUrl ? 'Photo attached' : 'Not answered';
  if (q.type === 'VIDEO') return 'Video attached';
  if (q.type === 'MCQ_MULTI') return parseMulti(a.value).join(', ') || 'Not answered';
  if (q.type === 'RATING') return `${'★'.repeat(Number(a.value) || 0)}${'☆'.repeat(Math.max(0, 5 - (Number(a.value) || 0)))} (${a.value}/5)`;
  if (q.type === 'YES_NO') return a.value === 'YES' ? 'Yes' : a.value === 'NO' ? 'No' : a.value;
  if (q.type === 'PHOTO') return 'Photo attached';
  return a.value;
}

/**
 * Trax › Submission detail: score / flags / status, answer cards per section with photo & video evidence, the AI
 * verdict with the annotated image next to the reference, flags with "Create task", and a review panel (Approve /
 * Request redo per question).
 */
@Component({
  selector: 'ce-submission-detail-page',
  imports: [FormsModule, RouterLink, MatCheckboxModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, ...DS, ...LIST_STYLES, OpsReviewStyles, PctPipe, EntityDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles /><ce-ops-review-styles />
    <section class="ops-page" data-testid="page-submission-detail">
      @if (data.data(); as s) {
        <ce-page [title]="s.templateName" [description]="s.storeName + ' · submitted by ' + s.submittedByName + ' · ' + dt(s.submittedAt)">
          <ng-container pageActions>
            <a class="ce-btn ce-btn-secondary" [routerLink]="canReview() ? '/checklists/submissions' : '/checklists/assignments'" data-testid="btn-back"><mat-icon>arrow_back</mat-icon> Back</a>
          </ng-container>
          <div class="sd-layout">
            <div class="stack" style="gap: 16px; min-width: 0">
              <div class="sd-kpis">
                <div class="sd-kpi" data-testid="kpi-submission-score">
                  <div class="l">Score</div>
                  <div class="v">{{ s.scorePct | pct }}</div>
                  <div class="s">{{ s.score }} of {{ s.maxScore }} points</div>
                </div>
                <div class="sd-kpi" [class.bad]="flagCount() > 0" data-testid="kpi-submission-flags">
                  <div class="l">Flags</div>
                  <div class="v">{{ flagCount() }}</div>
                  <div class="s">answers needing follow-up</div>
                </div>
                <div class="sd-kpi" data-testid="kpi-submission-status">
                  <div class="l">Status</div>
                  <div class="v"><ce-pill [value]="s.status" [label]="s.status === 'SUBMITTED' ? 'Awaiting review' : null" data-testid="chip-status" />@if (s.isLate) {<ce-pill tone="warning" label="Late" icon="schedule" size="sm" data-testid="chip-late" />}</div>
                  <div class="s" [title]="s.reviewerComment ?? ''">{{ s.reviewerComment ? '“' + s.reviewerComment + '”' : 'No review yet' }}</div>
                </div>
              </div>

              @if (versionNote(); as vn) {
                <div class="sd-version-note" role="note" data-testid="submission-version-note"><span class="material-symbols-outlined" aria-hidden="true">history</span>{{ vn }}</div>
              }

              @if (flagCount() > 0) {
                <div class="ops-chips">
                  <button type="button" class="ops-chip" [class.active]="!flaggedOnly()" (click)="flaggedOnly.set(false)" data-testid="filter-answers-all">All answers <span class="n">{{ s.answers?.length ?? 0 }}</span></button>
                  <button type="button" class="ops-chip" [class.active]="flaggedOnly()" (click)="flaggedOnly.set(true)" data-testid="filter-answers-flagged"><span class="material-symbols-outlined">flag</span>Flagged <span class="n">{{ flagCount() }}</span></button>
                </div>
              }

              @for (g of sections(); track g.section) {
                @if (visible(g.questions).length) {
                  <div class="sd-section">
                    <div class="qb-section-head" style="display: flex; align-items: center; gap: 10px">
                      <span class="strong">{{ g.section }}</span>
                      <span style="flex: 1; height: 1px; background: var(--c-border)"></span>
                      <span class="caption">{{ sectionScore(g.questions) }}</span>
                    </div>
                    @for (q of visible(g.questions); track q.id) {
                      @let a = answerFor(q);
                      <article class="sd-answer" [attr.data-testid]="'answer-' + q.id" [attr.data-flagged]="!!a?.flagged">
                        <div class="top">
                          <span class="qn" [matTooltip]="meta[q.type].label"><span class="material-symbols-outlined" style="font-size: 15px">{{ meta[q.type].icon }}</span></span>
                          <div class="q">
                            <div class="txt">{{ q.text }}</div>
                            <div class="val" data-testid="answer-value">{{ display(q, a) }}</div>
                            @if (a?.remark) {
                              <div class="rem"><span class="material-symbols-outlined">chat</span>{{ a!.remark }}</div>
                            }
                          </div>
                          <div class="sc">
                            <span class="pts" [class.lost]="!!a && a.score < a.maxScore">{{ a?.score ?? 0 }} / {{ a?.maxScore ?? q.weight }}</span>
                            @if (a?.flagged) {
                              <ce-pill tone="critical" label="Flagged" icon="flag" size="sm" data-testid="answer-flagged" />
                            }
                            @if (a?.redo) {
                              <ce-pill tone="serious" label="Redo requested" size="sm" />
                            }
                            @if (canReview() && reviewing()) {
                              <mat-checkbox [checked]="redoIds().has(q.id!)" (change)="toggleRedo(q.id!, $event.checked)" [attr.data-testid]="'redo-flag-' + q.id">Redo</mat-checkbox>
                            }
                          </div>
                        </div>
                        @if (a?.photoUrl || (q.type === 'VIDEO' && a?.value) || a?.aiResult?.annotatedUrl) {
                          <div class="sd-evidence">
                            @if (q.type === 'VIDEO' && a?.value) {
                              <figure><video [src]="a!.value" controls preload="metadata" playsinline data-testid="answer-video"></video><figcaption>Video</figcaption></figure>
                            }
                            @if (a?.photoUrl) {
                              <figure><a [href]="a!.photoUrl" target="_blank" rel="noopener"><img [src]="a!.photoUrl" alt="Submitted photo" loading="lazy" /></a><figcaption>Submitted photo</figcaption></figure>
                            }
                            @if (a?.aiResult?.annotatedUrl) {
                              <figure><a [href]="a!.aiResult!.annotatedUrl" target="_blank" rel="noopener"><img [src]="a!.aiResult!.annotatedUrl" alt="AI annotated photo" loading="lazy" /></a><figcaption>AI annotated</figcaption></figure>
                            }
                            @if (q.aiCheck === 'REFERENCE_MATCH' && q.referenceImageUrl) {
                              <figure><a [href]="q.referenceImageUrl" target="_blank" rel="noopener"><img [src]="q.referenceImageUrl" alt="Reference image" loading="lazy" /></a><figcaption>Reference</figcaption></figure>
                            }
                          </div>
                        }
                        @if (a?.aiResult; as ai) {
                          <div class="sd-ai" data-testid="answer-ai-result" [attr.data-status]="ai.status">
                            <div class="row1">
                              <span class="material-symbols-outlined">auto_awesome</span>
                              <ce-pill [value]="ai.status" [label]="'AI ' + ai.status" size="sm" data-testid="ai-status" />
                              <span class="strong" style="color: var(--c-text)">{{ ai.message }}</span>
                              @if (ai.status === 'PASS' || ai.status === 'FAIL') {
                                <span>· confidence {{ (ai.score * 100).toFixed(0) }}%</span>
                              }
                            </div>
                            @if (ai.issues.length) {
                              <ul>
                                @for (i of ai.issues; track i) {
                                  <li>{{ i }}</li>
                                }
                              </ul>
                            }
                          </div>
                        }
                        @if (a?.flagged && canCreateTask()) {
                          <div>
                            <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="createTask(q, a!)" data-testid="btn-answer-task"><mat-icon>add_task</mat-icon> Create task</button>
                          </div>
                        }
                      </article>
                    }
                  </div>
                }
              }
            </div>

            <aside class="sd-side">
              @if (canReview()) {
                <ce-card title="Review" icon="rate_review" data-testid="review-panel">
                  @if (!reviewing()) {
                    <div class="stack" style="gap: 12px">
                      <p class="muted" style="margin: 0">
                        @switch (s.status) {
                          @case ('APPROVED') {
                            Approved. You can still request a redo if something was missed.
                          }
                          @case ('REDO') {
                            A redo was requested{{ s.reviewerComment ? ': “' + s.reviewerComment + '”' : '' }}.
                          }
                          @default {
                            Check the answers and evidence, then approve or send questions back for a redo.
                          }
                        }
                      </p>
                      <button type="button" class="ce-btn ce-btn-primary" (click)="startReview()" data-testid="btn-start-review"><mat-icon>rate_review</mat-icon> Review submission</button>
                    </div>
                  } @else {
                    <div class="sd-review">
                      <div class="decide" role="radiogroup" aria-label="Decision" data-testid="input-review-status">
                        <button type="button" role="radio" class="approve" [class.checked]="decision() === 'APPROVED'" [attr.aria-checked]="decision() === 'APPROVED'" (click)="decision.set('APPROVED')" data-testid="review-approve"><span class="material-symbols-outlined">check_circle</span>Approve</button>
                        <button type="button" role="radio" class="redo" [class.checked]="decision() === 'REDO'" [attr.aria-checked]="decision() === 'REDO'" (click)="decision.set('REDO')" data-testid="review-redo"><span class="material-symbols-outlined">replay</span>Redo</button>
                      </div>
                      @if (decision() === 'REDO') {
                        <div class="caption" style="font-size: 12px">
                          {{ redoIds().size ? redoIds().size + ' question(s) selected for redo.' : 'Tick “Redo” on the answers to send back — none selected means the whole checklist.' }}
                        </div>
                      }
                      <div>
                        <label class="ce-field-label" for="rv-comment">Comment for the store {{ decision() === 'REDO' ? '*' : '' }}</label>
                        <textarea id="rv-comment" [ngModel]="comment()" (ngModelChange)="comment.set($event)" maxlength="1000" placeholder="e.g. Re-take the shelf photo with the poster visible" data-testid="input-review-comment"></textarea>
                        @if (reviewError()) {
                          <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ reviewError() }}</div>
                        }
                      </div>
                      <div class="row" style="justify-content: flex-end; gap: 8px">
                        <button type="button" class="ce-btn ce-btn-ghost" (click)="reviewing.set(false)" data-testid="btn-cancel">Cancel</button>
                        <button type="button" class="ce-btn ce-btn-primary" (click)="submitReview()" [disabled]="saving()" data-testid="btn-submit-review">
                          @if (saving()) {
                            <mat-spinner diameter="16" />
                          }
                          {{ decision() === 'APPROVED' ? 'Approve' : 'Request redo' }}
                        </button>
                      </div>
                    </div>
                  }
                </ce-card>
              }
              <ce-card title="Details">
                <dl class="ops-kv">
                  <dt>Store</dt>
                  <dd class="ellipsis" [title]="s.storeName">{{ s.storeName }}</dd>
                  <dt>Submitted by</dt>
                  <dd><span class="cell-avatar" style="display: inline-flex; gap: 8px; align-items: center"><ce-avatar [name]="s.submittedByName" [size]="22" /><span class="ellipsis">{{ s.submittedByName }}</span></span></dd>
                  <dt>Submitted</dt>
                  <dd>{{ dt(s.submittedAt) }}</dd>
                  <dt>Answers</dt>
                  <dd>{{ s.answers?.length ?? 0 }}</dd>
                  @if (s.assignmentId) {
                    <dt>Assignment</dt>
                    <dd>#{{ s.assignmentId }}</dd>
                  }
                </dl>
              </ce-card>
            </aside>
          </div>
        </ce-page>
        <ce-entity-drawer
          [(open)]="taskOpen"
          entity="answer-task"
          title="Create task from response"
          [subtitle]="taskQuestion()"
          [fields]="taskFields()"
          [value]="taskValue()"
          [submit]="submitTask"
          submitLabel="Create task"
          (saved)="onTaskCreated($any($event))"
        />
      } @else if (data.error()) {
        <div class="ops-card">
          <ce-empty-state [kind]="forbidden() ? 'no-permission' : 'error'" [title]="notFound() ? 'Submission not found' : null" [message]="notFound() ? 'It may have been deleted.' : data.error()">
            @if (!notFound() && !forbidden()) {
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            }
            <a class="ce-btn ce-btn-ghost ce-btn-sm" routerLink="/checklists/assignments">Back</a>
          </ce-empty-state>
        </div>
      } @else {
        <div class="ops-state">
          <ce-skeleton kind="tiles" [count]="3" />
          <ce-skeleton kind="chart" height="200px" />
          <ce-skeleton kind="chart" height="200px" />
        </div>
      }
    </section>
  `,
})
export class SubmissionDetailPage {
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly auth = inject(AuthService);
  private readonly v2 = inject(V2Api);
  private readonly lookup = inject(LookupService);
  readonly id = input.required<string>();
  readonly data = loadOn(() => this.id(), (id) => this.api.get<Submission>(`/checklists/submissions/${id}`, null, silent()));

  /** The checklist as it is now, to tell whether the submission was answered against an older version. */
  private readonly current = loadOn(
    () => {
      const s = this.data.data();
      return s?.templateVersion ? s.templateId : null;
    },
    (tid) => this.api.get<Template>(`/checklists/templates/${tid}`, null, silent()).pipe(catchError(() => of(null))),
  );
  /** Contract v4: answered against version N while the checklist has moved on. */
  readonly versionNote = computed(() => {
    const v = this.data.data()?.templateVersion;
    const now = this.current.data()?.version;
    if (!v || !now || now <= v) return null;
    return `Answered against version ${v} of this checklist (now version ${now}). Questions, wording and weights are shown as they were answered.`;
  });

  readonly meta = QUESTION_TYPE_META;
  readonly canReview = computed(() => this.auth.can('reviewSubmissions'));
  readonly canCreateTask = computed(() => this.auth.can('createTasks'));
  readonly reviewing = signal(false);
  readonly decision = signal<'APPROVED' | 'REDO'>('APPROVED');
  readonly comment = signal('');
  readonly redoIds = signal<Set<number>>(new Set());
  readonly saving = signal(false);
  readonly reviewError = signal<string | null>(null);
  readonly flaggedOnly = signal(false);
  readonly flagCount = computed(() => {
    const s = this.data.data();
    return s?.flags ?? (s?.answers ?? []).filter((a) => a.flagged).length;
  });
  readonly notFound = computed(() => /not found/i.test(this.data.error() ?? ''));
  readonly forbidden = computed(() => /forbidden|permission|access|scope/i.test(this.data.error() ?? ''));

  readonly sections = computed(() => {
    const s = this.data.data();
    const qs = (s?.template?.questions ?? []) as Question[];
    if (qs.length) return groupBySection(qs);
    // fall back to answers only when the template isn't embedded
    return [{ section: 'Answers', questions: (s?.answers ?? []).map((a, i) => ({ id: a.questionId, text: `Question #${a.questionId}`, section: 'Answers', type: 'TEXT', required: false, weight: a.maxScore, requiresPhoto: false, sortOrder: i }) as Question) }];
  });

  answerFor(q: Question): Answer | undefined {
    return this.data.data()?.answers?.find((a) => a.questionId === q.id);
  }
  visible(qs: Question[]): Question[] {
    return this.flaggedOnly() ? qs.filter((q) => this.answerFor(q)?.flagged) : qs;
  }
  sectionScore(qs: Question[]): string {
    let s = 0;
    let m = 0;
    for (const q of qs) {
      const a = this.answerFor(q);
      s += a?.score ?? 0;
      m += a?.maxScore ?? (Number(q.weight) || 0);
    }
    return `${Math.round(s * 100) / 100} / ${m} pts`;
  }
  display(q: Question, a: Answer | undefined): string {
    return answerDisplay(q, a);
  }
  dt(iso: string): string {
    return storeDateTime(iso);
  }

  startReview(): void {
    this.reviewing.set(true);
    this.reviewError.set(null);
    this.redoIds.set(new Set());
    this.decision.set('APPROVED');
  }

  readonly taskOpen = signal(false);
  readonly taskQuestion = signal<string | null>(null);
  readonly taskValue = signal<Record<string, unknown> | null>(null);
  readonly taskFields = signal<AdminField[]>([]);
  private taskAnswerId = 0;
  readonly submitTask = (v: Record<string, unknown>) => this.v2.taskFromAnswer(this.taskAnswerId, v as unknown as AnswerTaskRequest);

  /** Follow-up task from one answer (DS side panel; due time is store time). */
  createTask(q: Question, a: Answer): void {
    const s = this.data.data()!;
    this.lookup.loadUsers();
    const due = new Date(Date.now() + 24 * 3600_000);
    this.taskAnswerId = a.id;
    this.taskQuestion.set(q.text);
    this.taskFields.set([
      { key: 'title', label: 'Title', type: 'text', full: true, required: true, maxLength: 200, placeholder: `Fix: ${q.text}` },
      { key: 'assigneeId', label: 'Assignee', type: 'select', required: true, options: () => this.lookup.usersForStore(s.storeId).map((u) => ({ value: u.id, label: u.name })) },
      {
        key: 'dueAt',
        label: 'Due (store time)',
        type: 'datetime',
        required: true,
        validate: (v) => (v && new Date(String(v) + ':00+05:30').getTime() < Date.now() ? 'The due time is in the past' : null),
      },
      { key: 'priority', label: 'Priority', type: 'select', options: enumOptions(PRIORITIES, humanize), default: 'HIGH' },
    ]);
    this.taskValue.set({ title: `Fix: ${q.text}`.slice(0, 200), dueAt: due.toISOString(), priority: 'HIGH' });
    this.taskOpen.set(true);
  }

  onTaskCreated(t: Task | null): void {
    this.ui.toast(`Task “${t?.title ?? 'follow-up'}” created`);
  }

  toggleRedo(id: number, on: boolean): void {
    const s = new Set(this.redoIds());
    if (on) s.add(id);
    else s.delete(id);
    this.redoIds.set(s);
    if (on) this.decision.set('REDO');
  }

  submitReview(): void {
    if (this.saving()) return;
    const body: ReviewRequest = { status: this.decision() };
    if (this.comment().trim()) body.comment = this.comment().trim();
    if (body.status === 'REDO' && !body.comment) {
      this.reviewError.set('Tell the store what to fix when you ask for a redo');
      return;
    }
    this.reviewError.set(null);
    if (this.decision() === 'REDO') body.redoQuestionIds = [...this.redoIds()];
    this.saving.set(true);
    this.api.patch<Submission>(`/checklists/submissions/${this.id()}/review`, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.reviewing.set(false);
        this.ui.toast(body.status === 'APPROVED' ? 'Submission approved' : 'Redo requested');
        this.data.reload();
      },
      error: () => this.saving.set(false),
    });
  }
}
