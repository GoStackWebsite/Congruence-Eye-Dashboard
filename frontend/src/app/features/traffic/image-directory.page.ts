import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { catchError, of } from 'rxjs';
import { Camera, SNAPSHOT_KINDS, SnapshotImage } from '../../core/models/api.models';
import { FilterService } from '../../core/services/filter.service';
import { LookupService } from '../../core/services/lookup.service';
import { loadOn } from '../../core/services/loader';
import { V2Api } from '../../core/services/v2.api';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DS } from '../../shared/ds';
import { PillComponent } from '../../shared/ds/pill.component';
import { DateTimePipe, HumanizePipe } from '../../shared/pipes';

interface LightboxData {
  items: SnapshotImage[];
  index: number;
}

@Component({
  selector: 'ce-image-lightbox',
  imports: [MatDialogModule, MatIconModule, MatTooltipModule, DateTimePipe, HumanizePipe, PillComponent],
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    <div class="lightbox" data-testid="dialog-lightbox">
      @let img = current();
      <div class="lb-stage">
        <img [src]="img.url" [alt]="img.storeName + ' · ' + img.cameraName" data-testid="lightbox-image" />
        <button type="button" class="lb-nav l" (click)="move(-1)" [disabled]="index() === 0" aria-label="Previous image" data-testid="btn-lightbox-prev"><mat-icon>chevron_left</mat-icon></button>
        <button type="button" class="lb-nav r" (click)="move(1)" [disabled]="index() === data.items.length - 1" aria-label="Next image" data-testid="btn-lightbox-next"><mat-icon>chevron_right</mat-icon></button>
        <span class="lb-count">{{ index() + 1 }} / {{ data.items.length }}</span>
      </div>
      <aside class="lb-meta" aria-label="Image details">
        <div class="lb-head">
          <div class="ce-card-title">Snapshot</div>
          <button type="button" class="ce-icon-btn sm" mat-dialog-close aria-label="Close" data-testid="btn-lightbox-close"><mat-icon>close</mat-icon></button>
        </div>
        <dl>
          <dt>Store</dt>
          <dd>{{ img.storeName }}</dd>
          <dt>Camera</dt>
          <dd>{{ img.cameraName }}</dd>
          <dt>Captured</dt>
          <dd>{{ img.ts | dt }} <span class="caption">store time</span></dd>
          <dt>Kind</dt>
          <dd><ce-pill tone="info" [label]="img.kind | humanize" size="sm" /></dd>
          <dt>Image id</dt>
          <dd class="mono">#{{ img.id }}</dd>
        </dl>
        <a class="ce-btn ce-btn-secondary lb-dl" [href]="img.url" target="_blank" rel="noopener" [attr.download]="'snapshot-' + img.id + '.jpg'" data-testid="btn-lightbox-download"><mat-icon>download</mat-icon> Download</a>
        <div class="caption">Use ← → to move between images.</div>
      </aside>
    </div>
  `,
})
export class ImageLightboxComponent {
  readonly data = inject<LightboxData>(MAT_DIALOG_DATA);
  readonly index = signal(this.data.index);
  readonly current = computed(() => this.data.items[this.index()]);
  move(d: number): void {
    this.index.update((i) => Math.min(this.data.items.length - 1, Math.max(0, i + d)));
  }
  onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowRight') this.move(1);
    if (e.key === 'ArrowLeft') this.move(-1);
  }
}

/** Traffic › Media › Image directory: snapshot evidence gallery for self-audit (Tango "Image Directory"). */
@Component({
  selector: 'ce-image-directory-page',
  imports: [FormsModule, MatFormFieldModule, MatSelectModule, MatPaginatorModule, MatIconModule, ...DS, DateTimePipe, HumanizePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-testid="page-image-directory">
      <ce-page title="Image directory" description="Camera snapshots for self-audit — filter by store (top bar), camera, kind and date" [lastRefreshed]="true">
        <ce-card [flush]="true">
          <div class="gal-toolbar">
            <mat-form-field subscriptSizing="dynamic" style="width: 230px">
              <mat-label>Camera</mat-label>
              <mat-select [ngModel]="cameraId()" (ngModelChange)="setFilter(cameraId, $event)" [disabled]="!singleStore()" data-testid="filter-image-camera">
                <mat-option [value]="null">All cameras</mat-option>
                @for (c of cameras(); track c.id) {
                  <mat-option [value]="c.id">{{ c.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field subscriptSizing="dynamic" style="width: 170px">
              <mat-label>Kind</mat-label>
              <mat-select [ngModel]="kind()" (ngModelChange)="setFilter(kind, $event)" data-testid="filter-image-kind">
                <mat-option [value]="null">All kinds</mat-option>
                @for (k of kinds; track k) {
                  <mat-option [value]="k">{{ k | humanize }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            @if (!singleStore()) {
              <span class="caption gal-hint"><mat-icon>info</mat-icon> Select one store in the top bar to filter by camera</span>
            }
            <span class="spacer"></span>
            <span class="ce-count-badge" data-testid="image-total">{{ data.data()?.total ?? 0 }} images</span>
          </div>
          @if (data.error() && !data.data()) {
            <ce-empty-state kind="error" [message]="data.error()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="data.reload()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          }
          <div class="gallery" data-testid="image-gallery">
            @for (img of items(); track img.id; let i = $index) {
              <button type="button" class="gallery-item" (click)="open(i)" [attr.data-testid]="'image-item-' + img.id" [attr.aria-label]="'Open ' + img.cameraName + ', ' + img.storeName">
                <span class="gi-media">
                  <img [src]="img.url" [alt]="img.storeName + ' ' + img.cameraName + ' ' + img.ts" loading="lazy" />
                  <span class="gi-ts">{{ img.ts | dt }}</span>
                  <span class="gi-kind">{{ img.kind | humanize }}</span>
                </span>
                <span class="gi-meta">
                  <span class="gi-cam ellipsis" [title]="img.cameraName">{{ img.cameraName }}</span>
                  <span class="gi-store ellipsis" [title]="img.storeName">{{ img.storeName }}</span>
                </span>
              </button>
            } @empty {
              @if (data.loading()) {
                @for (i of skeleton; track i) {
                  <span class="gallery-skel"><span class="ce-skel"></span><span class="ce-skel" style="width: 60%"></span></span>
                }
              }
            }
          </div>
          @if (data.loaded() && !items().length && !data.error()) {
            <ce-empty-state kind="filtered" icon="hide_image" title="No images for these filters" message="Snapshots appear as cameras capture them; try another day, camera or kind." />
          }
          <mat-paginator
            [length]="data.data()?.total ?? 0"
            [pageIndex]="page() - 1"
            [pageSize]="pageSize()"
            [pageSizeOptions]="[24, 48, 96]"
            (page)="onPage($event)"
            showFirstLastButtons
            data-testid="paginator-images"
          />
        </ce-card>
      </ce-page>
    </section>
  `,
})
export class ImageDirectoryPage {
  private readonly v2 = inject(V2Api);
  private readonly filter = inject(FilterService);
  private readonly lookup = inject(LookupService);
  private readonly dialog = inject(MatDialog);
  readonly kinds = SNAPSHOT_KINDS;
  readonly skeleton = Array.from({ length: 12 }, (_, i) => i);
  readonly cameraId = signal<number | null>(null);
  readonly kind = signal<string | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(24);
  readonly cameras = signal<Camera[]>([]);
  readonly singleStore = computed(() => (this.filter.selectedStoreIds().length === 1 ? this.filter.selectedStoreIds()[0] : null));

  readonly data = loadOn(
    () => ({ ...this.filter.params(), cameraId: this.singleStore() ? this.cameraId() : null, kind: this.kind(), page: this.page(), pageSize: this.pageSize() }),
    (q) => this.v2.imageDirectory(q),
  );
  readonly items = computed(() => this.data.data()?.items ?? []);

  constructor() {
    effect((onCleanup) => {
      const s = this.singleStore();
      this.cameras.set([]);
      if (!s) return;
      const sub = this.lookup
        .cameras(s)
        .pipe(catchError(() => of([] as Camera[])))
        .subscribe((c) => this.cameras.set(c));
      onCleanup(() => sub.unsubscribe());
    });
    // a filter change returns to page 1
    effect(() => {
      this.filter.params();
      this.page.set(1);
    });
  }

  setFilter<T>(sig: { set(v: T): void }, v: T): void {
    sig.set(v);
    this.page.set(1);
  }

  onPage(e: PageEvent): void {
    this.page.set(e.pageIndex + 1);
    this.pageSize.set(e.pageSize);
  }

  open(index: number): void {
    this.dialog.open(ImageLightboxComponent, { data: { items: this.items(), index }, width: '1180px', maxWidth: '96vw', panelClass: 'lightbox-panel' });
  }
}
