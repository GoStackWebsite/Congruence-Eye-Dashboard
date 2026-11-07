import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { AI_MANAGER_TYPES, AiManagerRule, AiManagerRuleInput, AiManagerType, AlertChannel, ParamValue, SEVERITIES, Store, Zone } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { V2Api } from '../../core/services/v2.api';
import { humanize } from '../../core/utils/format';
import { AI_PARAM_DEFAULTS, AI_PARAM_LABELS, AI_TYPE_INFO, DOW_SHORT, daysLabel, normaliseAiParams } from '../../core/utils/v2-helpers';
import { CeColumn, DS } from '../../shared/ds';
import { HasUnsavedChanges } from '../../shared/ds/unsaved-changes.guard';
import { HumanizePipe } from '../../shared/pipes';
import { UiService } from '../../shared/ui/ui.service';
import { AI_PARAM_SENTENCES, DETECTION_ZONE_TYPES, OPEN_CLOSE_EXTRAS, emptyAiRule, openCloseExtras, parseEmails, validateAiRule } from './ai-rule.helpers';

interface OutlineItem {
  id: string;
  label: string;
  icon: string;
  done: boolean;
}

/**
 * AI Manager › AI checklist editor (reference 10): header with Publish / Save as draft, a left "Assign" outline and
 * stacked sections — Details, Schedule, Notify alert, Rule settings (sentence inputs, buffer time, early open /
 * late close), Detection areas and Assign stores (auto-assign, store chips, searchable store list with open/close
 * times). Works against /api/ai-manager/rules; read-only for roles without manageAiRules.
 */
