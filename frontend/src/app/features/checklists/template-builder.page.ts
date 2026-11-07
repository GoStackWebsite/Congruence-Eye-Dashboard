import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { CHECKLIST_CATEGORIES, ChecklistCategory, Frequency, QUESTION_TYPES, Question, QuestionType, Template, TemplateInput, UploadResult } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { errorMessage, humanize } from '../../core/utils/format';
import { OPTION_TYPES, moveItem, normaliseQuestion, parseOptions, validateTemplate } from '../../core/utils/template-validation';
import { DS } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { FillQuestionComponent } from './_ui/fill-question.component';
import { IMAGE_RULE, QUESTION_TYPE_META, questionIssues, validateFile } from './_ui/ops';
import { FILL_STYLES, OpsBuilderStyles, OpsEditorStyles } from './_ui/styles';
import { HasUnsavedChanges } from '../../shared/ds/unsaved-changes.guard';
import { apiErrorText, httpStatus } from '../../core/utils/http-errors';

interface QDraft extends Question {
  _key: number;
  _optionsText: string;
}

let keySeq = 1;

/** Sections in first-appearance order with their questions' positions in the flat list. */
export function sectionBlocks<T extends { section: string }>(qs: T[]): { section: string; items: { q: T; index: number }[] }[] {
  const out: { section: string; items: { q: T; index: number }[] }[] = [];
  qs.forEach((q, index) => {
    const name = (q.section || '').trim() || 'General';
    let b = out.find((x) => x.section === name);
    if (!b) out.push((b = { section: name, items: [] }));
    b.items.push({ q, index });
  });
  return out;
}

/** Moves a whole section block (all of its questions) to a new position among the sections. */
export function reorderSections<T extends { section: string }>(qs: T[], from: number, to: number): T[] {
  const blocks = sectionBlocks(qs);
  return moveItem(blocks, from, to).flatMap((b) => b.items.map((i) => i.q));
}

/**
 * Trax › Checklist builder (editor pattern): sticky header, left outline of sections (drag to reorder) and questions,
 * stacked question cards with a type picker, options editor (correct answers), weight / required / photo / AI check
 * settings and a reference image, a live phone preview of the fill view, sticky footer with Save as draft / Publish.
 */
