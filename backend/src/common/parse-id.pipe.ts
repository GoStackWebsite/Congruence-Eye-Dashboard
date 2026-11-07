import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

export const MAX_INT32 = 2147483647;

/**
 * Route id parameter: a positive 32-bit integer. ParseIntPipe let "99999999999999999999" through as 1e20,
 * which SQL Server rejects with a conversion error (500); here it is a 400.
 */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const s = String(value ?? '');
    const n = Number(s);
    if (!/^\d{1,10}$/.test(s) || !Number.isSafeInteger(n) || n < 1 || n > MAX_INT32) throw new BadRequestException('id must be a positive integer');
    return n;
  }
}
