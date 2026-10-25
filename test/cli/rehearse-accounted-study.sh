#!/usr/bin/env bash
# End-to-end rehearsal using real compiled accounting/runner/replay and a TEST-ONLY pure
# response fixture: compile runtime -> carry + authorise allowance -> run (429 at index 50)
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
node scripts/prepare-experiment-budget.mjs "$W/runtime" "$W/initial" "$W/allowance" "$W/manifest.json" "$W/instruction.txt" > "$W/prepare.json"
if node scripts/run-accounted-study.mjs "$W/runtime" "$W/allowance" "$W/NEVER-CREATED" "$W/NEVER-READ-CREDENTIAL" "$REV" "$W/manifest.json" > "$W/gated.stdout" 2> "$W/gated.stderr"; then
  echo "the historical production dispatch gate should remain closed"; exit 1; fi
if node test/cli/run-offline-accounted-study.mjs "$W/runtime" "$W/allowance" "$W/run-1" "$REV" "$W/manifest.json" --fail-at 50 > /dev/null; then
  echo "run-1 should have stopped at the injected failure"; exit 1; fi
node scripts/settle-failed-call.mjs "$W/runtime" "$W/allowance" outstanding "TEST-ONLY operator" "TEST ONLY: injected HTTP 429" > "$W/settle.json"
node test/cli/run-offline-accounted-study.mjs "$W/runtime" "$W/allowance" "$W/run-2" "$REV" "$W/manifest.json" --resume "$W/run-1" > /dev/null
(cd evals && "$PY" -m inspect_node.analyze_study --artifacts "$W/run-1" --artifacts "$W/run-2" --out "$W/analysis" > /dev/null)
"$PY" - "$W" <<'PY'
import glob, json, sys
w = sys.argv[1]
r1, r2 = json.load(open(w + '/run-1/report.json')), json.load(open(w + '/run-2/report.json'))
res, settle, prepare = json.load(open(w + '/analysis/results.json')), json.load(open(w + '/settle.json')), json.load(open(w + '/prepare.json'))
sent = glob.glob(w + '/run-*/calls/*/request.json')
checks = {
  'run-1 stopped on the injected failure with one hold': r1['summary']['stoppedReason'] == 'inference_failed:transport_failed' and r1['allowance']['heldMicroUsd'] != '0',
  'settlement booked the full ceiling and reopened admission': settle['result'] == 'settled' and settle['canReserve'] is True,
  'the outstanding request found by the settle command is the logged failed call': settle['requestId'] == [json.loads(l) for l in open(w + '/run-1/calls.jsonl')][-1]['requestId'],
  'resume skipped the verified episode and completed the rest': [x['episodeId'] for x in r2['skippedVerified']] == ['council-r1'] and r2['summary']['stoppedReason'] is None and r2['summary']['episodesCompleted'] == 2,
  'no holds remain': r2['allowance']['heldMicroUsd'] == '0',
  'every counted record replays and re-classifies': all(v['replay'] and v['classification'] for v in res['verification']) and len(res['verification']) == 3,
  'the interrupted attempt is excluded, not counted': [x['status'] for x in res['excludedAttempts']] == ['inference_failed'],
  'label-sensitive fixture gives contrast 1': res['contrast_council_minus_anonymous']['mean'] == 1,
  'the allowance carries the reviewed Haiku rates, not the carried nano ones': prepare['model'] == 'claude-haiku-5-5' and prepare['prices']['model'] == 'claude-haiku-5-5' and prepare['prices']['inputMicroUsdPerMillionTokens'] == 200000 and prepare['prices']['outputMicroUsdPerMillionTokens'] == 1000000,
  'both offline runs exercised Anthropic Messages adaptation with no network, credential or worker process': all(r['provider'] == 'anthropic' and r['model'] == 'claude-haiku-5-5' and r['transport'] == 'pure_scripted_fixture' and r['networkRequests'] == r['credentialReads'] == r['childProcesses'] == 0 for r in (r1, r2)) and len(sent) > 0 and all('messages' in json.load(open(f)) for f in sent),
  'the historical real dispatch remains closed without touching a credential or output directory': 'legacy_live_context_security_gate_closed' in open(w + '/gated.stderr').read() and not __import__('os').path.exists(w + '/NEVER-CREATED') and not __import__('os').path.exists(w + '/NEVER-READ-CREDENTIAL'),
}
for k, v in checks.items(): print(('PASS ' if v else 'FAIL ') + k)
sys.exit(0 if all(checks.values()) else 1)
PY
