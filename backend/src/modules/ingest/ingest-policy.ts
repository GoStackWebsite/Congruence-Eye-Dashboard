/**
 * Edge ingest acceptance policy (docs/qa/EDGE_CASE_PLAN.md, "Time"):
 * - a timestamp more than INGEST_MAX_FUTURE_SEC (default 600 s) ahead of the server clock is REJECTED
 *   (edge clock drift; clamping would silently move data into the wrong hour)
 * - a timestamp older than INGEST_MAX_AGE_DAYS (default 30) is REJECTED (rollups for closed periods are final)
 * Rejections are per item: the rest of the batch is accepted and the response lists
 * `rejected` + `errors: { index, reason }[]` (first 50), so one bad event never blocks an edge spool.
 */
export type RejectReason =
  | 'FUTURE_TS'
  | 'STALE_TS'
  | 'UNKNOWN_CAMERA'
  | 'FOREIGN_CAMERA'
  | 'UNKNOWN_ZONE'
  | 'ZONE_REQUIRED'
  | 'UNKNOWN_RULE'
  | 'DUPLICATE';

export const maxFutureSec = () => {
  const v = parseInt(process.env.INGEST_MAX_FUTURE_SEC || '600', 10);
  return isFinite(v) ? v : 600;
};
export const maxAgeDays = () => {
  const v = parseInt(process.env.INGEST_MAX_AGE_DAYS || '30', 10);
  return isFinite(v) ? v : 30;
};

/** null when the timestamp is acceptable, otherwise the reason. Non-positive limits disable a check. */
export function tsProblem(ts: Date, now = new Date()): 'FUTURE_TS' | 'STALE_TS' | null {
  const fut = maxFutureSec();
  const age = maxAgeDays();
  if (fut > 0 && ts.getTime() > now.getTime() + fut * 1000) return 'FUTURE_TS';
  if (age > 0 && ts.getTime() < now.getTime() - age * 86400_000) return 'STALE_TS';
  return null;
}

export class IngestTally {
  accepted = 0;
  duplicates = 0;
  rejected = 0;
  errors: { index: number; reason: RejectReason }[] = [];
  reject(index: number, reason: RejectReason) {
    if (reason === 'DUPLICATE') this.duplicates++;
    else this.rejected++;
    if (reason !== 'DUPLICATE' && this.errors.length < 50) this.errors.push({ index, reason });
  }
  result() {
    return { accepted: this.accepted, duplicates: this.duplicates, rejected: this.rejected, errors: this.errors };
  }
}
