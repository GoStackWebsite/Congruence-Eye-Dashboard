import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EdgeDevice } from '../../core/models/api.models';
import { ApiService, saveBlob, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { CeColumn, DS } from '../../shared/ds';
import { DateTimePipe } from '../../shared/pipes';
import { UiService } from '../../shared/ui/ui.service';
import { AdminField, EntityDrawerComponent } from '../../shared/ds/entity-drawer.component';
import { isoDay, useOpsStyles } from '../../shared/ds/ops.styles';
import { StoreChipFilterComponent } from '../../shared/ds/store-chip-filter.component';

/** Shows a freshly issued API key exactly once in a secure copy panel. */
@Component({
  selector: 'ce-api-key-dialog',
  imports: [MatDialogModule, MatIconModule, ...DS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <h2 mat-dialog-title>API key for {{ data.name }}</h2>
    <mat-dialog-content data-testid="dialog-api-key">
      <div class="ops-key-panel">
        <ce-info-banner tone="warning" title="Copy this key now">It is shown only once. The server keeps just its first characters, so a lost key has to be rotated.</ce-info-banner>
        <div class="ops-key-box">
          <span class="material-symbols-outlined ops-muted" aria-hidden="true">key</span>
          <code class="ops-mono" data-testid="api-key-value">{{ data.apiKey }}</code>
          <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="copy()" [attr.aria-label]="copied() ? 'Copied' : 'Copy API key'" data-testid="btn-copy-api-key">
            <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon> {{ copied() ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <ol class="ops-key-steps">
          <li>On the store PC, open the AI box settings file (<code>.env</code>).</li>
          <li>Set <code>EDGE_API_KEY</code> to this key and restart the AI service.</li>
          <li>The device turns <b>Online</b> here within a minute (sent as the <code>X-Api-Key</code> header).</li>
        </ol>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button type="button" class="ce-btn ce-btn-ghost" (click)="download()" data-testid="btn-download-env"><mat-icon>download</mat-icon> Download .env line</button>
      <button type="button" class="ce-btn ce-btn-primary" mat-dialog-close data-testid="btn-done">I've copied it</button>
    </mat-dialog-actions>
  `,
})
export class ApiKeyDialogComponent {
  protected readonly opsCss = useOpsStyles();
  readonly data = inject<{ name: string; apiKey: string }>(MAT_DIALOG_DATA);
  private readonly clipboard = inject(Clipboard);
  readonly copied = signal(false);
  copy(): void {
    this.copied.set(this.clipboard.copy(this.data.apiKey));
  }
  download(): void {
    saveBlob(new Blob([`EDGE_API_KEY=${this.data.apiKey}\n`], { type: 'text/plain' }), `${this.data.name || 'edge'}.env`);
  }
}

export function deviceHealth(d: Pick<EdgeDevice, 'lastSeenAt'>, now = Date.now()): 'ONLINE' | 'OFFLINE' | 'UNKNOWN' {
  if (!d.lastSeenAt) return 'UNKNOWN';
  return now - new Date(d.lastSeenAt).getTime() <= 5 * 60_000 ? 'ONLINE' : 'OFFLINE';
}

/** Edge device list with create / rotate key / delete (used by the Edge devices page and the store's Edge tab). */
@Component({
  selector: 'ce-edge-device-list',
  imports: [MatIconModule, MatTooltipModule, MatDialogModule, ...DS, EntityDrawerComponent, DateTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (data.error() && !data.data()) {
      <ce-card>
        <ce-empty-state kind="error" [message]="data.error()">
          <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
        </ce-empty-state>
      </ce-card>
    } @else {
      <ce-table
        [rows]="rows()"
        [columns]="cols()"
        [loading]="data.loading() && !data.data()"
        [title]="fixedStoreId() ? 'Edge device' : 'Devices'"
        subtitle="Online = reported within the last 5 minutes"
        [searchable]="!fixedStoreId()"
        searchPlaceholder="Search devices"
        searchTestId="input-search-devices"
        testId="table-admin-edge-devices"
        [rowTestId]="rowId"
        [paginate]="false"
        emptyIcon="router"
        [emptyTitle]="fixedStoreId() ? 'No AI box for this store yet' : 'No edge devices'"
        emptyMessage="Create a device to get the API key for the store's AI box."
      >
        <ng-container ngProjectAs="[tableFilters]"><ng-content select="[listFilters]" /></ng-container>
        <button tableActions type="button" class="ce-btn ce-btn-primary" (click)="formOpen.set(true)" data-testid="btn-create-edge-device"><mat-icon>add</mat-icon> New device</button>
        <ng-template ceCell="name" let-d>
          <div class="ops-user-text">
            <span class="ops-strong ops-ellipsis" [title]="d.name">{{ d.name }}</span>
            <span class="caption">{{ d.version ? 'Version ' + d.version : 'Version not reported' }}</span>
          </div>
        </ng-template>
        <ng-template ceCell="key" let-d><span class="ops-mono">{{ d.apiKeyPrefix }}…</span></ng-template>
        <ng-template ceCell="health" let-d>
          <span class="ops-row" style="flex-wrap: nowrap; gap: 8px">
            <ce-pill [value]="health(d)" size="sm" />
            <span class="caption" [title]="d.lastSeenAt ? (d.lastSeenAt | dt) : ''">{{ d.lastSeenAt ? (d.lastSeenAt | dt: 'relative') : 'Never connected' }}</span>
          </span>
        </ng-template>
        <ng-template ceCell="actions" let-d>
          <span class="ops-row-actions">
            <button type="button" class="ce-icon-btn sm" matTooltip="Rotate key" aria-label="Rotate key" (click)="rotate(d)" data-testid="btn-rotate-key"><mat-icon>key</mat-icon></button>
            <button type="button" class="ce-icon-btn sm" matTooltip="Delete" aria-label="Delete device" (click)="remove(d)" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
          </span>
        </ng-template>
      </ce-table>
    }

    <ce-entity-drawer
      [(open)]="formOpen"
      entity="edge-device"
      title="New edge device"
      subtitle="The API key is shown once after saving"
      [fields]="fields"
      [value]="{ storeId: storeFilter() }"
      [submit]="submit"
      submitLabel="Create and show key"
      (saved)="created($any($event))"
    />
  `,
})
export class EdgeDeviceListComponent {
  protected readonly opsCss = useOpsStyles();
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  private readonly dialog = inject(MatDialog);
  private readonly lookup = inject(LookupService);
  /** Store tab: the list is limited to this store. */
  readonly fixedStoreId = input<number | null>(null);
  /** Page: optional store filter. */
  readonly storeId = input<number | null>(null);
  readonly storeFilter = computed(() => this.fixedStoreId() ?? this.storeId());
  readonly formOpen = signal(false);
  readonly data = loadOn(() => ({ storeId: this.storeFilter() }), (q) => this.api.get<EdgeDevice[]>('/edge-devices', q));
  readonly rows = computed(() => this.data.data() ?? []);
  readonly rowId = (d: EdgeDevice) => `row-edge-device-${d.id}`;
  readonly storeName = computed(() => this.lookup.storeName());

  readonly cols = computed<CeColumn<EdgeDevice>[]>(() => [
    { key: 'name', header: 'Device', sortable: true, locked: true },
    ...(this.fixedStoreId() ? [] : [{ key: 'store', header: 'Store', value: (d: EdgeDevice) => this.storeName()(d.storeId), sortable: true } as CeColumn<EdgeDevice>]),
    { key: 'key', header: 'Key prefix', value: (d) => d.apiKeyPrefix },
    { key: 'health', header: 'Status', value: (d) => deviceHealth(d), sortable: true },
    { key: 'createdAt', header: 'Created', format: (v) => isoDay(v), sortable: true },
    { key: 'actions', header: 'Action', type: 'actions', value: () => '', align: 'right', locked: true },
  ]);

  readonly fields: AdminField[] = [
    { key: 'name', label: 'Device name', type: 'text', required: true, placeholder: 'tnagar-edge-01', full: true, validate: (v) => (/^[\w .-]{3,60}$/.test(String(v ?? '').trim()) ? null : 'Use 3–60 letters, digits, spaces, dots or dashes') },
    { key: 'storeId', label: 'Store', type: 'select', required: true, full: true, options: () => this.lookup.stores().map((s) => ({ value: s.id, label: s.name })) },
  ];

  readonly submit = (v: Record<string, unknown>) => this.api.post<EdgeDevice>('/edge-devices', v, null, silent());

  constructor() {
    this.lookup.loadStores().subscribe();
  }

  health(d: EdgeDevice) {
    return deviceHealth(d);
  }

  private showKey(name: string, apiKey: string | undefined): void {
    if (!apiKey) {
      this.ui.toast('Device saved, but the server did not return an API key');
      return;
    }
    this.dialog.open(ApiKeyDialogComponent, { data: { name, apiKey }, width: '560px', maxWidth: '96vw', disableClose: true });
  }

  created(d: EdgeDevice): void {
    this.data.reload();
    this.showKey(d.name, d.apiKey);
  }

  rotate(d: EdgeDevice): void {
    this.ui
      .confirm({ title: 'Rotate API key?', message: `The current key for "${d.name}" stops working immediately. The store's AI box is offline until the new key is installed.`, confirmText: 'Rotate', danger: true })
      .subscribe(() =>
        this.api.post<{ apiKey: string }>(`/edge-devices/${d.id}/rotate-key`).subscribe((r) => {
          this.data.reload();
          this.showKey(d.name, r.apiKey);
        }),
      );
  }

  remove(d: EdgeDevice): void {
    this.ui.confirm({ title: 'Delete device?', message: `Delete "${d.name}"? Its API key stops working and the store stops sending data.`, confirmText: 'Delete', danger: true }).subscribe(() =>
      this.api.delete(`/edge-devices/${d.id}`).subscribe(() => {
        this.ui.toast('Device deleted');
        this.data.reload();
      }),
    );
  }
}

/** Admin › Edge devices: per-store AI boxes that push events with an API key. */
@Component({
  selector: 'ce-edge-devices-page',
  imports: [...DS, EdgeDeviceListComponent, StoreChipFilterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-admin-edge-devices">
      <ce-page title="Edge devices" description="Per-store AI boxes that read the cameras and push events with an API key">
        <ce-edge-device-list [storeId]="storeId()">
          <div listFilters style="margin-top: 8px">
            <ce-store-chip-filter [(value)]="storeId" testId="filter-device-store" />
          </div>
        </ce-edge-device-list>
      </ce-page>
    </section>
  `,
})
export class EdgeDevicesPage {
  readonly storeId = signal<number | null>(null);
}
