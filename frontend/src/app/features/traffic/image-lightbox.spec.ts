import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ImageLightboxComponent } from './image-directory.page';

describe('ImageLightboxComponent', () => {
  it('navigates with buttons and arrow keys within bounds', async () => {
    const items = [1, 2, 3].map((id) => ({ id, storeId: 1, storeName: 'TNR', cameraId: 1, cameraName: 'Entrance', ts: '2026-10-05T10:00:00Z', kind: 'PERIODIC' as const, url: `/uploads/${id}.jpg` }));
    TestBed.configureTestingModule({ imports: [ImageLightboxComponent], providers: [{ provide: MAT_DIALOG_DATA, useValue: { items, index: 0 } }] });
    const f = TestBed.createComponent(ImageLightboxComponent);
    await f.whenStable();
    const img = () => (f.nativeElement as HTMLElement).querySelector('[data-testid="lightbox-image"]')!.getAttribute('src');
    expect(img()).toBe('/uploads/1.jpg');
    f.componentInstance.move(-1);
    await f.whenStable();
    expect(img()).toBe('/uploads/1.jpg');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await f.whenStable();
    expect(img()).toBe('/uploads/2.jpg');
    f.componentInstance.move(5);
    await f.whenStable();
    expect(img()).toBe('/uploads/3.jpg');
  });
});
