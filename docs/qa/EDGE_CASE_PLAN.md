# Edge-case plan — backend and AI service

This plan covers the backend (NestJS) and the AI service (Python edge). The Angular UI and Playwright are covered by the frontend QA plan.

How to run the tests:
- backend: `npm run build && npm test && npm run test:e2e && npm run smoke`
- AI service: `.venv/bin/pytest -q`
- performance: `npm run perf` against a seeded backend

The shapes these tests rely on are in [API_CONTRACT_V4_QA.md](../API_CONTRACT_V4_QA.md).

Test files:
- `be/qa-ia` = `backend/test/qa-ingest-analytics.e2e-spec.ts`
- `be/qa-vt` = `backend/test/qa-validation-trax.e2e-spec.ts`
- `be/qa-rbac` = `backend/test/qa-rbac-matrix.e2e-spec.ts`
- `be/qa-f` = `backend/test/qa-findings.e2e-spec.ts`
- `ai/qa` = `ai-service/tests/test_qa_edge_cases.py`

**Status values.** **PASS** means it worked and the new test now guards it. **FIXED** means a real defect was found, fixed and covered by the test.

## 1 · Time

| ID | Area | Scenario | Expected | Test | Status |
|---|---|---|---|---|---|
| T1 | ingest/rollup | Events at 23:59:59.999 and 00:00:00.000 IST | Each lands on its own store-local date; hours 23 and 0 | be/qa-ia T1 | PASS |
| T2 | ingest/rollup | Store in Asia/Dubai; event at 23:30 Dubai (already the next day in IST) | Counted on the Dubai date, hour 23. An invalid IANA zone gets 400 | be/qa-ia T2 | PASS |
| T3 | analytics | `from > to`, `2026-02-30`, `yesterday`, a range over 800 days | 400 on all 12 analytics endpoints and on `ai-manager/summary` | be/qa-ia T3 | **FIXED** (non-existent dates were rolled over to March; summary did not check `from > to`) |
| T4 | analytics | Single-day range | Exactly one daily point; no NaN in the averages | be/qa-ia T4/T5 | PASS |
| T5 | analytics | Range across a month boundary, with `compare=true` | Every date present; no non-finite numbers | be/qa-ia T4/T5 | PASS |
| T6 | ingest | `ts` more than 10 min in the future (events, queue, heatmap) | **Rejected** per item as `FUTURE_TS` (heatmap: 400); within the skew it is accepted | be/qa-ia T6 | **FIXED** (was accepted) |
| T7 | ingest | `ts` older than 30 days | Rejected as `STALE_TS`; 29 days is accepted | be/qa-ia T7 | **FIXED** (was accepted) |
| T8 | analytics | Partial "today" | Overview footfall = traffic daily point = live `todayFootfall`; `isPartial` is set; `hasData:false` for days without data | be/qa-ia T8, smoke | **FIXED** (no partial / no-data marker, so a day without data looked like a real 0) |
| T9 | time.util | IST midnight, Dubai, Kathmandu +05:45, London DST both ways, leap day | Correct local parts and UTC conversion | `src/common/time.util.spec.ts` | PASS |

## 2 · Ingest robustness

