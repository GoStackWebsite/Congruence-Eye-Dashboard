import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DiscoveredDevice, Recorder, RecorderBrand, RecorderBrandInfo, RecorderInput, RecorderKind, RecorderStream } from '../../../core/models/api.models';
import { DS } from '../../../shared/ds';
import { DateTimePipe } from '../../../shared/pipes';
import { useOpsStyles } from '../../../shared/ds/ops.styles';
import { RecorderApi } from './recorder.api';
import { BRAND_HELP, RecorderFormValue, apiErrorText, defaultPortFor, httpStatus, previewUrl, validateRecorder } from './recorder.helpers';

const KINDS: { value: RecorderKind; label: string }[] = [
  { value: 'DVR', label: 'DVR (analog cameras)' },
  { value: 'NVR', label: 'NVR (IP cameras)' },
  { value: 'HYBRID', label: 'Hybrid / XVR' },
];

function blank(storeId: number): RecorderFormValue & { storeId: number } {
  return { storeId, name: '', brand: null, kind: 'DVR', host: '', rtspPort: 554, httpPort: 80, username: 'admin', password: '', channels: 8, stream: 'MAIN', urlTemplate: null };
}

/**
 * Add / edit a DVR or NVR (contract v3 "Add recorder"): brand picker with help, auto RTSP port, masked live preview
 * of the channel-1 URL, CUSTOM pattern validation, inline 409 for a duplicate host:port, and the devices the
 * store's AI box discovered on the LAN (click one to fill the form).
 */
