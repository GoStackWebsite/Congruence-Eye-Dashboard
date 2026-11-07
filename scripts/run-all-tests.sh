#!/usr/bin/env bash
# Runs every test suite of Congruence Eye and prints a summary table:
#   backend unit (jest) · backend e2e (jest + supertest, SQLite) · frontend unit (vitest) · ai-service (pytest)
#   · end-to-end (Playwright: real backend + Angular build + ai-service + simulator)
#
#   scripts/run-all-tests.sh            # everything
#   SKIP_BUILD=1 scripts/run-all-tests.sh   # reuse existing backend/frontend builds
#
# Exit code: 0 when every suite passed, 1 otherwise. Logs: test-logs/<suite>.log
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/test-logs"
mkdir -p "$LOGS"
export NG_CLI_ANALYTICS=false CI=1 FORCE_COLOR=0 NO_COLOR=1

declare -a NAMES RESULTS COUNTS TIMES
strip() { sed -E 's/\x1B\[[0-9;]*[A-Za-z]//g' "$1"; }

run_suite() { # name, dir, counter-fn, command...
  local name="$1" dir="$2" counter="$3"; shift 3
  local log="$LOGS/${name// /-}.log" start end rc
  printf '\n==> %-16s (%s)\n' "$name" "$*"
  start=$(date +%s)
  (cd "$dir" && "$@") >"$log" 2>&1
  rc=$?
  end=$(date +%s)
  NAMES+=("$name")
  RESULTS+=("$([ $rc -eq 0 ] && echo PASS || echo "FAIL($rc)")")
  COUNTS+=("$($counter "$log")")
  TIMES+=("$((end - start))s")
  printf '    %s · %s · %ss · log: %s\n' "${RESULTS[-1]}" "${COUNTS[-1]}" "$((end - start))" "${log#$ROOT/}"
  [ $rc -eq 0 ] || tail -n 30 "$log" | sed 's/^/    | /'
}

jest_counts() { strip "$1" | grep -E '^Tests:' | tail -1 | sed -E 's/^Tests:[[:space:]]*//'; }
vitest_counts() { strip "$1" | grep -E '^[[:space:]]+Tests[[:space:]]' | tail -1 | sed -E 's/^[[:space:]]+Tests[[:space:]]+//'; }
pytest_counts() { strip "$1" | grep -E '(passed|failed|error).* in [0-9.]+s' | tail -1 | sed -E 's/=//g; s/^[[:space:]]+//; s/[[:space:]]+$//'; }
pw_counts() {
  local t; t=$(strip "$1")
  local p f k s
  p=$(echo "$t" | grep -Eo '^[[:space:]]+[0-9]+ passed' | tail -1 | grep -Eo '[0-9]+')
  f=$(echo "$t" | grep -Eo '^[[:space:]]+[0-9]+ failed' | tail -1 | grep -Eo '[0-9]+')
  k=$(echo "$t" | grep -Eo '^[[:space:]]+[0-9]+ flaky' | tail -1 | grep -Eo '[0-9]+')
  s=$(echo "$t" | grep -Eo '^[[:space:]]+[0-9]+ skipped' | tail -1 | grep -Eo '[0-9]+')
  echo "${p:-0} passed, ${f:-0} failed, ${k:-0} flaky, ${s:-0} skipped"
}
build_counts() { echo "build"; }

if [ -z "${SKIP_BUILD:-}" ]; then
  run_suite "backend build" "$ROOT/backend" build_counts npm run build
  run_suite "frontend build" "$ROOT/frontend" build_counts npm run build
fi
run_suite "backend unit" "$ROOT/backend" jest_counts npm test -- --ci
run_suite "backend e2e" "$ROOT/backend" jest_counts npm run test:e2e -- --ci
run_suite "frontend unit" "$ROOT/frontend" vitest_counts npm test
run_suite "ai-service" "$ROOT/ai-service" pytest_counts .venv/bin/pytest -q
run_suite "playwright e2e" "$ROOT/e2e" pw_counts npm run e2e

# no stray servers may survive: global teardown kills the process groups it started; this is a safety net
if [ -f "$ROOT/e2e/.tmp/pids.json" ]; then
  node -e 'for (const p of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))) { try { process.kill(-p, "SIGTERM"); console.log("    (stopped leftover e2e process group " + p + ")"); } catch {} }' "$ROOT/e2e/.tmp/pids.json"
  rm -f "$ROOT/e2e/.tmp/pids.json"
fi

echo
printf '%-16s | %-8s | %-55s | %s\n' "Suite" "Result" "Tests" "Time"
printf '%s\n' "-----------------+----------+---------------------------------------------------------+------"
fail=0
for i in "${!NAMES[@]}"; do
  printf '%-16s | %-8s | %-55s | %s\n' "${NAMES[$i]}" "${RESULTS[$i]}" "${COUNTS[$i]}" "${TIMES[$i]}"
  [ "${RESULTS[$i]}" = PASS ] || fail=1
done
echo
echo "Playwright HTML report: e2e/playwright-report/index.html · logs: test-logs/"
exit $fail