@Component({
  selector: 'ce-template-builder-page',
  imports: [
    FormsModule,
    RouterLink,
    DragDropModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    ...DS,
    ...FILL_STYLES,
    OpsEditorStyles,
    OpsBuilderStyles,
    FillQuestionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles /><ce-ops-editor-styles /><ce-ops-builder-styles /><ce-ops-fill-styles /><ce-ops-fill-inputs-styles /><ce-ops-fill-actions-styles />
    <section class="ops-editor" data-testid="page-template-builder">
      <header class="ops-ed-head">
        <a class="ce-page-back" routerLink="/checklists" aria-label="Back to checklists" data-testid="btn-back"><mat-icon>arrow_back</mat-icon></a>
        <div class="titles">
          <div class="title-row">
            <h1 class="ce-page-title" data-testid="page-title" [title]="name">{{ name.trim() || (isNew() ? 'New checklist' : 'Checklist') }}</h1>
            @if (!isNew()) {
              <ce-pill [value]="original()?.isActive ? 'PUBLISHED' : 'DRAFT'" size="sm" data-testid="template-state" />
            }
            @if (readOnly()) {
              <ce-pill tone="neutral" label="View only" [dot]="false" icon="visibility" size="sm" />
            }
          </div>
          <p class="desc">{{ humanize(category) }} · {{ humanize(frequency) }} · {{ blocks().length }} section{{ blocks().length === 1 ? '' : 's' }}</p>
        </div>
        <div class="actions">
          <button type="button" class="ce-btn ce-btn-secondary" [class.on]="showPreview()" (click)="showPreview.set(!showPreview())" [attr.aria-pressed]="showPreview()" data-testid="btn-toggle-preview">
            <mat-icon>smartphone</mat-icon> <span class="ops-hide-xs">Preview</span>
          </button>
          @if (!readOnly()) {
            <button type="button" class="ce-btn ce-btn-primary" (click)="save(true)" [disabled]="saving()" data-testid="btn-save-template"><mat-icon>rocket_launch</mat-icon> Publish</button>
          }
        </div>
      </header>

      @if (loading()) {
        <div class="ops-ed-body">
          <ce-skeleton kind="text" [count]="6" />
          <div class="ops-state"><ce-skeleton kind="chart" height="180px" /><ce-skeleton kind="chart" height="240px" /></div>
        </div>
      } @else if (loadError()) {
        <div class="ops-card">
          <ce-empty-state kind="error" [title]="notFound() ? 'Checklist not found' : null" [message]="loadError()">
            @if (!notFound()) {
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="load()" data-testid="btn-retry">Retry</button>
            }
            <a class="ce-btn ce-btn-ghost ce-btn-sm" routerLink="/checklists">Back to checklists</a>
          </ce-empty-state>
        </div>
      } @else {
        @if (errors().length) {
          <ce-info-banner tone="danger" title="Fix these before saving" data-testid="template-errors">
            <ul style="margin: 4px 0 0; padding-left: 18px">
              @for (e of errors(); track e) {
                <li>{{ e }}</li>
              }
            </ul>
          </ce-info-banner>
        }
        <div class="ops-ed-body" [class.with-preview]="showPreview()">
          <aside class="ops-outline" aria-label="Checklist outline">
            <div class="ol-head">
              <span class="ops-section-label">Outline</span>
              <span class="caption">{{ questions().length }} Q</span>
            </div>
            <button type="button" class="qb-ol-q" style="padding-left: 8px" (click)="jump('sec-details')"><span class="material-symbols-outlined">badge</span><span class="txt">Details</span></button>
            <div cdkDropList (cdkDropListDropped)="dropSection($event)" [cdkDropListDisabled]="readOnly()" data-testid="outline-sections">
              @for (b of blocks(); track b.section; let si = $index) {
                <div class="qb-ol-section" cdkDrag [attr.data-testid]="'outline-section-' + b.section">
                  <div class="qb-ol-sec-head">
                    @if (!readOnly()) {
                      <span class="material-symbols-outlined grip" cdkDragHandle aria-label="Drag section to reorder">drag_indicator</span>
                    }
                    <span class="name" [title]="b.section">{{ b.section }}</span>
                    <span class="n">{{ b.items.length }}</span>
                  </div>
                  @for (it of b.items; track it.q._key) {
                    <button type="button" class="qb-ol-q" [class.active]="focusKey() === it.q._key" (click)="focus(it.q, true)" [title]="it.q.text">
                      <span class="material-symbols-outlined">{{ meta[it.q.type].icon }}</span>
                      <span class="txt">{{ it.index + 1 }}. {{ it.q.text || 'Untitled question' }}</span>
                      @if (showErrors() && hasIssues(it.q)) {
                        <span class="material-symbols-outlined bad">error</span>
                      }
                    </button>
                  }
                </div>
              }
            </div>
            @if (!readOnly()) {
              <button type="button" class="ce-btn ce-btn-ghost ce-btn-sm" style="margin-top: 8px; align-self: flex-start" (click)="addSection()" data-testid="btn-outline-add-section"><mat-icon>add</mat-icon> Add section</button>
            }
          </aside>

          <div class="ops-ed-main">
            <ce-form-section title="Details" anchor="sec-details" description="Name the checklist, pick its category and how often stores fill it.">
              <div class="ops-form">
                <div class="full">
                  <label class="ce-field-label" for="tpl-name">Checklist name *</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                    <input id="tpl-name" matInput [(ngModel)]="name" [disabled]="readOnly()" maxlength="200" placeholder="e.g. Store opening checklist" data-testid="input-template-name" />
                  </mat-form-field>
                  @if (showErrors() && !name.trim()) {
                    <div class="ops-err"><span class="material-symbols-outlined">error</span>Give the checklist a name</div>
                  }
                </div>
                <div>
                  <label class="ce-field-label">Category</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                    <mat-select [(ngModel)]="category" [disabled]="readOnly()" data-testid="input-template-category" aria-label="Category">
                      @for (c of categories; track c) {
                        <mat-option [value]="c">{{ humanize(c) }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                </div>
                <div>
                  <label class="ce-field-label">Frequency</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                    <mat-select [(ngModel)]="frequency" [disabled]="readOnly()" data-testid="input-template-frequency" aria-label="Frequency">
                      @for (f of frequencies; track f) {
                        <mat-option [value]="f">{{ humanize(f) }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                </div>
                <div class="full">
                  <label class="ce-field-label" for="tpl-desc">Description</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                    <textarea id="tpl-desc" matInput rows="2" [(ngModel)]="description" [disabled]="readOnly()" maxlength="1000" placeholder="What is this checklist for? Shown to staff when they fill it." data-testid="input-template-description"></textarea>
                  </mat-form-field>
                </div>
              </div>
            </ce-form-section>

            <div cdkDropList (cdkDropListDropped)="drop($event)" [cdkDropListDisabled]="readOnly()" class="ops-ed-main" data-testid="question-list">
              @for (q of questions(); track q._key; let i = $index) {
                @if (i === 0 || sectionOf(questions()[i - 1]) !== sectionOf(q)) {
                  <div class="qb-section-head" [attr.data-testid]="'section-' + sectionOf(q)" [id]="'sec-' + i">
                    <span class="label"><span class="material-symbols-outlined" style="font-size: 18px; color: var(--c-text-3)">view_agenda</span>Section · {{ sectionOf(q) }}</span>
                    <span class="line"></span>
                    <span class="n">{{ countIn(sectionOf(q)) }} question{{ countIn(sectionOf(q)) === 1 ? '' : 's' }}</span>
                  </div>
                }
                @let iss = showErrors() ? issues(q) : {};
                <article class="qb-card" cdkDrag [cdkDragData]="q" [class.focused]="focusKey() === q._key" [class.has-error]="showErrors() && hasIssues(q)" (focusin)="focus(q)" (click)="focus(q)" [attr.data-testid]="'question-' + i" [id]="'q-' + q._key">
                  <div class="qb-card-head">
                    @if (!readOnly()) {
                      <mat-icon class="drag" cdkDragHandle aria-label="Drag to reorder" data-testid="drag-handle">drag_indicator</mat-icon>
                    }
                    <span class="qn">Q{{ i + 1 }}</span>
                    <span class="type"><span class="material-symbols-outlined">{{ meta[q.type].icon }}</span>{{ meta[q.type].label }}</span>
                    @if (q.required) {
                      <span class="caption">Required</span>
                    }
                    <span class="spacer"></span>
                    @if (!readOnly()) {
                      <button type="button" class="ce-icon-btn sm" (click)="move(i, -1)" [disabled]="i === 0" matTooltip="Move up" aria-label="Move up" data-testid="btn-move-up"><mat-icon>arrow_upward</mat-icon></button>
                      <button type="button" class="ce-icon-btn sm" (click)="move(i, 1)" [disabled]="i === questions().length - 1" matTooltip="Move down" aria-label="Move down" data-testid="btn-move-down"><mat-icon>arrow_downward</mat-icon></button>
                      <button type="button" class="ce-icon-btn sm" (click)="duplicate(i)" matTooltip="Duplicate" aria-label="Duplicate" data-testid="btn-duplicate-question"><mat-icon>content_copy</mat-icon></button>
                      <button type="button" class="ce-icon-btn sm" (click)="remove(i)" matTooltip="Delete" aria-label="Delete question" data-testid="btn-delete-question"><mat-icon>delete</mat-icon></button>
                    }
                  </div>
                  <div class="qb-card-body">
                    <div class="qb-grid">
                      <div class="full-sm">
                        <label class="ce-field-label" [attr.for]="'q-text-' + q._key">Question *</label>
                        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                          <input matInput [(ngModel)]="q.text" (ngModelChange)="touch()" [disabled]="readOnly()" maxlength="500" placeholder="e.g. Is the entrance clean and well lit?" [id]="'q-text-' + q._key" data-testid="input-question-text" />
                        </mat-form-field>
                        @if (iss['text']) {
                          <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ iss['text'] }}</div>
                        }
                      </div>
                      <div>
                        <label class="ce-field-label" [attr.for]="'q-section-' + q._key">Section</label>
                        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                          <input matInput [(ngModel)]="q.section" (ngModelChange)="touch()" [disabled]="readOnly()" maxlength="80" [attr.list]="'sections-' + q._key" [id]="'q-section-' + q._key" data-testid="input-question-section" />
                        </mat-form-field>
                        <datalist [id]="'sections-' + q._key">
                          @for (b of blocks(); track b.section) {
                            <option [value]="b.section"></option>
                          }
                        </datalist>
                      </div>
                      <div>
                        <label class="ce-field-label" [attr.for]="'q-weight-' + q._key">Weight (points)</label>
                        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                          <input matInput type="number" min="0" step="1" [(ngModel)]="q.weight" (ngModelChange)="touch()" [disabled]="readOnly()" [id]="'q-weight-' + q._key" data-testid="input-question-weight" />
                        </mat-form-field>
                        @if (iss['weight']) {
                          <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ iss['weight'] }}</div>
                        }
                      </div>
                    </div>

                    <div>
                      <label class="ce-field-label">Answer type</label>
                      <div class="qb-type-picker" role="radiogroup" aria-label="Answer type" data-testid="input-question-type">
                        @for (t of types; track t) {
                          <button type="button" role="radio" [class.active]="q.type === t" [attr.aria-checked]="q.type === t" (click)="setType(q, t)" [disabled]="readOnly()" [matTooltip]="meta[t].hint" [attr.data-testid]="'qtype-' + t">
                            <span class="material-symbols-outlined">{{ meta[t].icon }}</span>{{ meta[t].label }}
                          </button>
                        }
                      </div>
                    </div>

                    @if (isOptionType(q.type)) {
                      <div>
                        <label class="ce-field-label">Options <span class="caption">· tap the mark to set the {{ q.type === 'MCQ_SINGLE' ? 'correct answer' : 'correct answers' }} (none = any answer scores full)</span></label>
                        <div class="qb-options" data-testid="input-question-correct">
                          @for (o of q.options ?? []; track $index; let oi = $index) {
                            <div class="qb-opt">
                              <button type="button" class="mark" [class.square]="q.type === 'MCQ_MULTI'" [class.on]="(q.correctOptions ?? []).includes(o)" (click)="toggleCorrect(q, o)" [disabled]="readOnly()" [attr.aria-pressed]="(q.correctOptions ?? []).includes(o)" [attr.aria-label]="'Correct answer: ' + o" [matTooltip]="(q.correctOptions ?? []).includes(o) ? 'Correct answer' : 'Mark as correct'">
                                <span class="material-symbols-outlined">check</span>
                              </button>
                              <input class="opt-input" [value]="o" (change)="renameOption(q, oi, $any($event.target).value)" [disabled]="readOnly()" maxlength="120" [attr.aria-label]="'Option ' + (oi + 1)" [attr.data-testid]="'option-input-' + oi" />
                              @if (!readOnly()) {
                                <button type="button" class="ce-icon-btn sm" (click)="removeOption(q, oi)" aria-label="Remove option" [attr.data-testid]="'option-remove-' + oi"><mat-icon>close</mat-icon></button>
                              }
                            </div>
                          }
                          @if (!readOnly()) {
                            <button type="button" class="ce-btn ce-btn-ghost ce-btn-sm" style="align-self: flex-start" (click)="addOption(q)" data-testid="btn-add-option"><mat-icon>add</mat-icon> Add option</button>
                          }
                        </div>
                        <div style="margin-top: 8px">
                          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                            <mat-icon matPrefix style="padding: 0 4px 0 8px; font-size: 18px; color: var(--c-text-3)">bolt</mat-icon>
                            <input matInput [(ngModel)]="q._optionsText" (ngModelChange)="onOptionsText(q)" [disabled]="readOnly()" placeholder="Quick entry: type options separated by commas" aria-label="Options, comma separated" data-testid="input-question-options" />
                          </mat-form-field>
                        </div>
                        @if (iss['options']) {
                          <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ iss['options'] }}</div>
                        }
                      </div>
                    }

                    @if (q.type === 'NUMBER') {
                      <div class="ce-sentence">
                        <span class="lead">Full score when the value is between</span>
                        <input class="ce-inline-input wide" type="number" [(ngModel)]="q.minValue" (ngModelChange)="touch()" [disabled]="readOnly()" placeholder="min" aria-label="Min value" data-testid="input-question-min" />
                        <span>and</span>
                        <input class="ce-inline-input wide" type="number" [(ngModel)]="q.maxValue" (ngModelChange)="touch()" [disabled]="readOnly()" placeholder="max" aria-label="Max value" data-testid="input-question-max" />
                      </div>
                      @if (iss['range']) {
                        <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ iss['range'] }}</div>
                      }
                    }

                    @if (q.type === 'PHOTO' || (q.requiresPhoto && q.type !== 'VIDEO')) {
                      <div class="qb-ai">
                        <div>
                          <label class="ce-field-label">AI check on the photo</label>
                          <mat-form-field appearance="outline" subscriptSizing="dynamic">
                            <mat-select [(ngModel)]="q.aiCheck" (ngModelChange)="touch()" [disabled]="readOnly()" data-testid="input-question-ai-check" aria-label="AI check">
                              <mat-option value="NONE">None</mat-option>
                              <mat-option value="REFERENCE_MATCH">Reference match</mat-option>
                              <mat-option value="UNIFORM">Uniform / grooming</mat-option>
                            </mat-select>
                          </mat-form-field>
                          <div class="ops-hint">A failed AI check scores 0 and flags the answer.</div>
                        </div>
                        @if (q.aiCheck === 'REFERENCE_MATCH') {
                          <div data-testid="question-reference">
                            <label class="ce-field-label">Reference image *</label>
                            <div class="qb-ref">
                              @if (q.referenceImageUrl) {
                                <img [src]="q.referenceImageUrl" alt="Reference image" data-testid="question-reference-thumb" />
                              }
                              <div class="stack" style="gap: 4px">
                                @if (!readOnly()) {
                                  <input #refFile type="file" accept="image/jpeg,image/png,image/webp" hidden (change)="uploadReference(q, refFile)" data-testid="input-question-reference" />
                                  <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="refFile.click()" [disabled]="uploadingKey() === q._key" data-testid="btn-upload-reference">
                                    @if (uploadingKey() === q._key) {
                                      <mat-spinner diameter="14" />
                                    } @else {
                                      <mat-icon>upload</mat-icon>
                                    }
                                    {{ q.referenceImageUrl ? 'Replace image' : 'Upload reference image' }}
                                  </button>
                                }
                                <span class="caption">The photo staff take is compared with this “correct” shot. JPG, PNG or WebP, up to 50 MB.</span>
                              </div>
                            </div>
                            @if (refErrors()[q._key]) {
                              <div class="ops-err"><span class="material-symbols-outlined">error</span>{{ refErrors()[q._key] }}</div>
                            } @else if (showErrors() && !q.referenceImageUrl) {
                              <div class="ops-err"><span class="material-symbols-outlined">error</span>Upload a reference image for the AI match</div>
                            }
                          </div>
                        }
                      </div>
                    }

                    <div class="qb-settings">
                      <mat-checkbox [(ngModel)]="q.required" (ngModelChange)="touch()" [disabled]="readOnly()" data-testid="input-question-required">Required</mat-checkbox>
                      <mat-checkbox [(ngModel)]="q.requiresPhoto" (ngModelChange)="touch()" [disabled]="readOnly() || q.type === 'PHOTO' || q.type === 'VIDEO'" data-testid="input-question-photo">{{ q.type === 'VIDEO' ? 'Video required' : 'Photo evidence required' }}</mat-checkbox>
                      <mat-slide-toggle [(ngModel)]="q.createTaskOnFail" (ngModelChange)="touch()" [disabled]="readOnly()" data-testid="input-question-task-on-fail">Create a task when flagged</mat-slide-toggle>
                    </div>
                  </div>
                </article>
              } @empty {
                <div class="ops-card">
                  <ce-empty-state icon="quiz" title="No questions yet" message="Add the first question — pick a type below." [compact]="true" data-testid="questions-empty" />
                </div>
              }
            </div>

            @if (!readOnly()) {
              <div class="qb-add-bar">
                <button type="button" class="ce-btn ce-btn-primary" [matMenuTriggerFor]="typeMenu" data-testid="btn-add-question"><mat-icon>add</mat-icon> Add question</button>
                <mat-menu #typeMenu="matMenu">
                  @for (t of types; track t) {
                    <button mat-menu-item (click)="addQuestion(t)" [attr.data-testid]="'btn-add-question-' + t">
                      <mat-icon>{{ meta[t].icon }}</mat-icon>
                      <span>{{ meta[t].label }}</span>
                    </button>
                  }
                </mat-menu>
                <button type="button" class="ce-btn ce-btn-secondary" (click)="addSection()" data-testid="btn-add-section"><mat-icon>view_agenda</mat-icon> Add section</button>
                <span class="caption" style="align-self: center">New questions go to the end of “{{ lastSection() }}”.</span>
              </div>
            }
          </div>

          @if (showPreview()) {
            <aside class="qb-preview" aria-label="Mobile preview" data-testid="builder-preview">
              <span class="ops-section-label">Live preview · staff phone</span>
              <div class="qb-phone">
                <div class="ph-head">
                  <div class="strong ellipsis" style="font-size: 14px">{{ name.trim() || 'New checklist' }}</div>
                  <div class="caption">Congruence T Nagar · Due today 10:30 AM</div>
                  <div class="fl-progress" style="position: static; margin: 8px 0 0; padding: 0; border: 0; background: none; backdrop-filter: none">
                    <div class="track"><div class="fill" [style.width.%]="previewIndex() >= 0 && questions().length ? ((previewIndex() + 1) / questions().length) * 100 : 0"></div></div>
                  </div>
                </div>
                <div class="ph-body">
                  @if (previewQuestion(); as pq) {
                    <ce-fill-question [question]="pq" [position]="previewIndex() + 1" [total]="questions().length" [preview]="true" />
                  } @else {
                    <ce-empty-state icon="smartphone" title="Nothing to preview" message="Add a question to see how staff will fill it." [compact]="true" />
                  }
                </div>
              </div>
              <div class="row" style="gap: 6px">
                <button type="button" class="ce-icon-btn sm" (click)="stepPreview(-1)" [disabled]="previewIndex() <= 0" aria-label="Previous question"><mat-icon>chevron_left</mat-icon></button>
                <span class="caption">Question {{ previewIndex() + 1 }} of {{ questions().length }}</span>
                <button type="button" class="ce-icon-btn sm" (click)="stepPreview(1)" [disabled]="previewIndex() >= questions().length - 1" aria-label="Next question"><mat-icon>chevron_right</mat-icon></button>
              </div>
            </aside>
          }
        </div>

        <footer class="ops-ed-foot">
          <span class="sum" data-testid="builder-summary"><b>{{ questions().length }}</b> questions · max score <b>{{ maxScore() }}</b></span>
          <span class="spacer"></span>
          @if (!readOnly()) {
            <button type="button" class="ce-btn ce-btn-ghost" (click)="cancel()" data-testid="btn-cancel">Cancel</button>
            <button type="button" class="ce-btn ce-btn-secondary" (click)="save(false)" [disabled]="saving()" data-testid="btn-save-draft">Save as draft</button>
            <button type="button" class="ce-btn ce-btn-primary" (click)="save(true)" [disabled]="saving()" data-testid="btn-save">
              @if (saving()) {
                <mat-spinner diameter="16" />
              }
              Publish
            </button>
          } @else {
            <a class="ce-btn ce-btn-secondary" routerLink="/checklists">Close</a>
          }
        </footer>
      }
    </section>
  `,
})
export class TemplateBuilderPage implements HasUnsavedChanges {
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  /** Route param (component input binding). */
  readonly id = input<string | undefined>(undefined);

  readonly categories = CHECKLIST_CATEGORIES;
  readonly frequencies: Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'ADHOC'];
  readonly types = QUESTION_TYPES;
  readonly meta = QUESTION_TYPE_META;
  readonly humanize = humanize;

  name = '';
  description = '';
  category: ChecklistCategory = 'AUDIT';
  frequency: Frequency = 'DAILY';
  readonly original = signal<Template | null>(null);
  readonly questions = signal<QDraft[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly notFound = signal(false);
  readonly saving = signal(false);
  readonly errors = signal<string[]>([]);
  readonly showErrors = signal(false);
  readonly uploadingKey = signal<number | null>(null);
  readonly refErrors = signal<Record<number, string>>({});
  readonly focusKey = signal<number | null>(null);
  readonly showPreview = signal(false);
  private readonly version = signal(0);
  private snapshot = '';
  private saved = false;

  readonly isNew = computed(() => !this.id() || this.id() === 'new');
  readonly readOnly = computed(() => !this.auth.can('manageTemplates'));
  readonly maxScore = computed(() => {
    this.version();
    return this.questions().reduce((s, q) => s + (Number(q.weight) || 0), 0);
  });
  readonly blocks = computed(() => {
    this.version();
    return sectionBlocks(this.questions());
  });
  readonly previewIndex = computed(() => {
    const k = this.focusKey();
    const i = this.questions().findIndex((q) => q._key === k);
    return i >= 0 ? i : this.questions().length ? 0 : -1;
  });
  readonly previewQuestion = computed(() => {
    this.version();
    const q = this.questions()[this.previewIndex()];
    return q ? ({ ...q, options: [...(q.options ?? [])] } as Question) : null;
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    if (this.isNew()) {
      this.questions.set([this.draft({ type: 'YES_NO', section: 'General' })]);
      this.snapshot = this.serialise();
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    this.api.get<Template>(`/checklists/templates/${this.id()}`, null, silent()).subscribe({
      next: (t) => {
        this.original.set(t);
        this.name = t.name;
        this.description = t.description ?? '';
        this.category = t.category;
        this.frequency = t.frequency;
        this.questions.set([...(t.questions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map((q) => this.draft(q)));
        this.loading.set(false);
        this.snapshot = this.serialise();
      },
      error: (e) => {
        this.loading.set(false);
        const st = (e as { status?: number })?.status;
        this.notFound.set(st === 404);
        this.loadError.set(st === 404 ? 'It may have been deleted.' : errorMessage(e));
      },
    });
  }

  hasUnsavedChanges(): boolean {
    return !this.readOnly() && !this.saved && !this.loading() && !this.loadError() && this.serialise() !== this.snapshot;
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) e.preventDefault();
  }

  private serialise(): string {
    return JSON.stringify({ n: this.name, d: this.description, c: this.category, f: this.frequency, q: this.questions().map((q, i) => normaliseQuestion(q, i)) });
  }

  private draft(q: Partial<Question>): QDraft {
    return {
      section: q.section ?? this.lastSection(),
      text: q.text ?? '',
      type: q.type ?? 'YES_NO',
      options: q.options ?? [],
      correctOptions: q.correctOptions ?? [],
      required: q.required ?? true,
      weight: q.weight ?? 1,
      requiresPhoto: q.requiresPhoto ?? q.type === 'PHOTO',
      sortOrder: q.sortOrder ?? 0,
      minValue: q.minValue ?? null,
      maxValue: q.maxValue ?? null,
      aiCheck: q.aiCheck ?? 'NONE',
      referenceImageUrl: q.referenceImageUrl ?? null,
      createTaskOnFail: q.createTaskOnFail ?? false,
      ...(q.id !== undefined ? { id: q.id } : {}),
      _key: keySeq++,
      _optionsText: (q.options ?? []).join(', '),
    };
  }

  lastSection(): string {
    const qs = this.questions?.() ?? [];
    return qs.length ? (qs[qs.length - 1].section || 'General') : 'General';
  }
  sectionOf(q: QDraft): string {
    return (q.section || '').trim() || 'General';
  }
  countIn(section: string): number {
    return this.blocks().find((b) => b.section === section)?.items.length ?? 0;
  }
  isOptionType(t: QuestionType): boolean {
    return OPTION_TYPES.has(t);
  }
  issues(q: QDraft): Record<string, string> {
    return questionIssues(q);
  }
  hasIssues(q: QDraft): boolean {
    return Object.keys(questionIssues(q)).length > 0 || (q.aiCheck === 'REFERENCE_MATCH' && !q.referenceImageUrl);
  }

  touch(): void {
    this.version.update((v) => v + 1);
  }

  focus(q: QDraft, scroll = false): void {
    this.focusKey.set(q._key);
    if (scroll) queueMicrotask(() => document.getElementById('q-' + q._key)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  jump(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  stepPreview(d: number): void {
    const q = this.questions()[this.previewIndex() + d];
    if (q) this.focus(q, true);
  }

  addQuestion(type: QuestionType): void {
    const base: Partial<Question> = { type };
    if (OPTION_TYPES.has(type)) base.options = ['Option 1', 'Option 2'];
    const d = this.draft(base);
    this.questions.update((qs) => [...qs, d]);
    this.focus(d, true);
  }

  addSection(): void {
    const existing = new Set(this.questions().map((q) => this.sectionOf(q)));
    let n = existing.size + 1;
    while (existing.has(`Section ${n}`)) n++;
    const d = this.draft({ section: `Section ${n}`, type: 'YES_NO' });
    this.questions.update((qs) => [...qs, d]);
    this.focus(d, true);
  }

  duplicate(i: number): void {
    const q = this.questions()[i];
    const { id: _id, _key, ...rest } = q;
    const d = this.draft({ ...rest, options: [...(rest.options ?? [])], correctOptions: [...(rest.correctOptions ?? [])] });
    this.questions.update((qs) => [...qs.slice(0, i + 1), d, ...qs.slice(i + 1)]);
    this.focus(d);
  }

  remove(i: number): void {
    this.questions.update((qs) => qs.filter((_, idx) => idx !== i));
  }

  move(i: number, delta: number): void {
    this.questions.update((qs) => moveItem(qs, i, i + delta));
  }

  drop(e: CdkDragDrop<QDraft[]>): void {
    if (e.previousIndex === e.currentIndex) return;
    this.questions.update((qs) => {
      const next = moveItem(qs, e.previousIndex, e.currentIndex);
      // a card dropped next to another section's cards joins that section
      const moved = next[e.currentIndex];
      const neighbour = next[e.currentIndex - 1] ?? next[e.currentIndex + 1];
      if (moved && neighbour && e.currentIndex > 0 && this.sectionOf(next[e.currentIndex - 1]) !== this.sectionOf(moved) && (!next[e.currentIndex + 1] || this.sectionOf(next[e.currentIndex + 1]) !== this.sectionOf(moved))) {
        moved.section = this.sectionOf(next[e.currentIndex - 1]);
      }
      return next;
    });
  }

  dropSection(e: CdkDragDrop<unknown>): void {
    if (e.previousIndex === e.currentIndex) return;
    this.questions.update((qs) => reorderSections(qs, e.previousIndex, e.currentIndex));
  }

  setType(q: QDraft, t: QuestionType): void {
    if (this.readOnly() || q.type === t) return;
    q.type = t;
    if (OPTION_TYPES.has(t) && !(q.options ?? []).length) {
      q.options = ['Option 1', 'Option 2'];
      q._optionsText = q.options.join(', ');
    }
    if (t === 'PHOTO') q.requiresPhoto = true;
    if (t === 'VIDEO') {
      q.requiresPhoto = true; // media required (the video itself)
      q.aiCheck = 'NONE';
    }
    if (t !== 'PHOTO' && t !== 'VIDEO' && !q.requiresPhoto) q.aiCheck = 'NONE';
    if (t === 'MCQ_SINGLE' && (q.correctOptions ?? []).length > 1) q.correctOptions = q.correctOptions!.slice(0, 1);
    this.questions.update((qs) => [...qs]);
    this.touch();
  }

  // ------------------------------------------------------------ options editor
  private syncOptions(q: QDraft, options: string[]): void {
    q.options = options;
    q._optionsText = options.join(', ');
    q.correctOptions = (q.correctOptions ?? []).filter((c) => options.includes(c));
    this.touch();
  }
  onOptionsText(q: QDraft): void {
    q.options = parseOptions(q._optionsText);
    q.correctOptions = (q.correctOptions ?? []).filter((c) => q.options!.includes(c));
    this.touch();
  }
  addOption(q: QDraft): void {
    const opts = q.options ?? [];
    let n = opts.length + 1;
    while (opts.includes(`Option ${n}`)) n++;
    this.syncOptions(q, [...opts, `Option ${n}`]);
  }
  removeOption(q: QDraft, i: number): void {
    this.syncOptions(q, (q.options ?? []).filter((_, x) => x !== i));
  }
  renameOption(q: QDraft, i: number, v: string): void {
    const text = (v ?? '').trim();
    const opts = [...(q.options ?? [])];
    const old = opts[i];
    if (!text || (opts.includes(text) && opts.indexOf(text) !== i)) {
      this.syncOptions(q, opts); // reject empty/duplicate: restore
      return;
    }
    opts[i] = text;
    q.correctOptions = (q.correctOptions ?? []).map((c) => (c === old ? text : c));
    this.syncOptions(q, opts);
  }
  toggleCorrect(q: QDraft, o: string): void {
    const cur = q.correctOptions ?? [];
    if (q.type === 'MCQ_SINGLE') q.correctOptions = cur.includes(o) ? [] : [o];
    else q.correctOptions = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o];
    this.touch();
  }

  uploadReference(q: QDraft, el: HTMLInputElement): void {
    const file = el.files?.[0];
    if (!file) return;
    const err = validateFile(file, IMAGE_RULE);
    this.refErrors.update((m) => ({ ...m, [q._key]: err ?? '' }));
    if (err) {
      el.value = '';
      return;
    }
    const fd = new FormData();
    fd.append('file', file, file.name);
    this.uploadingKey.set(q._key);
    this.api.upload<UploadResult>('/uploads', fd, silent()).subscribe({
      next: (r) => {
        q.referenceImageUrl = r.url;
        this.uploadingKey.set(null);
        this.touch();
        el.value = '';
      },
      error: (e) => {
        this.uploadingKey.set(null);
        this.refErrors.update((m) => ({ ...m, [q._key]: `Upload failed: ${errorMessage(e)}` }));
        el.value = '';
      },
    });
  }

  buildPayload(isActive: boolean): TemplateInput {
    return {
      name: this.name.trim(),
      description: this.description.trim(),
      category: this.category,
      frequency: this.frequency,
      isActive,
      questions: this.questions().map((q, i) => normaliseQuestion(q, i)),
    };
  }

  cancel(): void {
    void this.router.navigate(['/checklists']);
  }

  save(publish: boolean): void {
    if (this.saving()) return;
    const payload = this.buildPayload(publish);
    const errs = validateTemplate(payload);
    payload.questions.forEach((q, i) => {
      const w = Number(q.weight);
      if (!(w > 0) && !errs.some((e) => e.startsWith(`Question ${i + 1}: weight`))) errs.push(`Question ${i + 1}: weight must be greater than 0`);
    });
    this.errors.set(errs);
    this.showErrors.set(errs.length > 0);
    if (errs.length) {
      this.ui.toast('Please fix the highlighted problems');
      setTimeout(() => document.querySelector('[data-testid="template-errors"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }
    this.saving.set(true);
    const req = this.isNew() ? this.api.post<Template>('/checklists/templates', payload, null, silent()) : this.api.put<Template>(`/checklists/templates/${this.id()}`, payload, silent());
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.saved = true;
        this.ui.toast(publish ? 'Template saved' : 'Template saved as draft');
        void this.router.navigate(['/checklists']);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        // contract v4: the server's validation (MCQ options, lengths, …) in the same "fix these" list
        this.errors.set([httpStatus(e) === 403 ? 'You do not have permission to change checklists.' : apiErrorText(e, 'The server rejected the checklist.')]);
        this.showErrors.set(true);
        setTimeout(() => document.querySelector('[data-testid="template-errors"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      },
    });
  }
}