@Component({
  selector: 'ce-recorder-drawer',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, ...DS, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <ce-drawer [(open)]="open" [title]="recorder() ? 'Edit recorder' : 'Add recorder'" [subtitle]="recorder() ? recorder()!.name + ' · ' + recorder()!.host : 'DVR or NVR on the store network'" size="lg" testId="dialog-recorder">
      @if (open()) {
        <form class="ops-form" id="ops-recorder-form" (ngSubmit)="save()" novalidate>
          @if (serverError()) {
            <ce-info-banner tone="danger" title="Couldn't save" data-testid="form-error">{{ serverError() }}</ce-info-banner>
          }
          <div class="ops-form-grid">
            <div class="ops-form-group full">Recorder</div>
            <div class="ops-field full">
              <label class="ce-field-label" for="rec-brand">Brand <span class="ops-req">*</span></label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <mat-select id="rec-brand" name="brand" [ngModel]="v().brand" (ngModelChange)="setBrand($event)" placeholder="Choose the brand on the recorder's label" data-testid="input-recorder-brand">
                  @for (b of brands(); track b.brand) {
                    <mat-option [value]="b.brand" [attr.data-testid]="'brand-option-' + b.brand">{{ b.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              @if (err()['brand']) {
                <div class="ops-inline-error" data-testid="error-brand">{{ err()['brand'] }}</div>
              } @else if (brandHelp()) {
                <div class="ops-brand-hint" data-testid="brand-help">{{ brandHelp() }}</div>
              }
            </div>
            <div class="ops-field">
              <label class="ce-field-label" for="rec-kind">Kind</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <mat-select id="rec-kind" name="kind" [ngModel]="v().kind" (ngModelChange)="patch({ kind: $event })" data-testid="input-recorder-kind">
                  @for (k of kinds; track k.value) {
                    <mat-option [value]="k.value">{{ k.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            <div class="ops-field">
              <label class="ce-field-label" for="rec-name">Name <span class="ops-req">*</span></label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <input id="rec-name" matInput name="name" [ngModel]="v().name" (ngModelChange)="patch({ name: $event })" placeholder="Ground floor DVR" maxlength="80" data-testid="input-recorder-name" />
              </mat-form-field>
              @if (err()['name']) {
                <div class="ops-inline-error" data-testid="error-name">{{ err()['name'] }}</div>
              }
            </div>

            <div class="ops-form-group full">Network</div>
            <div class="ops-field full">
              <label class="ce-field-label" for="rec-host">IP address or hostname <span class="ops-req">*</span></label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <input id="rec-host" matInput name="host" [ngModel]="v().host" (ngModelChange)="patch({ host: $event })" placeholder="192.168.1.64" autocomplete="off" spellcheck="false" data-testid="input-recorder-host" />
              </mat-form-field>
              @if (err()['host']) {
                <div class="ops-inline-error" data-testid="error-host">{{ err()['host'] }}</div>
              }
            </div>
            <div class="ops-field">
              <label class="ce-field-label" for="rec-rtsp">RTSP port <span class="ops-req">*</span></label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <input id="rec-rtsp" matInput type="number" min="1" max="65535" name="rtspPort" [ngModel]="v().rtspPort" (ngModelChange)="patch({ rtspPort: $event }); portTouched = true" data-testid="input-recorder-rtspPort" />
              </mat-form-field>
              @if (err()['rtspPort']) {
                <div class="ops-inline-error" data-testid="error-rtspPort">{{ err()['rtspPort'] }}</div>
              } @else {
                <div class="caption">Filled from the brand; change it only if the installer did</div>
              }
            </div>
            <div class="ops-field">
              <label class="ce-field-label" for="rec-http">HTTP port</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <input id="rec-http" matInput type="number" min="1" max="65535" name="httpPort" [ngModel]="v().httpPort" (ngModelChange)="patch({ httpPort: $event })" data-testid="input-recorder-httpPort" />
              </mat-form-field>
              @if (err()['httpPort']) {
                <div class="ops-inline-error" data-testid="error-httpPort">{{ err()['httpPort'] }}</div>
              } @else {
                <div class="caption">Used for ONVIF lookups</div>
              }
            </div>

            <div class="ops-form-group full">Login</div>
            <div class="ops-field">
              <label class="ce-field-label" for="rec-user">Username <span class="ops-req">*</span></label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <input id="rec-user" matInput name="username" [ngModel]="v().username" (ngModelChange)="patch({ username: $event })" autocomplete="off" data-testid="input-recorder-username" />
              </mat-form-field>
              @if (err()['username']) {
                <div class="ops-inline-error" data-testid="error-username">{{ err()['username'] }}</div>
              }
            </div>
            <div class="ops-field">
              <label class="ce-field-label" for="rec-pass">Password @if (!recorder()) {<span class="ops-req">*</span>}</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <input id="rec-pass" matInput [type]="showPass() ? 'text' : 'password'" name="password" [ngModel]="v().password" (ngModelChange)="patch({ password: $event })" autocomplete="new-password" [placeholder]="recorder()?.hasPassword ? 'Unchanged' : ''" data-testid="input-recorder-password" />
                <button matSuffix type="button" class="ce-icon-btn sm" (click)="showPass.set(!showPass())" [attr.aria-label]="showPass() ? 'Hide password' : 'Show password'"><mat-icon>{{ showPass() ? 'visibility_off' : 'visibility' }}</mat-icon></button>
              </mat-form-field>
              @if (err()['password']) {
                <div class="ops-inline-error" data-testid="error-password">{{ err()['password'] }}</div>
              } @else {
                <div class="caption">{{ recorder() ? 'Leave blank to keep the saved password' : 'Stored encrypted; never shown again' }}</div>
              }
            </div>

            <div class="ops-form-group full">Channels</div>
            <div class="ops-field">
              <label class="ce-field-label" for="rec-ch">Channel count <span class="ops-req">*</span></label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <input id="rec-ch" matInput type="number" min="1" max="64" name="channels" [ngModel]="v().channels" (ngModelChange)="patch({ channels: $event })" data-testid="input-recorder-channels" />
              </mat-form-field>
              @if (err()['channels']) {
                <div class="ops-inline-error" data-testid="error-channels">{{ err()['channels'] }}</div>
              } @else {
                <div class="caption">4, 8, 16 or 32 on most DVRs (1–64)</div>
              }
            </div>
            <div class="ops-field">
              <label class="ce-field-label">Stream</label>
              <ce-segmented [options]="streams" [value]="v().stream" (valueChange)="patch({ stream: $any($event) })" label="Stream" data-testid="input-recorder-stream" />
              <div class="caption">Main = full quality (recommended for AI)</div>
            </div>
            @if (v().brand === 'CUSTOM') {
              <div class="ops-field full">
                <label class="ce-field-label" for="rec-tpl">URL pattern <span class="ops-req">*</span></label>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                  <input id="rec-tpl" matInput name="urlTemplate" [ngModel]="v().urlTemplate" (ngModelChange)="patch({ urlTemplate: $event })" placeholder="rtsp://{user}:{pass}@{host}:{port}/live/ch{channel}" spellcheck="false" class="ops-mono" data-testid="input-recorder-urlTemplate" />
                </mat-form-field>
                @if (err()['urlTemplate']) {
                  <div class="ops-inline-error" data-testid="error-urlTemplate">{{ err()['urlTemplate'] }}</div>
                } @else {
                  <div class="caption">Placeholders: {{ '{user} {pass} {host} {port} {channel}' }}</div>
                }
              </div>
            }
            <div class="ops-field full">
              <label class="ce-field-label">Channel 1 address (preview)</label>
              <div class="ops-url-preview" data-testid="recorder-url-preview">
                <span class="material-symbols-outlined" aria-hidden="true">link</span>
                <code>{{ preview() ?? (v().brand === 'CUSTOM' ? 'Type a URL pattern to see the address' : 'Choose a brand to see the address') }}</code>
              </div>
              <div class="caption">The password is hidden. The store box fills in each channel number.</div>
            </div>
          </div>

          <div class="ops-drawer-section" data-testid="discovered">
            <div class="ops-row" style="margin-bottom: 6px">
              <h3 class="ops-section-title" style="margin: 0">Discovered on store network</h3>
              <span class="ops-spacer"></span>
              <button type="button" class="ce-icon-btn sm" (click)="loadDiscovered()" matTooltip="Refresh" aria-label="Refresh discovered devices"><mat-icon>refresh</mat-icon></button>
            </div>
            @if (discovering()) {
              <ce-skeleton kind="text" [count]="2" />
            } @else if (discovered().length) {
              <ul class="ops-disc" data-testid="discovered-list">
                @for (d of discovered(); track d.host + ':' + d.rtspPort) {
                  <li [attr.data-testid]="'discovered-' + d.host">
                    <span class="material-symbols-outlined ops-muted" aria-hidden="true">dvr</span>
                    <span class="ops-user-text" style="flex: 1">
                      <span class="ops-mono ops-strong">{{ d.host }}:{{ d.rtspPort }}</span>
                      <span class="caption">{{ brandLabel(d.brandGuess) }}{{ d.onvif ? ' · ONVIF' : '' }} · seen {{ d.seenAt | dt: 'relative' }}</span>
                    </span>
                    <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="useDiscovered(d)" data-testid="btn-use-discovered">Use</button>
                  </li>
                }
              </ul>
            } @else {
              <p class="ops-help" style="margin: 0">{{ discoverNote() }}</p>
            }
          </div>
        </form>
      }
      <ng-container drawerFooter>
        <button type="button" class="ce-btn ce-btn-ghost" (click)="open.set(false)" data-testid="btn-cancel">Cancel</button>
        <button type="submit" form="ops-recorder-form" class="ce-btn ce-btn-primary" [disabled]="saving()" data-testid="btn-save">
          @if (saving()) {
            <mat-spinner diameter="16" />
          }
          {{ recorder() ? 'Save changes' : 'Add recorder' }}
        </button>
      </ng-container>
    </ce-drawer>
  `,
})
export class RecorderDrawerComponent {
  protected readonly opsCss = useOpsStyles();
  private readonly api = inject(RecorderApi);
  readonly open = model(false);
  readonly storeId = input.required<number>();
  readonly recorder = input<Recorder | null>(null);
  readonly brands = input<RecorderBrandInfo[]>([]);
  readonly saved = output<Recorder>();

  readonly kinds = KINDS;
  readonly streams = [
    { value: 'MAIN', label: 'Main', testId: 'stream-main' },
    { value: 'SUB', label: 'Sub', testId: 'stream-sub' },
  ];
  readonly v = signal(blank(0));
  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly serverError = signal<string | null>(null);
  readonly serverField = signal<Record<string, string>>({});
  readonly showPass = signal(false);
  readonly discovered = signal<DiscoveredDevice[]>([]);
  readonly discovering = signal(false);
  readonly discoverNote = signal('Nothing found yet. The store box scans the network when it starts and every few minutes.');
  portTouched = false;

  readonly brandHelp = computed(() => {
    const b = this.v().brand;
    if (!b) return null;
    return this.brands().find((x) => x.brand === b)?.notes || BRAND_HELP[b] || null;
  });
  readonly preview = computed(() => {
    const v = this.v();
    if (!v.brand) return null;
    return previewUrl(v.brand, v.stream, this.brands(), { username: v.username, password: v.password, host: v.host, rtspPort: v.rtspPort, urlTemplate: v.urlTemplate, hasPassword: this.recorder()?.hasPassword });
  });
  /** Field errors: shown after the first submit, then live; server errors (409) on top. */
  readonly err = computed<Record<string, string>>(() => {
    const local = this.submitted() ? validateRecorder(this.v(), !this.recorder()) : {};
    return { ...local, ...this.serverField() };
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const r = this.recorder();
      const sid = this.storeId();
      untracked(() => {
        this.v.set(
          r
            ? { storeId: r.storeId, name: r.name, brand: r.brand, kind: r.kind, host: r.host, rtspPort: r.rtspPort, httpPort: r.httpPort, username: r.username, password: '', channels: r.channels, stream: r.stream, urlTemplate: r.urlTemplate }
            : blank(sid),
        );
        this.portTouched = !!r;
        this.submitted.set(false);
        this.saving.set(false);
        this.serverError.set(null);
        this.serverField.set({});
        this.showPass.set(false);
        this.loadDiscovered();
      });
    });
  }

  patch(p: Partial<RecorderFormValue>): void {
    this.v.update((v) => ({ ...v, ...p }));
    if (Object.keys(this.serverField()).length) this.serverField.set({});
    this.serverError.set(null);
  }

  setBrand(brand: RecorderBrand): void {
    const p: Partial<RecorderFormValue> = { brand };
    if (!this.portTouched) p.rtspPort = defaultPortFor(brand, this.brands());
    if (brand === 'CUSTOM' && !this.v().urlTemplate) p.urlTemplate = 'rtsp://{user}:{pass}@{host}:{port}/';
    if (!this.v().name.trim()) p.name = `${this.brands().find((b) => b.brand === brand)?.label.split(' /')[0] ?? 'Store'} ${this.v().kind}`;
    this.patch(p);
  }

  brandLabel(b: RecorderBrand | null): string {
    return b ? (this.brands().find((x) => x.brand === b)?.label ?? b) : 'Unknown brand';
  }

  loadDiscovered(): void {
    const sid = this.storeId();
    if (!sid) return;
    this.discovering.set(true);
    this.api.discovered(sid).subscribe({
      next: (d) => {
        this.discovered.set(d);
        this.discovering.set(false);
      },
      error: (e) => {
        this.discovered.set([]);
        this.discovering.set(false);
        this.discoverNote.set(httpStatus(e) === 404 ? 'Network discovery needs a backend update.' : 'Couldn’t load discovered devices.');
      },
    });
  }

  useDiscovered(d: DiscoveredDevice): void {
    const p: Partial<RecorderFormValue> = { host: d.host, rtspPort: d.rtspPort };
    if (d.httpPort) p.httpPort = d.httpPort;
    if (d.brandGuess && !this.v().brand) {
      this.setBrand(d.brandGuess);
      this.portTouched = true;
    }
    this.patch(p);
  }

  save(): void {
    if (this.saving()) return;
    this.submitted.set(true);
    const v = this.v();
    if (Object.keys(validateRecorder(v, !this.recorder())).length) return;
    const body: RecorderInput = {
      storeId: this.storeId(),
      name: v.name.trim(),
      kind: v.kind,
      brand: v.brand!,
      host: v.host.trim().replace(/^\[|\]$/g, ''),
      rtspPort: Number(v.rtspPort),
      httpPort: v.httpPort === null || v.httpPort === '' ? 80 : Number(v.httpPort),
      username: v.username.trim(),
      channels: Number(v.channels),
      stream: v.stream as RecorderStream,
      urlTemplate: v.brand === 'CUSTOM' ? (v.urlTemplate ?? '').trim() : null,
    };
    if (v.password) body.password = v.password;
    const r = this.recorder();
    this.saving.set(true);
    (r ? this.api.update(r.id, body) : this.api.create(body)).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(res);
      },
      error: (e) => {
        this.saving.set(false);
        const status = httpStatus(e);
        const msg = apiErrorText(e, 'The server rejected the recorder.');
        if (status === 409) this.serverField.set({ host: `This store already has a recorder at ${body.host}:${body.rtspPort}.` });
        else if (status === 404) this.serverError.set('Recorder support needs a backend update. Nothing was saved.');
        else if (status === 403) this.serverError.set('You do not have permission to change recorders for this store.');
        else this.serverError.set(status === 0 ? 'No connection. Check your network and try again.' : msg);
      },
    });
  }
}