| ID | Area | Scenario | Expected | Test | Status |
|---|---|---|---|---|---|
| I1 | idempotency | Same batch replayed with the same `X-Batch-Id`, or a new id with the same events | Stored response plus `duplicate:true`; the natural key catches the rest; footfall not doubled; a bad id gets 400 | be/qa-ia I1 | **FIXED** (a replay double counted) |
| I2 | idempotency | Heatmap replay with a batch id; queue snapshots resent | Grid not doubled; queue duplicates counted | be/qa-ia I2 | **FIXED** |
| I3 | visits | EXIT without ENTRY | Event stored, no visit; occupancy never negative | be/qa-ia I3 | PASS |
| I4 | visits | ENTRY without EXIT | Stale job closes the visit 3 h after the last event; dwell and engaged roll up | be/qa-ia I4 | PASS |
| I5 | zones | Unknown zone, another store's zone, missing zoneId, inactive zone | `UNKNOWN_ZONE` / `ZONE_REQUIRED`; an inactive zone is accepted (late spool data) | be/qa-ia I5 | **FIXED** (silently dropped, no feedback) |
| I6 | scope | Another store's cameras | Whole batch gets 403; a mixed batch gets `FOREIGN_CAMERA` per item; heatmap and detections get 403 | be/qa-ia I6, be/qa-rbac | **FIXED** (silently dropped) |
| I7 | limits | 5001 events; a body over 20 MB | 400 naming 5000; 413 | be/qa-ia I7 | PASS |
| I8 | validation | 11 malformed payloads (types, enums, ts without an offset, negative or huge dwell, bad JSON, bad grid) | 400 with a useful message | be/qa-ia I8 | **FIXED** (`ts` without an offset was parsed in the server zone; dwell had no limit; a negative grid was accepted) |
| I9 | data | Tamil, emoji, quotes and tags in store-ops details | Returned verbatim | be/qa-ia I9 | PASS |
| I10 | concurrency | 4 parallel batches, 2 cameras, same hour | Rollup = 120; recompute is idempotent | be/qa-ia I10 | PASS |
| I11 | health | Heartbeat flapping; the same camera twice in one payload | Ordered, contiguous intervals; downtime adds up; the last entry wins | be/qa-ia I11 | **FIXED** (a repeated camera in one payload logged a zero-length status interval) |

## 3 · Analytics math

| ID | Area | Scenario | Expected | Test | Status |
|---|---|---|---|---|---|
| A1 | empty store | New store, no cameras or data: 22 endpoints plus `live`, `heatmap`, `journey` and 10 exports | 200; empty structures; ratios `null` | be/qa-ia A1 | **FIXED** (heatmap gave 404; ratios came back as 0) |
| A2 | ratios | Transactions with zero footfall | `conversionPct` is `null`, never Infinity | be/qa-ia A2 | **FIXED** |
| A3 | groups | Group of 4, a "group" of 1, staff | `billableEntities` = 1 group + 2 individuals; staff excluded | be/qa-ia A3 | PASS |
| A4 | staff | ENTRY in a STAFF_ONLY zone | Counted as staff, not footfall | be/qa-ia A4 | PASS |
| A5 | repeat | Visits 30 days before (inside the window, inclusive) and 31 days before | repeat = 1 + 1, new = 2 | be/qa-ia A5 | PASS |
| A6 | benchmark | Only one store | Rank 1; `footfallChangePct` 0 | be/qa-ia A2 | PASS |
| A7 | journey | No transitions | Links `[]`; every highlight `null` | be/qa-ia A7 | PASS |
| A8 | heatmap | No frames | Zero grid; `max` 0 | be/qa-ia A7 | PASS |
| A9 | compare | Previous period empty | `changePct` 100 for counts; `null` for ratios | be/qa-ia A9 | PASS |

## 4 · RBAC

| ID | Area | Scenario | Expected | Test | Status |
|---|---|---|---|---|---|
| R1 | coverage | Every route in the Nest router (≈150) | Each route has an explicit decision in `ROLE_GATE`; no stale entries | be/qa-rbac | PASS |
| R2 | role gate | Every route × 6 roles (and no token, and a user JWT on edge routes) | Denied → 403; allowed → never 401/403/5xx; no token → 401; user JWT on edge → 401 | be/qa-rbac | PASS |
| R3 | scope | 22 cases × 6 roles × own/other store (store, camera, live, journey, heatmap, task, ticket, comment, assignment, submission, document download, recorder, probe, alert ack, detection review, recap, overview, zones) | Other store → 403 (lists: 200, filtered) | be/qa-rbac | PASS |
| R4 | tokens | Deactivated user | Existing token 401; login 401 | be/qa-rbac | PASS |
| R5 | tokens | Expired token, forged payload, wrong secret, `alg:none`, Basic auth, empty Bearer | 401 | be/qa-rbac | PASS |
| R6 | tokens | Admin demoted to STAFF | Admin routes 403 at once (the role is read from the DB) | be/qa-rbac | PASS |
| R7 | edge keys | A key used across stores, a rotated key, a deleted device | 403 / 401 / 401 | be/qa-rbac | PASS |

