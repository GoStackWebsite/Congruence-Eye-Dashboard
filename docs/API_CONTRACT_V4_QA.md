# Contract v4 — QA hardening addendum

Binding in addition to v1, v2 and v3. Where this file changes an earlier shape, this file wins. Every rule
has a test; the IDs refer to `docs/qa/EDGE_CASE_PLAN.md`.

## Edge ingest (`/api/ingest/*`)

**Idempotency.** Every `POST` (except `heartbeat`) accepts an `X-Batch-Id` header (or a `batchId` body field), 1–64 characters of `A-Z a-z 0-9 . _ : -`.
The first request with that id for the store is processed and its response stored for `INGEST_BATCH_TTL_DAYS` (default 14).
A replay returns the stored response plus `duplicate: true` and changes nothing. A replay while the first request is still running gets `409`, and the edge retries it.
An invalid id gets `400`. (I1, I2)

**Natural dedupe.** Even without a batch id, an item that is already stored is counted as a duplicate and not stored again:
- events: `cameraId + trackId + type + ts`
- queue snapshots: `zoneId + ts`
- store-ops events: `type + ts + cameraId`
- detections: `type + cameraId + ruleId + ts`

**Response of `events`, `queue`, `storeops` and `detections`** (replaces `{ accepted }`):
```ts
{ accepted: number, duplicates: number, rejected: number, errors: { index: number, reason: RejectReason }[] /* first 50 */ }
RejectReason = "FUTURE_TS" | "STALE_TS" | "UNKNOWN_CAMERA" | "FOREIGN_CAMERA" | "UNKNOWN_ZONE" | "ZONE_REQUIRED" | "UNKNOWN_RULE"
```
A rejected item never fails its batch, so one bad event cannot block an edge spool.

**Time policy.** (T6, T7)
- `ts` must be ISO-8601 with a UTC offset (`…Z` or `+05:30`). A bare local time gets `400`.
- `ts` more than `INGEST_MAX_FUTURE_SEC` (default 600) ahead of the server clock is rejected as `FUTURE_TS`. It is not clamped, because clamping would move the data into the wrong hour.
- `ts` older than `INGEST_MAX_AGE_DAYS` (default 30) is rejected as `STALE_TS`. To back-fill older days, raise the limit temporarily.
- `heatmap` and `snapshot` carry a single item, so they answer `400` with the reason instead.

**Cameras and zones.** (I5, I6)
- A batch made only of another store's cameras gets `403` "cameraId N belongs to another store". The edge dead-letters it instead of retrying.
- In a mixed batch those items are rejected as `FOREIGN_CAMERA`. Unknown cameras are rejected as `UNKNOWN_CAMERA`.
- A zone that is unknown or belongs to another store is rejected as `UNKNOWN_ZONE`.
- A zone that is inactive is accepted, because late spool data from a zone that was just retired is still real data.
- `heatmap` and `snapshot` for another store's camera get `403`.

**Limits.** (I7, I8)
- 5000 items per batch (`400`, and the message names the limit).
- 20 MB JSON body (`413`).
- `dwellSec` from 0 to 604800.
- Heatmap grid values must be finite and ≥ 0.
- `snapshot` must be a real JPEG. The magic number is checked, not the declared type.

**Heartbeat.** When a camera appears twice in one payload, the last entry wins. (I11)

## Analytics

- **Ratios of nothing are `null`, never `0`, `NaN` or `Infinity`.** The UI shows `--`. This covers:
  - `conversionPct`, `atv`, `engagedPct` and `bounceRatePct` in `overview.kpis` and `overview.daily`
  - `conversion.totals`, `conversion.daily`, `conversion.hourly` and `conversion.byStore` (`atv` and `itemsPerBill` too)
  - `traffic.hourly[].bouncedPct`
  - `zones[].engagedPct`, `bouncedPct` and `concentrationPct`
  - the rows of `benchmark` and `benchmark/groups`
  - `live.todayConversionPct`

  `Kpi` becomes `{ value: number | null, previous?: number | null, changePct?: number | null }`, and `changePct` is `null` when either side is `null`. (A1, A2, A9)
- `traffic.daily[]` and `overview.daily[]` add `isPartial` (the date is the store-local today, so the values are "so far") and `hasData` (any rollup exists for that date). `hasData: false` means there is no edge data, not a real 0, so a chart should show a gap. (T8)
- `heatmap` for a store without cameras returns `{ cameraId: null, width: 32, height: 18, grid: zeros, max: 0 }` instead of `404`. (A1)
- Dates must be real calendar dates: `2026-02-30` gets `400`, here and in every DTO date field. `from > to` gets `400` "from must be <= to" on every analytics endpoint and on `ai-manager/summary`. (T3)

