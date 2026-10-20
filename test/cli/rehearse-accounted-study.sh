#!/usr/bin/env bash
# End-to-end rehearsal of the Thursday procedure with the real scripts and a TEST-ONLY fake
# transport: compile runtime -> carry + authorise allowance -> run (HTTP 429 injected on call 50)
# -> settle the failed call -> resume -> analyse. No network, credential or real ledger.
# Usage (repo root, Linux/macOS): PYTHON=<python with evals/requirements.txt> test/cli/rehearse-accounted-study.sh
set -euo pipefail
ROOT=$(pwd); W=$(mktemp -d); PY=${PYTHON:-python3}; REV=$(git rev-parse HEAD)
trap 'rm -rf "$W"' EXIT
node scripts/build-study-runtime.mjs "$W/runtime" > /dev/null   # refuses an uncommitted tree
npx tsx test/cli/make-test-initial-allowance.ts "$W/initial"
"$PY" - "$W" <<'PY'
import json, sys
m = json.load(open('evals/manifests/authority_attribution_study_1.json'))
m.update(id='TEST-ONLY-rehearsal', episodes=m['episodes'][:3], minIntervalMs=20); m['allowance']['maxRequests'] = 168
json.dump(m, open(sys.argv[1] + '/manifest.json', 'w'), indent=2)
PY
echo "TEST ONLY rehearsal. Not a financial authorization." > "$W/instruction.txt"
mkdir "$W/bin"; printf '#!/bin/sh\nexec node %s "$@" -FailAtFile %s\n' "$ROOT/test/cli/fake-transport-worker.mjs" "$W/fail-at.txt" > "$W/bin/pwsh"; chmod +x "$W/bin/pwsh"
echo "OPENAI_API_KEY=sk-TESTONLYnotarealkey" > "$W/fake.env"
node scripts/prepare-experiment-budget.mjs "$W/runtime" "$W/initial" "$W/allowance" "$W/manifest.json" "$W/instruction.txt" > "$W/prepare.json"
echo 00050 > "$W/fail-at.txt"
if PATH="$W/bin:$PATH" node scripts/run-accounted-study.mjs "$W/runtime" "$W/allowance" "$W/run-1" "$W/fake.env" "$REV" "$W/manifest.json" > /dev/null; then
  echo "run-1 should have stopped at the injected failure"; exit 1; fi
node scripts/settle-failed-call.mjs "$W/runtime" "$W/allowance" outstanding "TEST-ONLY operator" "TEST ONLY: injected HTTP 429" > "$W/settle.json"
PATH="$W/bin:$PATH" node scripts/run-accounted-study.mjs "$W/runtime" "$W/allowance" "$W/run-2" "$W/fake.env" "$REV" "$W/manifest.json" --resume "$W/run-1" > /dev/null
(cd evals && "$PY" -m inspect_node.analyze_study --artifacts "$W/run-1" --artifacts "$W/run-2" --out "$W/analysis" > /dev/null)
"$PY" - "$W" <<'PY'
import json, sys
w = sys.argv[1]
r1, r2 = json.load(open(w + '/run-1/report.json')), json.load(open(w + '/run-2/report.json'))
res, settle = json.load(open(w + '/analysis/results.json')), json.load(open(w + '/settle.json'))
checks = {
  'run-1 stopped on the injected failure with one hold': r1['summary']['stoppedReason'] == 'inference_failed:transport_failed' and r1['allowance']['heldMicroUsd'] != '0',
  'settlement booked the full ceiling and reopened admission': settle['result'] == 'settled' and settle['canReserve'] is True,
  'the outstanding request found by the settle command is the logged failed call': settle['requestId'] == [json.loads(l) for l in open(w + '/run-1/calls.jsonl')][-1]['requestId'],
  'resume skipped the verified episode and completed the rest': [x['episodeId'] for x in r2['skippedVerified']] == ['council-r1'] and r2['summary']['stoppedReason'] is None and r2['summary']['episodesCompleted'] == 2,
  'no holds remain': r2['allowance']['heldMicroUsd'] == '0',
  'every counted record replays and re-classifies': all(v['replay'] and v['classification'] for v in res['verification']) and len(res['verification']) == 3,
  'the interrupted attempt is excluded, not counted': [x['status'] for x in res['excludedAttempts']] == ['inference_failed'],
  'label-sensitive fixture gives contrast 1': res['contrast_council_minus_anonymous']['mean'] == 1,
}
for k, v in checks.items(): print(('PASS ' if v else 'FAIL ') + k)
sys.exit(0 if all(checks.values()) else 1)
PY
