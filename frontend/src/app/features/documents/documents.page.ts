import { ChangeDetectionStrategy, Component, computed, effect, inject, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/auth/auth.service';
import { DOCUMENT_CATEGORIES, DocumentCategory, DocumentItem } from '../../core/models/api.models';
import { ApiService, saveBlob, silent } from '../../core/services/api.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { formatBytes } from '../../core/utils/format';
import { apiErrorText, httpStatus } from '../../core/utils/http-errors';
import { safeStorage } from '../../core/utils/storage';
import { CeColumn, DS, TabItem } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { FileRule, fileKind, opsLabel, storeDate, validateFile, withMobileLabels } from '../checklists/_ui/ops';
import { LIST_STYLES, OpsServiceStyles } from '../checklists/_ui/styles';

/** The documents endpoint accepts up to 50 MB per file (contract v4: 50 MB on every upload endpoint). */
export const DOC_RULE: FileRule = {
  maxBytes: 50 * 1024 * 1024,
  accept: [
    'application/pdf',
    'image/',
    'video/mp4',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  label: 'Upload a PDF, Word, Excel, PowerPoint, image, MP4 or text file.',
};

const CATEGORY_ICON: Record<string, string> = { SOP: 'menu_book', CIRCULAR: 'campaign', PLANOGRAM: 'view_quilt', TRAINING: 'school', OTHER: 'folder' };

/** Upload side panel with drag & drop (keeps the `dialog-document` testids). */
@Component({
  selector: 'ce-document-upload-drawer',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, MatProgressSpinnerModule, ...DS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-drawer [(open)]="open" title="Upload document" subtitle="SOPs, circulars, planograms and training material" testId="dialog-document">
      @if (open()) {
        <div class="stack" style="gap: 16px">
          <input #fileInput type="file" hidden (change)="pick(fileInput.files?.[0] ?? null); fileInput.value = ''" data-testid="input-file" />
          @if (file(); as f) {
            <div class="ops-file-row">
              <span class="ops-icon-tile" [class]="'ops-icon-tile tone-' + kind().tone"><span class="material-symbols-outlined">{{ kind().icon }}</span></span>
              <div class="meta">
                <div class="strong ellipsis" [title]="f.name">{{ f.name }}</div>
                <div class="caption">{{ size() }} · {{ kind().label }}</div>
              </div>
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="fileInput.click()" data-testid="btn-choose-file">Change</button>
            </div>
          } @else {
            <button
              type="button"
              class="ops-drop"
              [class.over]="over()"
              [class.invalid]="!!fileError()"
              (click)="fileInput.click()"
              (dragover)="$event.preventDefault(); over.set(true)"
              (dragleave)="over.set(false)"
              (drop)="onDrop($event)"
              data-testid="btn-choose-file"
              style="font: inherit; width: 100%"
            >
              <span class="material-symbols-outlined">upload_file</span>
              <span class="t">Drag a file here or click to browse</span>
              <span class="s">PDF, Office, image, MP4 or text · up to 50 MB</span>
            </button>
          }
          @if (fileError()) {
            <div class="ops-err" role="alert" data-testid="document-file-error"><span class="material-symbols-outlined">error</span>{{ fileError() }}</div>
          }
          <div>
            <label class="ce-field-label" for="doc-title">Title *</label>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
              <input id="doc-title" matInput [(ngModel)]="title" maxlength="200" placeholder="e.g. Store opening SOP v3" data-testid="input-title" />
            </mat-form-field>
            @if (submitted() && !title.trim()) {
              <div class="ops-err"><span class="material-symbols-outlined">error</span>Give the document a title</div>
            }
          </div>
          <div class="ops-form">
            <div>
              <label class="ce-field-label">Category</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <mat-select [(ngModel)]="category" data-testid="input-category" aria-label="Category">
                  @for (c of categories; track c) {
                    <mat-option [value]="c">{{ label(c) }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            <div>
              <label class="ce-field-label">Visible to</label>
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                <mat-select [(ngModel)]="storeId" placeholder="All stores" data-testid="input-storeId" aria-label="Store">
                  <mat-option [value]="null">All stores</mat-option>
                  @for (s of lookup.scopedStores(); track s.id) {
                    <mat-option [value]="s.id">{{ s.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
          </div>
        </div>
      }
      <ng-container drawerFooter>
        <button type="button" class="ce-btn ce-btn-ghost" (click)="open.set(false)" data-testid="btn-cancel">Cancel</button>
        <button type="button" class="ce-btn ce-btn-primary" (click)="save()" [disabled]="saving()" data-testid="btn-save">
          @if (saving()) {
            <mat-spinner diameter="16" />
          } @else {
            <mat-icon>upload</mat-icon>
          }
          Upload
        </button>
      </ng-container>
    </ce-drawer>
  `,
})
export class DocumentUploadDrawer {
  protected readonly lookup = inject(LookupService);
  private readonly api = inject(ApiService);
  readonly open = model(false);
  readonly uploaded = output<DocumentItem>();
  readonly categories = DOCUMENT_CATEGORIES;
  readonly file = signal<File | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly over = signal(false);
  readonly size = computed(() => formatBytes(this.file()?.size));
  readonly kind = computed(() => fileKind(this.file()?.type, this.file()?.name));
  title = '';
  category: DocumentCategory = 'SOP';
  storeId: number | null = null;

  constructor() {
    effect(() => {
      if (!this.open()) return;
      this.file.set(null);
      this.fileError.set(null);
      this.submitted.set(false);
      this.saving.set(false);
      this.title = '';
      this.category = 'SOP';
      this.storeId = null;
    });
  }

  label(c: string): string {
    return opsLabel(c);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.over.set(false);
    this.pick(e.dataTransfer?.files?.[0] ?? null);
  }

  pick(f: File | null): void {
    if (!f) return;
    const err = validateFile(f, DOC_RULE);
    this.fileError.set(err);
    if (err) return;
    this.file.set(f);
    if (!this.title.trim()) this.title = f.name.replace(/\.[^.]+$/, '');
  }

  save(): void {
    if (this.saving()) return;
    this.submitted.set(true);
    if (!this.file()) this.fileError.set(this.fileError() ?? 'Choose a file to upload');
    if (!this.file() || !this.title.trim()) return;
    const fd = new FormData();
    fd.append('file', this.file()!, this.file()!.name);
    fd.append('title', this.title.trim());
    fd.append('category', this.category);
    if (this.storeId) fd.append('storeId', String(this.storeId));
    this.saving.set(true);
    this.api.upload<DocumentItem>('/documents', fd, silent()).subscribe({
      next: (d) => {
        this.saving.set(false);
        this.open.set(false);
        this.uploaded.emit(d);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        // the server checks the real file type (magic number) and size: say why, next to the file
        const st = httpStatus(e);
        this.fileError.set(st === 413 ? 'File is too large. The limit is 50 MB.' : st === 0 ? 'No connection. Check your network and try again.' : apiErrorText(e, 'The server did not accept this file.'));
      },
    });
  }
}

/** Store Ops › Documents: library of SOPs, circulars, planograms and training material (grid or list). */
@Component({
  selector: 'ce-documents-page',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule, MatIconModule, MatTooltipModule, ...DS, ...LIST_STYLES, OpsServiceStyles, DocumentUploadDrawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ce-ops-base-styles /><ce-ops-mobile-styles /><ce-ops-service-styles />
    <section class="ops-page" data-testid="page-documents">
      <ce-page title="Documents" description="SOPs, circulars, planograms and training material for your stores">
        <ng-container pageActions>
          <ce-segmented [options]="viewOptions" [value]="view()" (valueChange)="setView($any($event))" label="View" data-testid="toggle-doc-view" />
          @if (canUpload()) {
            <button type="button" class="ce-btn ce-btn-primary" (click)="uploadOpen.set(true)" data-testid="btn-upload-document"><mat-icon>upload_file</mat-icon> Upload</button>
          }
        </ng-container>

        <div class="ops-chips" role="group" aria-label="Category" data-testid="filter-document-category">
          <button type="button" class="ops-chip" [class.active]="!category()" (click)="category.set(null)" data-testid="doc-cat-all">All <span class="n">{{ total() }}</span></button>
          @for (c of categories; track c) {
            <button type="button" class="ops-chip" [class.active]="category() === c" (click)="category.set(category() === c ? null : c)" [attr.aria-pressed]="category() === c" [attr.data-testid]="'doc-cat-' + c">
              <span class="material-symbols-outlined">{{ catIcon[c] }}</span>{{ label(c) }}
            </button>
          }
        </div>

        <div class="ops-toolbar">
          <label class="ce-search">
            <mat-icon aria-hidden="true">search</mat-icon>
            <input type="search" placeholder="Search title or file name" [ngModel]="search()" (ngModelChange)="search.set($event)" aria-label="Search documents" data-testid="input-search" />
          </label>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="ops-filter wide">
            <mat-select [ngModel]="storeId()" (ngModelChange)="storeId.set($event)" placeholder="All stores" data-testid="filter-document-store" aria-label="Store">
              <mat-option [value]="null">All stores</mat-option>
              @for (s of lookup.scopedStores(); track s.id) {
                <mat-option [value]="s.id">{{ s.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          @if (filtered()) {
            <button type="button" class="ce-link-btn" (click)="clearFilters()" data-testid="btn-clear-filters">Clear filters</button>
          }
          <span class="spacer"></span>
          <span class="caption">{{ rows().length }} document{{ rows().length === 1 ? '' : 's' }}</span>
        </div>

        @if (data.error() && !data.data()) {
          <div class="ops-card">
            <ce-empty-state kind="error" [message]="data.error()"><button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button></ce-empty-state>
          </div>
        } @else if (view() === 'grid') {
          @if (busy()) {
            <div class="doc-grid" aria-busy="true">
              @for (i of [1, 2, 3, 4, 5, 6, 7, 8]; track i) {
                <div class="doc-card"><ce-skeleton kind="text" [count]="3" /></div>
              }
            </div>
          } @else if (!rows().length) {
            <div class="ops-card">
              @if (filtered()) {
                <ce-empty-state kind="filtered" title="No documents match these filters" message="Try another category, store or search.">
                  <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="clearFilters()">Clear filters</button>
                </ce-empty-state>
              } @else {
                <ce-empty-state icon="folder_open" title="No documents yet" [message]="canUpload() ? 'Upload SOPs, circulars and planograms so every store works from the same playbook.' : 'Documents shared by your managers will show here.'">
                  @if (canUpload()) {
                    <button type="button" class="ce-btn ce-btn-primary ce-btn-sm" (click)="uploadOpen.set(true)">Upload a document</button>
                  }
                </ce-empty-state>
              }
            </div>
          } @else {
            <div class="doc-grid" data-testid="document-grid">
              @for (d of rows(); track d.id) {
                @let k = kind(d);
                <article class="doc-card" [attr.data-testid]="'row-document-' + d.id">
                  <div class="top">
                    <span class="ops-icon-tile lg" [class]="'ops-icon-tile lg tone-' + k.tone" [attr.aria-label]="k.label"><span class="material-symbols-outlined">{{ k.icon }}</span></span>
                    <div class="ttl">
                      <div class="t" [title]="d.title">{{ d.title }}</div>
                      <div class="f" [title]="d.fileName">{{ d.fileName }} · {{ bytes(d.size) }}</div>
                    </div>
                  </div>
                  <div class="tags">
                    <span class="doc-tag">{{ label(d.category) }}</span>
                    <span class="doc-tag" [title]="d.storeName ?? 'All stores'">{{ d.storeName ?? 'All stores' }}</span>
                  </div>
                  <div class="foot">
                    <ce-avatar [name]="d.uploadedByName" [size]="20" />
                    <span class="grow" [title]="d.uploadedByName + ' · ' + date(d.createdAt)">{{ date(d.createdAt) }}</span>
                    <button type="button" class="ce-icon-btn sm" matTooltip="Download" aria-label="Download" (click)="download(d)" [disabled]="downloading() === d.id" data-testid="btn-download"><mat-icon>download</mat-icon></button>
                    @if (canUpload()) {
                      <button type="button" class="ce-icon-btn sm" matTooltip="Delete" aria-label="Delete" (click)="remove(d)" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
                    }
                  </div>
                </article>
              }
            </div>
          }
        } @else {
          <div class="ops-card">
            <ce-table
              [rows]="rows()"
              [columns]="cols"
              [loading]="busy()"
              title="Document library"
              testId="table-documents"
              [rowTestId]="rowId"
              [bare]="true"
              [defaultSort]="{ key: 'createdAt', dir: 'desc' }"
              emptyIcon="folder_open"
              [emptyTitle]="filtered() ? 'No documents match these filters' : 'No documents yet'"
              [emptyMessage]="filtered() ? 'Try another category, store or search.' : 'Upload SOPs, circulars and planograms.'"
            >
              <ng-template ceCell="title" let-d>
                @let k = kind(d);
                <span class="ops-with-icon" style="max-width: 420px">
                  <span class="ops-icon-tile" [class]="'ops-icon-tile tone-' + k.tone"><span class="material-symbols-outlined">{{ k.icon }}</span></span>
                  <span class="ops-cell-title" [title]="d.title + ' — ' + d.fileName">
                    <span class="t">{{ d.title }}</span>
                    <span class="s">{{ d.fileName }} · {{ bytes(d.size) }}</span>
                  </span>
                </span>
              </ng-template>
              <ng-template ceCell="action" let-d>
                <span class="ops-row-actions">
                  <button type="button" class="ce-icon-btn sm" matTooltip="Download" aria-label="Download" (click)="download(d)" [disabled]="downloading() === d.id" data-testid="btn-download"><mat-icon>download</mat-icon></button>
                  @if (canUpload()) {
                    <button type="button" class="ce-icon-btn sm" matTooltip="Delete" aria-label="Delete" (click)="remove(d)" data-testid="btn-delete"><mat-icon>delete</mat-icon></button>
                  }
                </span>
              </ng-template>
            </ce-table>
          </div>
        }
      </ce-page>
    </section>
    <ce-document-upload-drawer [(open)]="uploadOpen" (uploaded)="onUploaded()" />
  `,
})
export class DocumentsPage {
  protected readonly auth = inject(AuthService);
  protected readonly lookup = inject(LookupService);
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  readonly categories = DOCUMENT_CATEGORIES;
  readonly catIcon = CATEGORY_ICON;
  readonly viewOptions: TabItem[] = [
    { value: 'grid', label: 'Grid', testId: 'view-grid' },
    { value: 'list', label: 'List', testId: 'view-list' },
  ];
  readonly view = signal<'grid' | 'list'>(safeStorage.getString('ce.documents.view') === 'list' ? 'list' : 'grid');
  readonly search = signal('');
  readonly category = signal<string | null>(null);
  readonly storeId = signal<number | null>(null);
  readonly uploadOpen = signal(false);
  readonly downloading = signal<number | null>(null);
  readonly canUpload = computed(() => this.auth.can('uploadDocuments'));

  // the category filter is applied client-side so the chips can show counts
  readonly data = loadOn(
    () => ({ storeId: this.storeId() }),
    (q) => this.api.get<DocumentItem[]>('/documents', q),
  );
  readonly busy = computed(() => this.data.loading() && !this.data.data());
  readonly total = computed(() => (this.data.data() ?? []).length);
  readonly filtered = computed(() => !!this.search().trim() || !!this.category() || !!this.storeId());
  readonly rows = computed(() => {
    const s = this.search().toLowerCase().trim();
    const c = this.category();
    return [...(this.data.data() ?? [])]
      .filter((d) => (!c || d.category === c) && (!s || `${d.title} ${d.fileName}`.toLowerCase().includes(s)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  readonly rowId = (d: DocumentItem) => `row-document-${d.id}`;
  readonly cols: CeColumn<DocumentItem>[] = withMobileLabels<DocumentItem>(
    [
      { key: 'title', header: 'Document', type: 'custom', sortable: true, locked: true },
      { key: 'category', header: 'Category', sortable: true, format: (v) => opsLabel(String(v)) },
      { key: 'storeName', header: 'Visible to', sortable: true, format: (v) => (v ? String(v) : 'All stores') },
      { key: 'uploadedByName', header: 'Uploaded by', type: 'avatar', sortable: true },
      { key: 'createdAt', header: 'Uploaded on', sortable: true, format: (v) => storeDate(String(v ?? '')) },
      { key: 'action', header: 'Action', type: 'actions', align: 'right', locked: true, value: () => '' },
    ],
    ['uploadedByName'],
  );

  constructor() {
    this.lookup.loadStores().subscribe();
  }

  label(c: string): string {
    return opsLabel(c);
  }
  kind(d: DocumentItem) {
    return fileKind(d.mimeType, d.fileName);
  }
  bytes(n: number): string {
    return formatBytes(n);
  }
  date(iso: string): string {
    return storeDate(iso);
  }
  setView(v: 'grid' | 'list'): void {
    this.view.set(v);
    safeStorage.set('ce.documents.view', v);
  }
  clearFilters(): void {
    this.search.set('');
    this.category.set(null);
    this.storeId.set(null);
  }
  onUploaded(): void {
    this.ui.toast('Document uploaded');
    this.data.reload();
  }

  download(d: DocumentItem): void {
    this.downloading.set(d.id);
    this.api.download(`/documents/${d.id}/download`, null, d.fileName).subscribe({
      next: (f) => {
        this.downloading.set(null);
        saveBlob(f.blob, f.filename || d.fileName);
      },
      error: () => this.downloading.set(null),
    });
  }

  remove(d: DocumentItem): void {
    this.ui.confirm({ title: 'Delete document?', message: `Delete "${d.title}"? Stores will no longer see it.`, confirmText: 'Delete', danger: true }).subscribe(() =>
      this.api.delete(`/documents/${d.id}`).subscribe(() => {
        this.ui.toast('Document deleted');
        this.data.reload();
      }),
    );
  }
}