## AI Manager

- `open-close[].detectionStatus` adds `"PENDING"` for days that are not decided yet (today, with an open or close still before its scheduled time + tolerance).
  `MISSING` (the time + tolerance has passed and no event arrived) is `BREACHED` on every day, including today. (F-OPENCLOSE)
- `summary` adds `totals: { detections, falsePositives, breached, complied, compliancePct | null }`.
  `totals.detections` equals `GET /detections` `total` for the same store scope and range (false positives included). `byType`, `byStore` and `daily` still exclude false positives.
  Both endpoints now use the same store scope, including stores that have since been deactivated. (F-DETECTIONS)

## Trax

- Templates add `version` (1, then +1 on every `PUT`).
- Submissions add:
  - `templateVersion`
  - `isLate` (submitted after the assignment's `dueAt`; the status is still `SUBMITTED`)
  - an internal `templateSnapshot`

  `GET /submissions/:id` returns `template` as it was answered (retired questions, old wording and old weights are kept). (X4, X12)
- Answer validation (`400` before scoring):
  - `{ message, missingQuestionIds: number[] }` for required answers that are missing
  - `{ message, invalidAnswers: { questionId, reason }[] }` for:
    - a YES_NO that is not YES/NO
    - an MCQ value that is not in `options`
    - a non-numeric NUMBER
    - a RATING outside 0–5
    - a `requiresPhoto` question without a photo
    - a question answered twice

  A NUMBER outside min/max is accepted, scored 0 and flagged. (X7–X10)
- Schedules: `400` for any of these (X1):
  - `repeatEvery` 0
  - WEEKLY without `daysOfWeek`
  - an `endDate` already in the past
  - `windowEnd ≤ windowStart`
  - an empty `storeIds`
  - a date that does not exist
- Generation uses each store's own local date. A fixed assignee who has been deactivated, or is no longer assigned to the store, falls back to the store's first active STORE_MANAGER. (X2, X3)
- Concurrent `POST /assignments/:id/draft` calls are serialised, so no answer is lost. (X6)

## Tasks / tickets / assignments

- An assignee must exist, be active and work at the store. Admins work everywhere. Otherwise the request gets `400` on:
  - tasks (create, update, bulk, and moving a task to another store)
  - tickets
  - checklist assignments

  (K5)
- `POST /tickets/:id/comments` on a `CLOSED` ticket gets `409` "reopen it to comment". `RESOLVED` tickets accept comments. (K3)

## Validation and security (all endpoints)

- Route ids are positive 32-bit integers. `abc`, `0`, `-1`, `1.5` and `99999999999999999999` get `400`, never a SQL Server conversion `500`. Out-of-range ids in `storeIds` and other query lists are ignored. (V6)
- Repeated query keys (`?status=A&status=B`) and injection strings in filters never cause a `500`. (V1b)
- String lengths are enforced against the column length on SQLite as well as SQL Server, with a `400` that names the field (`LengthGuardSubscriber`). (V4)
- Uploads are classified by magic number on `/api/uploads`, `/api/documents` and `/api/ingest/snapshot`:
  - executables, scripts and HTML are refused
  - `/api/uploads` and `/api/documents` are both limited to **50 MB**
  - document downloads send `X-Content-Type-Options: nosniff`, an ASCII `filename` and a UTF-8 `filename*`
  - text files are always served as `text/plain`

  (V2, V3)
- Audit log `details` adds `before` and `after` on updates and deletes. They hold only the changed fields, and the whole previous row on a hard delete. Secret columns are left out. (F-AUDIT)

## Media and infra (frontend QA follow-up)

- `GET /api/cameras/:id/snapshot` answers **`204 No Content`** when the camera has no snapshot yet (it was a `404`).
  It still answers `404` only for an unknown camera or one outside the user's scope. The UI shows its own "no snapshot yet" placeholder.
- `GET /api/infra/health`: `uptimePct7d` is **`null`** for a store without cameras (it was `100`). Issue texts give times in the store's local time, e.g. "Edge device offline since 05 Oct, 10:11 pm", never a raw ISO timestamp.
- Seed: the checklist photo evidence (`/uploads/files/seed-photo.jpg`) is a real 640×480 JPEG.