## 5 · Validation and security

| ID | Area | Scenario | Expected | Test | Status |
|---|---|---|---|---|---|
| V1 | injection | 4 SQL-injection and 4 XSS strings in region, task, ticket, comment and vendor | Stored verbatim; returned as JSON only; tables intact | be/qa-vt V1 | PASS |
| V1b | filters | Injection strings and repeated keys in 20 list filters | 200 (empty), never 500 | be/qa-vt V1b | **FIXED** (repeated keys reached the SQL as arrays; `alerts?from=garbage` became an Invalid Date parameter) |
| V2 | traversal | `../../etc/passwd` and `..\..\win.ini` as document names; `/uploads/..` URLs | Stored as base name only; `nosniff`; text served as `text/plain`; static files cannot escape the upload folder | be/qa-vt V2 | **FIXED** (no `nosniff`; Windows paths were kept; the declared MIME type was echoed back) |
| V3 | MIME spoofing | `.exe`, ELF, HTML and shell script renamed `.jpg` / `.png` / `.mp4`, on 3 upload paths | 400 by magic number; a real JPEG or PDF is stored as what it is | be/qa-vt V3 | **FIXED** (trusted the client `Content-Type`; documents accepted anything) |
| V3b | limits | 50 MB + 10 bytes; 30 MB document | 413 on both paths; 30 MB accepted | be/qa-vt V3b | **FIXED** (documents 25 MB vs uploads 50 MB) |
| V4 | lengths | Over-long names, codes, titles, descriptions, comments; a direct repository write | 400 naming the field (DTO, or the column guard on SQLite too) | be/qa-vt V4 | **FIXED** (SQLite accepted what SQL Server rejects with a 500) |
| V4b | lengths | Every DTO `@MaxLength` ≤ its `nvarchar(n)` column, and every bounded string has one | — | `src/common/dto-columns.spec.ts` (33) | PASS |
| V5 | paging | `page=0`, `pageSize=100000`, negative values, garbage, `1e309`, on 5 paged lists | Clamped to 1…500 / defaults | be/qa-vt V5 | PASS |
| V6 | numbers | Negative dwell, negative amount, negative area; ids `-1`, `0`, `1.5`, `abc`, `99999999999999999999`; NaN polygon | 400 | be/qa-vt V6 | **FIXED** (`ParseIntPipe` let 1e20 through, which is a SQL Server conversion 500; `-1` gave 404) |
| V7 | enums | Garbage priority, status, category, role, groupBy, export type and format, review status, settings | 400 | be/qa-vt V6 | PASS |

## 6 · Trax

| ID | Area | Scenario | Expected | Test | Status |
|---|---|---|---|---|---|
| X1 | schedules | `repeatEvery` 0; WEEKLY without days (create and update); `endDate` in the past; inverted window; no stores; date that does not exist | 400 | be/qa-vt X1 | **FIXED** (WEEKLY without days, past `endDate` and empty stores were accepted) |
| X2 | schedules | Fixed assignee deactivated | Falls back to the store manager; generate stays idempotent | be/qa-vt X2 | **FIXED** (assigned to the inactive user) |
| X3 | schedules | Dubai and Chennai across IST midnight | Each store uses its own local date and due time | be/qa-vt X3 | **FIXED** (IST date used for every store) |
| X4 | submissions | Resubmit after REDO | Allowed; assignment SUBMITTED with the new submission; old submission stays REDO | be/qa-vt X4/X5 | PASS |
| X5 | submissions | Submit after due | `SUBMITTED` + `isLate:true`; a double submit gets 409 | be/qa-vt X4/X5 | **FIXED** (no late flag) |
| X6 | drafts | 5 concurrent section saves | All 5 answers kept | be/qa-vt X6 | **FIXED** (read-merge-write race could lose answers) |
| X7 | submissions | Required answers missing | 400 + `missingQuestionIds` | be/qa-vt X7 | **FIXED** (question text only) |
| X8 | submissions | MCQ not in options; YES_NO "MAYBE"; rating 7; NaN number; duplicate or unknown question | 400 + `invalidAnswers` | be/qa-vt X8 | **FIXED** (scored 0 and accepted) |
| X9 | scoring | NUMBER outside min/max | Accepted; scored 0; flagged | be/qa-vt X9 | PASS |
| X10 | submissions | Photo required but missing | 400 | be/qa-vt X10 | **FIXED** (accepted) |
| X11 | AI check | AI service times out (300 ms limit, 3 s server) | `aiResult` ERROR; full score; not flagged | be/qa-vt X11 | PASS |
| X12 | versioning | Template edited after a submission | Submission keeps `templateVersion` 1 and the answered template (old wording, retired question, old weights) | be/qa-vt X12 | **FIXED** (history showed the edited template) |

