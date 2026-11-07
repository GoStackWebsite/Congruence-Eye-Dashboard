import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { safeStorage } from '../utils/storage';

export type ThemeMode = 'light' | 'dark';
const KEY = 'ce.theme';

function systemPrefersDark(): boolean {
  try {
    return !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function storedMode(): ThemeMode | null {
  const raw = safeStorage.getString(KEY);
  return raw === 'dark' || raw === 'light' ? raw : null;
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  // safeStorage.set() stores strings raw, so read the raw string back (get() would JSON-parse and fail)
  readonly mode = signal<ThemeMode>(storedMode() ?? (systemPrefersDark() ? 'dark' : 'light'));
  readonly isDark = computed(() => this.mode() === 'dark');

  constructor() {
    effect(() => {
      const mode = this.mode();
      const root = this.doc.documentElement;
      root.classList.toggle('dark-theme', mode === 'dark');
      root.classList.toggle('light-theme', mode === 'light');
      root.setAttribute('data-theme', mode);
      root.style.colorScheme = mode;
      // typography class on <body> (also when the host page provides its own <body>, e.g. the online demo)
      this.doc.body?.classList.add('mat-typography');
      safeStorage.set(KEY, mode);
    });
  }

  toggle(): void {
    this.mode.update((m) => (m === 'dark' ? 'light' : 'dark'));
  }
}
