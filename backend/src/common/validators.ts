import { ValidationOptions, registerDecorator } from 'class-validator';
import { isDateStr } from './time.util';

/** "YYYY-MM-DD" that is a real calendar date (rejects 2026-02-30, 2026-13-01). */
export function IsDateOnly(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isDateOnly',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be a valid date (YYYY-MM-DD)`, ...options },
      validator: { validate: (v: unknown) => isDateStr(v) },
    });
}