## 7 · Tasks and tickets

| ID | Area | Scenario | Expected | Test | Status |
|---|---|---|---|---|---|
| K1 | SLA | URGENT ticket at 22:30 IST; LOW ticket | Due 02:30 the next day; 168 h | be/qa-vt K1 | PASS |
| K2 | lifecycle | Reopen a resolved ticket | REOPENED; `resolvedAt` cleared | be/qa-vt K2 | PASS |
| K3 | comments | Comment on RESOLVED / CLOSED | 201 / 409; allowed again after reopening | be/qa-vt K2 | **FIXED** (closed tickets accepted comments) |
| K4 | delete store | Store with open tasks and tickets | Soft delete; history readable; store leaves analytics | be/qa-vt K4 | PASS |
| K5 | assignee | Assignee outside the store or inactive (tasks, bulk, move, tickets, checklist assignments) | 400; admins can be assigned anywhere | be/qa-vt K5 | **FIXED** (any existing user was accepted) |

## 8 · AI service (edge)

| ID | Area | Scenario | Expected | Test | Status |
|---|---|---|---|---|---|
| E1 | spool | Response lost after the backend processed the batch | Retry has the same `X-Batch-Id`; new rows are not merged in; no double count | ai/qa | **FIXED** (no batch id; retries re-merged newer rows) |
| E2 | spool | Process restart with an in-flight batch | Same rows and same id after restart; then the rest in order | ai/qa | **FIXED** |
| E3 | spool | Spool from an older version (no `batch` column) | Migrated, then delivered | ai/qa | PASS |
| E4 | backoff | Backend 503 / timeouts | Heartbeat backs off 0.5 s; spooled data is kept and delivered once; sender loop waits 1 → 2 → 4 → 8 s | ai/qa (2 tests) | PASS |
| E5 | scope | 403 "belongs to another store" | Dead-lettered (not retried for ever); a plain proxy 403 is still retried | ai/qa | **FIXED** (retried for ever, blocking the queue) |
| E6 | bundles | Snapshot, store-ops and detection steps | Derived ids `<id>:snap`, `:storeops`, `:detections` | ai/qa | **FIXED** |
| E7 | runner | Camera deleted in the web app (config refresh) | Its worker is stopped and joined; the others keep running | ai/qa | PASS |
| E8 | worker | Stream missing, then the DVR channel comes back | OFFLINE (with reason), then reconnects and processes | ai/qa | PASS |
| E9 | counting | Person standing on the entry line for 60 s (jitter ±0.012) | 0 crossings | ai/qa | PASS |
| E10 | counting | Two people crossing side by side | 2 ENTRY; one group | ai/qa | PASS |
| E11 | counting | Group of 4 | 4 ENTRY sharing one `groupId` | ai/qa | PASS |
| E12 | counting | 1 fps; frame drops (3 s gap) | Exactly one ENTRY | ai/qa | PASS |
| E13 | staff | Uniformed staff | `isStaff` set; excluded | `tests/test_pipeline_e2e.py::test_frames_uniform_staff_and_cross_camera_reid`, `tests/test_staff.py` | PASS (existing) |
| E14 | night | Dark frames at 02:00 vs 15:00 | No LIGHTS_OFF / STORE_OPENED / tamper at night; one LIGHTS_OFF in business hours; dark frames do not crash | ai/qa (3 tests) | PASS |
| E15 | time | Every `ts` emitted | UTC with `Z`; parses to the right instant | ai/qa | PASS |
| E16 | evidence | AI Manager finding when the camera has no current frame | Falls back to the last lit frame, so COMPLIED and BREACHED both carry a snapshot | `processor.make_snapshot`; seed + smoke | **FIXED** |

