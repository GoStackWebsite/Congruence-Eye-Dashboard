import { ValidatorFn, Validators } from '@angular/forms';
import { STORE_TZ, isoToZonedInput, zonedInputToIso } from '../../core/utils/dates';

export interface FieldOption {
  value: string | number | boolean | null;
  label: string;
}

export type FieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'time'
  | 'date'
  | 'datetime'
  | 'list';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: FieldOption[] | ((value: Record<string, unknown>) => FieldOption[]);
  required?: boolean;
  min?: number;
  max?: number;
  hint?: string;
  placeholder?: string;
  /** Only shown when creating. */
  createOnly?: boolean;
  default?: unknown;
  /** Show only if predicate is true for the current form value. */
  visible?: (value: Record<string, unknown>) => boolean;
  full?: boolean;
  /** IANA zone of `datetime` fields (default: store time, Asia/Kolkata). */
  tz?: string;
  /** Regex the (text) value must match; `patternMessage` explains it. */
  pattern?: RegExp;
  patternMessage?: string;
  /** Max length of text values. */
  maxLength?: number;
}

export function resolveOptions(f: FieldDef, value: Record<string, unknown> = {}): FieldOption[] {
  return typeof f.options === 'function' ? f.options(value) : f.options ?? [];
}

export function enumOptions(values: readonly string[], humanizeFn: (s: string) => string = (s) => s): FieldOption[] {
  return values.map((v) => ({ value: v, label: humanizeFn(v) }));
}

export function validatorsFor(f: FieldDef): ValidatorFn[] {
  const v: ValidatorFn[] = [];
  if (f.required && f.type !== 'checkbox') v.push(f.type === 'multiselect' ? Validators.required : Validators.required);
  if (f.type === 'email') v.push(Validators.email);
  if (f.type === 'number') {
    if (f.min !== undefined) v.push(Validators.min(f.min));
    if (f.max !== undefined) v.push(Validators.max(f.max));
  }
  if (f.type === 'time') v.push(Validators.pattern(/^([01]\d|2[0-3]):[0-5]\d$/));
  if (f.type === 'password' && f.required) v.push(Validators.minLength(8));
  if (f.pattern) v.push(Validators.pattern(f.pattern));
  if (f.maxLength) v.push(Validators.maxLength(f.maxLength));
  return v;
}

/** Model value → form control value. */
export function toControlValue(f: FieldDef, raw: unknown): unknown {
  if (raw === undefined || raw === null) {
    if (f.default !== undefined) return f.default;
    if (f.type === 'checkbox') return false;
    if (f.type === 'multiselect') return [];
    return f.type === 'number' || f.type === 'select' ? null : '';
  }
  // datetime fields are store-local (IST), never the browser's zone: an HQ user abroad still schedules store time
  if (f.type === 'datetime') return isoToZonedInput(String(raw), f.tz ?? STORE_TZ);
  if (f.type === 'date') return String(raw).slice(0, 10);
  if (f.type === 'list') return Array.isArray(raw) ? raw.join(', ') : String(raw);
  if (f.type === 'time') return String(raw).slice(0, 5);
  return raw;
}

/** Form control value → API payload value. */
export function fromControlValue(f: FieldDef, v: unknown): unknown {
  if (f.type === 'number') return v === '' || v === null || v === undefined ? null : Number(v);
  if (f.type === 'datetime') return zonedInputToIso(v as string, f.tz ?? STORE_TZ);
  if (f.type === 'list')
    return String(v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  if (f.type === 'checkbox') return !!v;
  if ((f.type === 'text' || f.type === 'textarea' || f.type === 'email' || f.type === 'date') && typeof v === 'string') {
    const t = v.trim();
    return t === '' && !f.required ? null : t;
  }
  return v;
}
