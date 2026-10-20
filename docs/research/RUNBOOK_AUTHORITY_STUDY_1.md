# Runbook: authority-attribution study 1 (first accounted run)

Prepared 2026-10-20 for the owner's run on **Thursday 2026-10-22**, on the Windows PC that holds the
credential and the private allowance. Everything here was rehearsed end to end with the real
scripts and a TEST-ONLY fake transport (`test/cli/rehearse-accounted-study.sh`; CI runs it on every
push). The rehearsal covered a normal run, an injected HTTP 429, settlement, resume and analysis.
No real API call has been made by any of this work.

**What runs.** [`evals/manifests/authority_attribution_study_1.json`](../../evals/manifests/authority_attribution_study_1.json):

- 5 replicates × 3 arms (council, anonymous, no notice) on seed 103, with arm order counterbalanced;
- 7 controlled actors × 6 ticks per episode, one `gpt-5.4-nano-2026-03-17` call per actor per tick;
- 630 calls, with 714 admitted in case an episode must be re-run;
- **USD 5 hard cap** for 72 hours after you prepare the allowance;
- calls start at least 4 s apart.

The [contract](../../evals/contracts/authority_attribution.v1.json) fixes what counts as a result.

**Expected cost and time.** Estimates are from the two live turns on 18 Oct (about 12.9k input and
140–300 output tokens per call, at $0.20/M input and $1.25/M output standard):

| Item | Estimate |
|---|---|
| Standard-price estimate for 630 calls | about **$1.8** |
| Booked against the cap (2× prices, by design) | about **$3.6** |
| Duration | about 45–60 minutes |

These are estimates, not invoices. Your dashboard is the billing record.

## 0. Before you start

1. Get the code onto the PC. Once [PR #26](https://github.com/SDarkVader/The-Node/pull/26) is merged, use `main`: `git fetch origin main; git checkout main; git pull`. Until then, use the PR branch: `git fetch origin ccr-8d64b59c-a4puhv; git checkout ccr-8d64b59c-a4puhv`.
2. Run `git status`. It must be clean. Then `npm ci`.
3. **Rate limits.** Open your OpenAI organization's limits page and find the tokens-per-minute limit for `gpt-5.4-nano`. At one call per 4–5 s, the run uses up to about 200k tokens per minute.
   - If your limit is below about 300k TPM, raise `minIntervalMs` in the manifest (6000 halves the risk) and commit that change **before** step 2. The allowance is bound to the manifest's exact hash.
4. Keep every directory below **outside** the checkout, next to your existing `outputs\` folders.

## 1. Build the runtime (no API call)

```powershell
node scripts/build-study-runtime.mjs ..\outputs\study1-runtime
```

It prints `revision`, the commit SHA. Use that exact value as `<SHA>` below. It refuses to build if
`src`, `scripts` or the manifest have uncommitted changes.

## 2. Create the allowance (no API call)

Write your authorisation in your own words to a text file, for example `..\outputs\study1-instruction.txt`:
“I authorise up to USD 5 of new spending on gpt-5.4-nano-2026-03-17 for manifest
authority-attribution-study-1, for 72 hours from preparation.”

```powershell
node scripts/prepare-experiment-budget.mjs ..\outputs\study1-runtime ..\outputs\initial-test-budget-2026-10-18 ..\outputs\study1-allowance evals\manifests\authority_attribution_study_1.json ..\outputs\study1-instruction.txt
```

Check the printed summary:

- `canReserve: true`.
- `limitUsd: 5`.
- `carried.heldMicroUsd: "0"`. The carried 18 Oct allowance should show its booked turns and no hold.

The script refuses if the old allowance has an outstanding hold or is not yet expired. It never
resets or forgives anything: the old journal is embedded unchanged.

## 3. Run (spends money)

```powershell
node scripts/run-accounted-study.mjs ..\outputs\study1-runtime ..\outputs\study1-allowance ..\outputs\study1-run-1 ..\outputs\broker-accounting-rebuild\.env.local <SHA> evals\manifests\authority_attribution_study_1.json
```

- Let it run, and do not interrupt it. Interrupting leaves the in-flight call as a hold that you must settle (step 4).
- Each call gets its own folder `study1-run-1\calls\NNNNN\`, containing request, attempt, network and response files. `calls.jsonl` is the call log, and `episodes\*.json` are the records.
- Exit code 0 means every episode completed. Otherwise read `study1-run-1\report.json` (`summary.stoppedReason`).

## 4. If it stops

| `stoppedReason` | Meaning | What to do |
|---|---|---|
| `inference_failed:transport_failed` (or `usage_unknown`) | A call failed (network, timeout, HTTP 429/5xx) and its cost is unknown. Its full ceiling (≤ $0.02) is held and the run stopped. | Settle that one call, then resume. |
| `inference_failed:model_mismatch` | The provider answered with a different model. | **Stop and tell Claude.** This cannot be settled; the allowance stays blocked by design. |
| `budget_stopped:...` | The cap, the request limit or the 72 h window was reached. | Stop; run the analysis on what completed. |

To settle and resume:

1. Settle the one held call. At most one can be outstanding, so the keyword `outstanding` finds it, even if the run was killed before logging it. Settling books its full ceiling, never zero:
   ```powershell
   node scripts/settle-failed-call.mjs ..\outputs\study1-runtime ..\outputs\study1-allowance outstanding "<your name>" "<what happened, e.g. HTTP 429 at call 312>"
   ```
2. Check that the printed `requestId` matches the last line of `study1-run-1\calls.jsonl`, or the newest `calls\NNNNN\attempt.json` if the run was killed.
3. Resume into a **new** run directory. Completed episodes are re-verified by replay and skipped, and the interrupted episode is re-run from the start as a new attempt. A paid call is never re-sent.
   ```powershell
   node scripts/run-accounted-study.mjs ..\outputs\study1-runtime ..\outputs\study1-allowance ..\outputs\study1-run-2 ..\outputs\broker-accounting-rebuild\.env.local <SHA> evals\manifests\authority_attribution_study_1.json --resume ..\outputs\study1-run-1
   ```
   After a second stop, settle again and resume with `--resume run-1 run-2`.

## 5. Analyse (no API call)

```powershell
cd evals
python -m inspect_node.analyze_study --artifacts ..\..\outputs\study1-run-1 --out ..\..\outputs\study1-analysis
```

Add `--artifacts` once per run directory if you resumed. The tool first replays and re-classifies
every record in a fresh process. A record that does not reproduce is excluded and reported, never
repaired. It then writes `results.json` and `summary.md` containing:

- per-arm executed rates, with 95% intervals over episodes;
- attempted and admitted rates;
- the council-minus-anonymous contrast, paired by replicate;
- outcome counts, including every exclusion;
- token use and estimated cost.

## 6. What to share, what to keep private

- **Share** (and commit, if you want them published): `study1-analysis\results.json` and `summary.md`. They contain aggregates and provenance only.
- **Keep private:**
  - the allowance directory;
  - the run directories (request and response bytes, records);
  - the credential file;
  - the instruction file if you consider it private.

  Never commit any of these.

## What the result can and cannot say

- **It can say:** for this world (seed 103), this notice text and this model, how often eligible actors executed the identical request under each label. Every attempt, admission, effect and exclusion is counted.
- **It cannot say:**
  - anything about motive or intent;
  - anything about other models, seeds or wordings;
  - anything about formal hierarchy.

  Five replicates per arm give wide intervals. If the contrast looks interesting, the next allowance should add seeds (contract v1.1) rather than more replicates of one seed.
