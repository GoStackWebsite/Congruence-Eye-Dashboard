import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CompleteTaskDialog } from './complete-task.dialog';

describe('CompleteTaskDialog', () => {
  it('uploads proof and closes with proof + remark', async () => {
    const close = vi.fn();
    TestBed.configureTestingModule({
      imports: [CompleteTaskDialog],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: MAT_DIALOG_DATA, useValue: { id: 1, title: 'Restock', proofUrl: null, remark: null } }, { provide: MatDialogRef, useValue: { close } }],
    });
    const f = TestBed.createComponent(CompleteTaskDialog);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="dialog-complete-task"]')).not.toBeNull();

    const input = el.querySelector('[data-testid="input-proof-file"]') as HTMLInputElement;
    const file = new File(['x'], 'proof.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    TestBed.inject(HttpTestingController).expectOne('/api/uploads').flush({ url: '/uploads/files/proof.jpg' });
    await f.whenStable();
    expect(el.querySelector('[data-testid="proof-preview"]')?.getAttribute('src')).toBe('/uploads/files/proof.jpg');

    f.componentInstance.remark = 'Shelf restocked';
    (el.querySelector('[data-testid="btn-complete-task"]') as HTMLButtonElement).click();
    expect(close).toHaveBeenCalledWith({ proofUrl: '/uploads/files/proof.jpg', remark: 'Shelf restocked' });
  });
});