## 9 · Performance

Seed: 90 days × 6 stores — 111 k POS bills, 6.4 k hourly rows, 2.3 k detections.

| ID | Area | Scenario | Target | Measured p95 (SQLite) | Status |
|---|---|---|---|---|---|
| P1 | analytics | 13 analytics endpoints, 90 days, all stores (20 runs) | < 800 ms | before: overview 580, storeops 739, zones 526<br>after: 8–221 (overview 139, journey 221, queue 207) | **FIXED** (rollups were read as entities: about 60 % of the time; overview read them twice) |
| P2 | lists | POS pages 1 and 1000; 90 days × 500; detections; image directory; audit; alerts; Trax dashboard / compliance; infra | < 500 ms | 7–70 | PASS |
| P3 | indexes | Added: `pos_transactions(storeId,ts)`, `queue_snapshots(storeId,ts)`, `ai_detections(storeId,ts)`, `snapshots(storeId,ts)`, `visits(exitTs,entryTs)` (stale job), `checklist_assignments(status,dueAt)` (overdue job runs on every list), `ingest_batches` | — | Mirrored in `database/01_schema.sql` | DONE |

Run P1 and P2 with `npm run perf` (`scripts/perf-bench.ts`). It exits 1 when a target is missed.

## 10 · SQL Server portability

| ID | Area | Scenario | Expected | Test | Status |
|---|---|---|---|---|---|
| S1 | DDL | `01_schema.sql` has every table, column and index | — | `src/common/mssql-portability.spec.ts` | PASS (regenerated) |
| S2 | identifiers | Identifier length | ≤ 128 | same | PASS |
| S3 | reserved words | `settings.key` (and any future reserved column) | Bracket-quoted in DDL; never bare in query fragments | same | PASS |
| S4 | SQL dialect | `strftime`, `IFNULL`, `GROUP_CONCAT`, `INSERT OR`, `LIMIT n`, … | None in `src` | same | PASS |
| S5 | 2100 parameters | `IN` lists over user ids, store ids, camera ids, tracks, snapshots and bills | Chunked (≤ 1000 per statement; 900 where two lists share a statement) | Code review | **FIXED** (`users.storeIdsOf`, `lookup.userNames` / `storeNames` / `stores`, `cameraHealth`) |
| S6 | int range | Ids beyond int32 | 400 or ignored before reaching SQL | be/qa-vt V6 | **FIXED** |
| S7 | length | `nvarchar(n)` overflow | 400 on both drivers (`LengthGuardSubscriber`) | be/qa-vt V4 | **FIXED** |

## Findings regressions (`docs/qa/FINDINGS.md`)

| ID | Finding | Test | Status |
|---|---|---|---|
| F-OPENCLOSE | `open-close` returned COMPLIED while open and close were both PENDING | `v2-media-aimanager` open-close test (now PENDING; MISSING → BREACHED) | FIXED |
| F-UPLOAD | Upload limits 25 vs 50 MB | be/qa-vt V3b | FIXED |
| F-VMSCHED | Seeded VM schedule had no stores | smoke "every seeded checklist schedule targets stores" | FIXED |
| F-AUDIT | Audit entries had no previous values | be/qa-f F-AUDIT | FIXED |
| F-EVIDENCE | Detections without snapshots | smoke "no detection without a snapshot"; E16 | FIXED |
| F-DETECTIONS | Summary 472 vs list 473 | be/qa-f F-DETECTIONS; smoke "summary total = list total" | FIXED |
| F-TODAY | Today's traffic point showed unique = 0 / missing bars | T8; smoke "today's traffic point is partial and consistent" | FIXED |

## Decisions

- **Future and old timestamps are rejected, not clamped.** Clamping silently moves data into the wrong hour.
- **Rejection is per item.** A bad item never blocks an edge spool.
- **Inactive zones still accept late data.** The data is real.
- **CLOSED tickets accept no comments.** RESOLVED tickets do, because they can still be reopened.
- **Deleting a store is a soft delete.** Open tasks and tickets stay readable.