@Component({
  selector: 'ce-ai-rule-editor-page',
  imports: [
    FormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatIconModule,
    MatTooltipModule,
    ...DS,
    HumanizePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rule-editor" data-testid="page-ai-rule-editor">
      <header class="re-head">
        <a class="ce-page-back" routerLink="/ai-manager/rules" aria-label="Back to AI checklists" data-testid="btn-back"><mat-icon>arrow_back</mat-icon></a>
        <div class="re-titles">
          <div class="re-title-row">
            <h1 class="ce-page-title" data-testid="page-title">{{ r().name.trim() || (isNew() ? 'New AI checklist' : 'AI checklist') }}</h1>
            @if (!isNew()) {
              <ce-pill [value]="original()?.isActive ? 'PUBLISHED' : 'DRAFT'" size="sm" data-testid="rule-state" />
            }
            @if (readOnly()) {
              <ce-pill tone="neutral" label="View only" [dot]="false" icon="visibility" size="sm" />
            }
          </div>
          <p class="re-desc">{{ info[r().type].desc }} · {{ info[r().type].label }}</p>
        </div>
        <div class="re-actions">
          <button type="button" class="ce-btn ce-btn-ghost" (click)="cancel()" data-testid="btn-cancel">{{ readOnly() ? 'Close' : 'Cancel' }}</button>
          @if (!readOnly()) {
            <button type="button" class="ce-btn ce-btn-secondary" (click)="save(false)" [disabled]="saving()" data-testid="btn-save-draft">Save as draft</button>
            <button type="button" class="ce-btn ce-btn-primary" (click)="save(true)" [disabled]="saving()" data-testid="btn-save">
              <mat-icon>rocket_launch</mat-icon> Publish
            </button>
          }
        </div>
      </header>

      @if (errors().length) {
        <ce-info-banner tone="danger" title="Fix these before saving" data-testid="ai-rule-errors">
          @for (e of errors(); track e) {
            <div>{{ e }}</div>
          }
        </ce-info-banner>
      }
      @if (notFound()) {
        <ce-empty-state icon="smart_toy" title="AI checklist not found" message="It may have been deleted.">
          <a class="ce-btn ce-btn-secondary" routerLink="/ai-manager/rules">Back to AI checklists</a>
        </ce-empty-state>
      } @else {
        <div class="re-body">
          <aside class="re-outline" aria-label="Rule outline">
            <div class="re-ol-block">
              <div class="re-ol-label">Detection</div>
              <div class="re-ol-type">
                <span class="re-ol-icon"><span class="material-symbols-outlined">{{ info[r().type].icon }}</span></span>
                <span>{{ info[r().type].label }}</span>
              </div>
            </div>
            <div class="re-ol-block">
              <div class="re-ol-label">Detection areas</div>
              <div class="ce-chip-list">
                @for (z of selectedZones().slice(0, 4); track z.id) {
                  <span class="ce-tag"><span class="ellipsis">{{ z.name }}</span></span>
                } @empty {
                  <span class="caption">Whole camera frame</span>
                }
                @if (selectedZones().length > 4) {
                  <span class="caption">+{{ selectedZones().length - 4 }} more</span>
                }
              </div>
            </div>
            <div class="re-ol-block">
              <div class="re-ol-label">Assign</div>
              <div class="re-ol-row"><span class="material-symbols-outlined">storefront</span>Stores</div>
              <div class="re-ol-row"><span class="material-symbols-outlined">inventory_2</span>{{ autoAssign() ? 'All ' + lookup.stores().length + ' stores' : r().storeIds.length + ' stores' }}</div>
              <div class="re-ol-row"><span class="material-symbols-outlined">schedule</span>{{ r().windowStart }}–{{ r().windowEnd }} · {{ days(r().daysOfWeek) }}</div>
            </div>
            <nav class="re-ol-nav" aria-label="Sections">
              @for (o of outline(); track o.id) {
                <a [href]="'#' + o.id" (click)="jump($event, o.id)" [class.done]="o.done">
                  <span class="material-symbols-outlined">{{ o.done ? 'check_circle' : o.icon }}</span>{{ o.label }}
                </a>
              }
            </nav>
          </aside>

          <div class="re-sections">
            <ce-form-section title="Details" anchor="sec-details" description="Name the checklist and choose what the cameras should detect.">
              <div class="re-grid">
                <div class="full">
                  <label class="ce-field-label" for="ai-name">Rule name</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                    <input id="ai-name" matInput [ngModel]="r().name" (ngModelChange)="patch({ name: $event })" [disabled]="readOnly()" placeholder="e.g. Store open & close — Chennai" data-testid="input-ai-rule-name" />
                  </mat-form-field>
                </div>
                <div>
                  <label class="ce-field-label">Detection type</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                    <mat-select [ngModel]="r().type" (ngModelChange)="setType($event)" [disabled]="readOnly()" data-testid="input-ai-rule-type" aria-label="Detection type">
                      <mat-select-trigger>{{ info[r().type].label }}</mat-select-trigger>
                      @for (t of types; track t) {
                        <mat-option [value]="t"><span class="material-symbols-outlined opt-icon">{{ info[t].icon }}</span>{{ info[t].label }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                </div>
                <div>
                  <label class="ce-field-label">Severity</label>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                    <mat-select [ngModel]="r().severity" (ngModelChange)="patch({ severity: $event })" [disabled]="readOnly()" data-testid="input-ai-rule-severity" aria-label="Severity">
                      @for (s of severities; track s) {
                        <mat-option [value]="s">{{ s | humanize }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                </div>
              </div>
            </ce-form-section>

            <ce-form-section title="Schedule" anchor="sec-schedule" info="Detections run only inside this window, in each store's local time.">
              <ce-info-banner tone="info">
                @if (r().type === 'STORE_OPEN_CLOSE') {
                  Store open and close detections follow each store's own opening and closing times. You can view or edit store timings in the Assign stores section below.
                } @else {
                  This AI checklist runs detections during the window below on the selected days, starting when the store opens and stopping when it closes.
                }
              </ce-info-banner>
              <div class="ce-sentence">
                <span class="lead">Run detections from</span>
                <input class="ce-inline-input wide" type="time" [ngModel]="r().windowStart" (ngModelChange)="patch({ windowStart: $event })" [disabled]="readOnly()" data-testid="input-ai-rule-window-start" aria-label="Window start" />
                <span>to</span>
                <input class="ce-inline-input wide" type="time" [ngModel]="r().windowEnd" (ngModelChange)="patch({ windowEnd: $event })" [disabled]="readOnly()" data-testid="input-ai-rule-window-end" aria-label="Window end" />
              </div>
              <div class="ce-sentence">
                <span class="lead">On</span>
                <div class="day-chips" data-testid="input-ai-rule-days">
                  @for (d of weekOrder; track d) {
                    <mat-checkbox class="day-chip" [checked]="r().daysOfWeek.includes(d)" (change)="toggleDay(d, $event.checked)" [disabled]="readOnly()" [attr.data-testid]="'ai-day-' + d">{{ dow[d] }}</mat-checkbox>
                  }
                </div>
                <span class="caption">{{ days(r().daysOfWeek) }}</span>
              </div>
            </ce-form-section>

            <ce-form-section title="Notify alert" anchor="sec-notify" info="Who hears about a breach, and how. In-app alerts go to the managers of the store.">
              <div class="ce-sentence">
                <span class="lead">Send alert via</span>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="re-channels">
                  <mat-select multiple [ngModel]="r().notifyChannels" (ngModelChange)="patch({ notifyChannels: $event })" [disabled]="readOnly()" data-testid="input-ai-rule-channels" aria-label="Notification channels">
                    @for (c of channels; track c) {
                      <mat-option [value]="c">{{ channelLabel(c) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              </div>
              @if (r().notifyChannels.includes('EMAIL')) {
                <div class="re-recipients">
                  <label class="ce-field-label" for="ai-emails">Send alert to</label>
                  <div class="ce-tag-box">
                    <ce-chip-list [items]="emailChips()" [removable]="!readOnly()" (remove)="removeEmail($any($event))" testIdPrefix="recipient-" />
                    <input
                      id="ai-emails"
                      class="re-email-input"
                      [ngModel]="pendingEmail()"
                      (ngModelChange)="onEmailInput($event)"
                      (keydown.enter)="$event.preventDefault(); commitEmail()"
                      (blur)="commitEmail()"
                      [disabled]="readOnly()"
                      [placeholder]="emailChips().length ? 'Add another email' : 'Type an email and press Enter'"
                      data-testid="input-ai-rule-emails"
                    />
                  </div>
                  <div class="caption">Each recipient gets an email per breach. Press Enter or comma to add.</div>
                </div>
              }
            </ce-form-section>

            <ce-form-section title="Rule settings" anchor="sec-settings" [description]="'Thresholds for ' + info[r().type].label.toLowerCase() + '. Defaults follow the AI service contract.'">
              <div class="re-params" data-testid="ai-rule-params">
                @if (r().type === 'STORE_OPEN_CLOSE') {
                  <ce-toggle-row label="Set buffer time" helper="When enabled, alerts are paused during the buffer period" [checked]="bufferOn()" (checkedChange)="setBuffer($event)" [disabled]="readOnly()" testId="toggle-buffer">
                    <div class="ce-sentence">
                      <span>If store open time exceeds by</span>
                      <input class="ce-inline-input" type="number" min="0" [ngModel]="r().params['toleranceMin']" (ngModelChange)="setParam('toleranceMin', $event)" [disabled]="readOnly()" data-testid="input-param-toleranceMin" aria-label="Buffer minutes" />
                      <span>minutes</span>
                    </div>
                    <div class="ce-sentence">
                      <span>If store close time is earlier by</span>
                      <span class="ce-inline-input mirror" aria-hidden="true">{{ r().params['toleranceMin'] }}</span>
                      <span>minutes</span>
                      <span class="caption">same buffer</span>
                    </div>
                  </ce-toggle-row>
                  <div class="ce-divider"></div>
                  <ce-toggle-row
                    label="Detect early open & late close"
                    helper="When enabled, the system monitors during the configured time before open and after close"
                    [checked]="!!extras()"
                    (checkedChange)="setExtras($event)"
                    [disabled]="readOnly()"
                    testId="toggle-early-late"
                  >
                    <div class="ce-sentence">
                      <span>Monitor store for</span>
                      <input class="ce-inline-input" type="number" min="0" [ngModel]="extras()?.monitorBeforeOpenMin" (ngModelChange)="setExtra('monitorBeforeOpenMin', $event)" [disabled]="readOnly()" data-testid="input-param-monitorBeforeOpenMin" aria-label="Minutes before open" />
                      <span>minutes before the scheduled open time</span>
                    </div>
                    <div class="ce-sentence">
                      <span>Monitor store for</span>
                      <input class="ce-inline-input" type="number" min="0" [ngModel]="extras()?.monitorAfterCloseMin" (ngModelChange)="setExtra('monitorAfterCloseMin', $event)" [disabled]="readOnly()" data-testid="input-param-monitorAfterCloseMin" aria-label="Minutes after close" />
                      <span>minutes after the scheduled close time</span>
                    </div>
                  </ce-toggle-row>
                } @else {
                  @for (k of paramKeys(); track k) {
                    @if (isBool(k)) {
                      <div class="re-switch">
                        <mat-slide-toggle [ngModel]="r().params[k]" (ngModelChange)="setParam(k, $event)" [disabled]="readOnly()" [attr.data-testid]="'input-param-' + k">{{ sentence(k).before }}</mat-slide-toggle>
                        @if (sentence(k).helper) {
                          <span class="caption">{{ sentence(k).helper }}</span>
                        }
                      </div>
                    } @else {
                      <div class="ce-sentence">
                        <span>{{ sentence(k).before }}</span>
                        <input
                          class="ce-inline-input"
                          type="number"
                          [attr.step]="sentence(k).step ?? 1"
                          [attr.min]="sentence(k).min ?? null"
                          [attr.max]="sentence(k).max ?? null"
                          [ngModel]="r().params[k]"
                          (ngModelChange)="setParam(k, $event)"
                          [disabled]="readOnly()"
                          [attr.data-testid]="'input-param-' + k"
                          [attr.aria-label]="paramLabel(k)"
                        />
                        <span>{{ sentence(k).after }}</span>
                        <span class="caption">default {{ defaults()[k] }}</span>
                      </div>
                    }
                  }
                }
              </div>
            </ce-form-section>

            <ce-form-section title="Detection areas" anchor="sec-areas" info="Zones drawn on the store cameras. Leave empty to analyse the whole camera frame.">
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <mat-select multiple [ngModel]="r().zoneIds" (ngModelChange)="patch({ zoneIds: $event })" [disabled]="readOnly()" data-testid="input-ai-rule-zones" placeholder="Whole camera frame" aria-label="Detection areas">
                  @for (z of areaOptions(); track z.id) {
                    <mat-option [value]="z.id">{{ z.name }} · {{ z.type | humanize }} · {{ storeName(z.storeId) }}</mat-option>
                  } @empty {
                    <mat-option disabled>{{ r().storeIds.length ? 'No matching zones in the selected stores' : 'Select stores first' }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <div class="caption">
                {{ r().storeIds.length ? areaOptions().length + ' matching zone(s) in the selected stores · ' + allowedTypes() : 'Select stores below to choose detection areas' }}
              </div>
            </ce-form-section>

            <ce-form-section title="Assign stores" anchor="sec-stores">
              <mat-checkbox [checked]="autoAssign()" (change)="setAutoAssign($event.checked)" [disabled]="readOnly()" data-testid="input-ai-rule-auto-assign">Auto assign to all stores, including newly deployed stores</mat-checkbox>
              <div>
                <label class="ce-field-label">Selected stores</label>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                  <mat-select multiple [ngModel]="r().storeIds" (ngModelChange)="setStores($event)" [disabled]="readOnly()" data-testid="input-ai-rule-stores" [placeholder]="autoAssign() ? 'All stores' : 'Add stores'" aria-label="Stores">
                    @for (s of lookup.stores(); track s.id) {
                      <mat-option [value]="s.id">{{ s.name }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                @if (!autoAssign()) {
                  <div class="ce-tag-box re-store-chips">
                    <ce-chip-list [items]="storeChips()" [removable]="!readOnly()" (remove)="removeStore($any($event))" [max]="14" testIdPrefix="store-chip-" />
                  </div>
                }
              </div>
              <ce-table
                [rows]="storeRows()"
                [columns]="storeCols"
                title="Selected stores list"
                [showTotal]="true"
                [searchable]="true"
                searchPlaceholder="Search stores"
                searchTestId="input-search-rule-stores"
                testId="table-rule-stores"
                [rowTestId]="storeRowId"
                [pageSize]="10"
                emptyIcon="storefront"
                emptyTitle="No stores selected"
                emptyMessage="Pick stores above, or tick auto-assign to cover every store."
              >
                @if (canEditStores()) {
                  <a tableActions class="ce-btn ce-btn-secondary ce-btn-sm" routerLink="/admin/stores" data-testid="link-edit-store-time"><mat-icon>edit_calendar</mat-icon> Edit store time</a>
                }
              </ce-table>
            </ce-form-section>
          </div>
        </div>
      }
    </section>
  `,
})
export class AiRuleEditorPage implements HasUnsavedChanges {
  /** Route param (/ai-manager/rules/:ruleId); absent for /new. */
  readonly ruleId = input<string | undefined>(undefined);
  protected readonly lookup = inject(LookupService);
  private readonly api = inject(ApiService);
  private readonly v2 = inject(V2Api);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly types = AI_MANAGER_TYPES;
  readonly info: Record<string, { label: string; icon: string; desc: string }> = AI_TYPE_INFO;
  readonly severities = SEVERITIES;
  readonly channels: AlertChannel[] = ['IN_APP', 'EMAIL', 'WEBHOOK'];
  readonly weekOrder = [1, 2, 3, 4, 5, 6, 0];
  readonly dow = DOW_SHORT;

  readonly readOnly = computed(() => !this.auth.can('manageAiRules'));
  readonly canEditStores = computed(() => this.auth.can('adminMaster'));
  readonly isNew = computed(() => !this.ruleId() || this.ruleId() === 'new');
  readonly original = signal<AiManagerRule | null>(null);
  readonly notFound = signal(false);
  readonly saving = signal(false);
  readonly errors = signal<string[]>([]);
  readonly r = signal<AiManagerRuleInput>(emptyAiRule());
  /** Email being typed in the recipients box (committed into chips on Enter / comma / blur, and on save). */
  readonly pendingEmail = signal('');
  private readonly zones = signal<Zone[]>([]);
  /** The rule as loaded (or the empty rule), to tell whether there are unsaved edits. */
  private readonly baseline = signal<string>(JSON.stringify(emptyAiRule()));
  private leaving = false;

  readonly defaults = computed(() => AI_PARAM_DEFAULTS[this.r().type]);
  readonly paramKeys = computed(() => Object.keys(this.defaults()));
  readonly autoAssign = computed(() => !this.r().storeIds.length);
  readonly bufferOn = computed(() => Number(this.r().params['toleranceMin']) > 0);
  readonly extras = computed(() => openCloseExtras(this.r().params));
  readonly allowedTypes = computed(() => DETECTION_ZONE_TYPES[this.r().type].map((t) => humanize(t)).join(', '));
  readonly areaOptions = computed(() => {
    const allowed = DETECTION_ZONE_TYPES[this.r().type];
    const ids = this.r().storeIds;
    // deleted zones are only deactivated (history is kept) — never offer them as detection areas
    return this.zones().filter((z) => z.isActive !== false && ids.includes(z.storeId) && allowed.includes(z.type));
  });
  readonly selectedZones = computed(() => this.areaOptions().filter((z) => this.r().zoneIds.includes(z.id)));
  readonly emailChips = computed(() => parseEmails(this.r().notifyEmails).map((e) => ({ id: e, label: e, badge: e.slice(0, 2).toUpperCase() })));
  readonly storeChips = computed(() => {
    const m = new Map(this.lookup.stores().map((s) => [s.id, s] as const));
    return this.r().storeIds.map((id) => ({ id, label: m.get(id)?.code || m.get(id)?.name || `#${id}`, title: m.get(id)?.name }));
  });
  readonly storeRows = computed<Store[]>(() => {
    const all = this.lookup.stores();
    const ids = this.r().storeIds;
    return ids.length ? all.filter((s) => ids.includes(s.id)) : all;
  });
  readonly storeCols: CeColumn<Store>[] = [
    { key: 'name', header: 'Store name', sortable: true, secondary: (s) => s.code },
    { key: 'regionName', header: 'Region', sortable: true },
    { key: 'city', header: 'City', sortable: true },
    { key: 'openTime', header: 'Open time', sortable: true },
    { key: 'closeTime', header: 'Close time', sortable: true },
  ];
  readonly storeRowId = (s: Store) => `row-rule-store-${s.id}`;
  readonly outline = computed<OutlineItem[]>(() => {
    const r = this.r();
    return [
      { id: 'sec-details', label: 'Details', icon: 'badge', done: !!r.name.trim() },
      { id: 'sec-schedule', label: 'Schedule', icon: 'schedule', done: !!r.daysOfWeek.length && r.windowStart < r.windowEnd },
      { id: 'sec-notify', label: 'Notify alert', icon: 'notifications', done: !!r.notifyChannels.length },
      { id: 'sec-settings', label: 'Rule settings', icon: 'tune', done: true },
      { id: 'sec-areas', label: 'Detection areas', icon: 'crop_free', done: true },
      { id: 'sec-stores', label: 'Assign stores', icon: 'storefront', done: true },
    ];
  });

  constructor() {
    this.lookup.loadStores().subscribe();
    effect(() => {
      const id = this.ruleId();
      if (!id || id === 'new') {
        this.original.set(null);
        const empty = emptyAiRule();
        this.r.set(empty);
        this.baseline.set(JSON.stringify(empty));
        return;
      }
      this.v2.aiRules().subscribe({
        next: (rules) => {
          const rule = rules.find((x) => String(x.id) === String(id)) ?? null;
          this.original.set(rule);
          this.notFound.set(!rule);
          if (rule) {
            const extras = openCloseExtras(rule.params);
            this.r.set({
              ...rule,
              params: { ...normaliseAiParams(rule.type, rule.params), ...(rule.type === 'STORE_OPEN_CLOSE' && 'monitorBeforeOpenMin' in (rule.params ?? {}) ? (extras ?? { monitorBeforeOpenMin: 0, monitorAfterCloseMin: 0 }) : {}) },
              daysOfWeek: [...rule.daysOfWeek],
              zoneIds: [...rule.zoneIds],
              storeIds: [...rule.storeIds],
              notifyChannels: [...rule.notifyChannels],
            });
            this.baseline.set(JSON.stringify(untracked(() => this.r())));
          }
        },
        error: () => this.notFound.set(true),
      });
    });
    effect((onCleanup) => {
      const ids = this.r().storeIds;
      if (!ids.length) {
        this.zones.set([]);
        return;
      }
      const sub = forkJoin(ids.map((id) => this.api.get<Zone[]>('/zones', { storeId: id }, silent()).pipe(catchError(() => of([] as Zone[]))))).subscribe((lists) =>
        this.zones.set(lists.flat()),
      );
      onCleanup(() => sub.unsubscribe());
    });
  }

  /** Edits that would be lost by leaving (route guard + beforeunload). */
  hasUnsavedChanges(): boolean {
    if (this.leaving || this.readOnly() || this.notFound()) return false;
    return JSON.stringify(this.r()) !== this.baseline() || !!this.pendingEmail().trim();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) e.preventDefault();
  }

  patch(p: Partial<AiManagerRuleInput>): void {
    this.r.update((r) => ({ ...r, ...p }));
  }

  days(d: number[]): string {
    return daysLabel(d);
  }
  storeName(id: number): string {
    return this.lookup.storeName()(id);
  }
  isBool(k: string): boolean {
    return typeof this.defaults()[k] === 'boolean';
  }
  paramLabel(k: string): string {
    return AI_PARAM_LABELS[k] ?? k;
  }
  sentence(k: string): { before: string; after: string; step?: number; min?: number; max?: number; helper?: string } {
    return AI_PARAM_SENTENCES[k] ?? { before: this.paramLabel(k), after: '' };
  }
  channelLabel(c: AlertChannel): string {
    return c === 'IN_APP' ? 'In-app' : humanize(c);
  }

  setType(t: AiManagerType): void {
    // a different detection type starts from its own contract defaults (a same-named param such as
    // minDurationSec means something else per type: 20 s for phone use, 120 s for an unattended customer)
    const allowed = DETECTION_ZONE_TYPES[t];
    const keep = new Set(this.zones().filter((z) => allowed.includes(z.type)).map((z) => z.id));
    this.r.update((r) => ({
      ...r,
      type: t,
      params: normaliseAiParams(t, {}),
      zoneIds: r.zoneIds.filter((id) => keep.has(id)),
      name: r.name || AI_TYPE_INFO[t].label,
    }));
  }

  setParam(k: string, v: ParamValue): void {
    this.r.update((r) => ({ ...r, params: { ...r.params, [k]: v } }));
  }

  setBuffer(on: boolean): void {
    const def = Number(AI_PARAM_DEFAULTS.STORE_OPEN_CLOSE['toleranceMin']) || 10;
    this.setParam('toleranceMin', on ? (this.bufferOn() ? Number(this.r().params['toleranceMin']) : def) : 0);
  }

  setExtras(on: boolean): void {
    this.r.update((r) => ({
      ...r,
      params: { ...r.params, monitorBeforeOpenMin: on ? OPEN_CLOSE_EXTRAS.monitorBeforeOpenMin : 0, monitorAfterCloseMin: on ? OPEN_CLOSE_EXTRAS.monitorAfterCloseMin : 0 },
    }));
  }

  setExtra(k: 'monitorBeforeOpenMin' | 'monitorAfterCloseMin', v: number): void {
    this.setParam(k, Math.max(0, Number(v) || 0));
  }

  toggleDay(d: number, on: boolean): void {
    this.r.update((r) => ({ ...r, daysOfWeek: on ? [...new Set([...r.daysOfWeek, d])].sort() : r.daysOfWeek.filter((x) => x !== d) }));
  }

  setStores(ids: number[]): void {
    this.r.update((r) => ({ ...r, storeIds: [...ids] }));
  }
  removeStore(id: number): void {
    this.setStores(this.r().storeIds.filter((x) => x !== id));
  }
  setAutoAssign(on: boolean): void {
    if (on) this.setStores([]);
  }
  onEmailInput(v: string): void {
    if (/[,;]\s*$/.test(v)) {
      this.pendingEmail.set(v);
      this.commitEmail();
    } else this.pendingEmail.set(v);
  }
  commitEmail(): void {
    const add = parseEmails(this.pendingEmail());
    if (!add.length) return;
    this.patch({ notifyEmails: [...new Set([...parseEmails(this.r().notifyEmails), ...add])].join(', ') });
    this.pendingEmail.set('');
  }
  removeEmail(e: string): void {
    this.patch({ notifyEmails: parseEmails(this.r().notifyEmails).filter((x) => x !== e).join(', ') || null });
  }

  jump(ev: Event, id: string): void {
    ev.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  cancel(): void {
    void this.router.navigateByUrl('/ai-manager/rules');
  }

  save(publish: boolean): void {
    const cur = this.r();
    const params: Record<string, ParamValue> = normaliseAiParams(cur.type, cur.params);
    // optional open/close monitor windows: sent once turned on (0 = off), so an untouched rule keeps the contract params
    if (cur.type === 'STORE_OPEN_CLOSE' && ('monitorBeforeOpenMin' in cur.params || 'monitorAfterCloseMin' in cur.params)) {
      params['monitorBeforeOpenMin'] = Math.max(0, Number(cur.params['monitorBeforeOpenMin']) || 0);
      params['monitorAfterCloseMin'] = Math.max(0, Number(cur.params['monitorAfterCloseMin']) || 0);
    }
    const body: AiManagerRuleInput = {
      name: cur.name.trim(),
      type: cur.type,
      storeIds: cur.storeIds,
      zoneIds: cur.zoneIds.filter((id) => this.areaOptions().some((z) => z.id === id)),
      windowStart: cur.windowStart,
      windowEnd: cur.windowEnd,
      daysOfWeek: cur.daysOfWeek,
      params,
      severity: cur.severity,
      notifyChannels: cur.notifyChannels,
      notifyEmails: cur.notifyChannels.includes('EMAIL') ? [...new Set([...parseEmails(cur.notifyEmails), ...parseEmails(this.pendingEmail())])].join(', ') || null : null,
      isActive: publish,
    };
    const errs = validateAiRule(body);
    this.errors.set(errs);
    if (errs.length) {
      queueMicrotask(() => document.querySelector('[data-testid="ai-rule-errors"]')?.scrollIntoView({ block: 'center' }));
      return;
    }
    this.saving.set(true);
    const id = this.original()?.id;
    this.v2.saveAiRule(body, id).subscribe({
      next: () => {
        this.ui.toast(id ? 'Rule updated' : 'Rule created');
        this.leaving = true;
        void this.router.navigateByUrl('/ai-manager/rules');
      },
      error: () => this.saving.set(false),
    });
  }
}
