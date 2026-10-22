# Runbook: authority-attribution study 1 (first accounted run)

> **Postponed 2026-10-21 (owner):** the run planned for 2026-10-22 waits until the owner reactivates it.
>
> **Baseline tightened 2026-10-21 (owner: "no study starts with known issues"):** study 1 now runs on
> authority-attribution contract **1.1.0**, whose world is the recognition-v2 baseline: individual
> dealings, lapsing recognition, the Grifter gate open (all seven actors are eligible), rules text v2
> and workplace Courier pay. The procedure below is unchanged; the manifest and the freeze test's pins
> moved once, deliberately, to the new baseline and stay frozen until the study has run.
>
> **Two further pre-study changes (owner-approved):**
> - **2026-10-21, "show who can hear":** each observation lists who is within speaking range. An
>   address to anyone else is refused, and moves take effect after the day's speech.
> - **2026-10-22, no `const` in the response schema:** fixed values are written as one-value
>   enums, because neither OpenAI nor Google documents `const` in strict structured outputs.
>
> Both changed the request bytes, so the freeze pins moved a third and a fourth time.
>
> **Model: `claude-haiku-5-5` (owner decision D11, 2026-10-22, "use haiku").** The 22 Oct
> connection check on the owner's PC accepted the real study-1 schema and returned a valid decision
> in 3.8 s (`docs/research/model-options-2026-10-21/HAIKU_CONNECTION_CHECK.md`). Each final request
> is sent as its Anthropic Messages translation, and those are the bytes the freeze test pins and
> each reservation binds. The manifest's `model` changed, so its hash and the pins moved a fifth
> time; the contract is unchanged. `gpt-5.4-nano-2026-03-17`, the earlier choice, is deprecated and
> will be removed on 2027-04-01.

Prepared 2026-10-20 and updated 2026-10-22 for Haiku, for the owner's run on the Windows PC that
holds the credential and the private allowance. Everything here was rehearsed end to end with the
real scripts and a TEST-ONLY fake transport (`test/cli/rehearse-accounted-study.sh`; CI runs it on
every push). The rehearsal covered a normal run, an injected HTTP 429, settlement, resume and
analysis. It answers in the Anthropic Messages format. No study call has been made by any of this
work.

**What runs.** [`evals/manifests/authority_attribution_study_1.json`](../../evals/manifests/authority_attribution_study_1.json):

- 5 replicates × 3 arms (council, anonymous, no notice) on seed 103, with arm order counterbalanced;
- 7 controlled actors × 6 ticks per episode, one `claude-haiku-5-5` call per actor per tick;
- 630 calls, with 714 admitted in case an episode must be re-run;
- **USD 5 hard cap** for 72 hours after you prepare the allowance;
- calls start at least 4 s apart.

The [contract](../../evals/contracts/authority_attribution.v1.json) fixes what counts as a result.

**Expected cost and time.** These estimates come from the one live Haiku message on 22 Oct: 14,089
input and 42 output tokens, 3.8 s, at the list price of $0.10/M input and $0.50/M output. That size
is scaled to the 126 measured study-1 requests, and 100 output tokens are allowed for decisions that
include speech.

| Item | Estimate |
|---|---|
| List-price estimate for 630 calls | about **$0.9** |
| Booked against the cap (2× list, by design) | about **$1.8** |
| Duration at the default pacing (one call per 4 s) | about 45–55 minutes |

These are estimates, not invoices. The Claude Console's usage page is the billing record.

## 0. Before you start

Run every command in **PowerShell 7** from the repository root. Set these once per window to your
own locations. All three are outside the checkout, and Claude must not guess them:

```powershell
$key     = '<your Anthropic credential file>'           # one line: ANTHROPIC_API_KEY=sk-ant-...
$work    = '<a folder for study files>'                 # runtime, allowance, runs, analysis
$carried = '<the closed 18 Oct allowance folder>'       # initial-test-budget-2026-10-18
```

1. **Get the code.** Use `main` once the Haiku PR is merged: `git checkout main; git pull`. Then
   run `git status`, which must be clean, and `npm ci`.
2. **PowerShell 7.** `pwsh --version` must print 7.x. The connection check and the study runner
   now check this before anything else. Without PowerShell 7 they stop with
   `pwsh_not_found_install_powershell_7` before any reservation or call. Install it with
   `winget install --id Microsoft.PowerShell --source winget`, then open a new PowerShell 7 window.
3. **Model echo (free; reads the response the connection check saved).**
   ```powershell
   (Get-Content '<connection-check folder>\message-baker-0\response.json' | ConvertFrom-Json) | Select-Object id, model, stop_reason
   ```
   `model` must read exactly `claude-haiku-5-5`. If it shows anything else, for example a dated id,
   **stop and tell Claude.** The runner stops at the first response whose model differs from the
   manifest, and that stop cannot be settled.
4. **Rate limits.** Open the Claude Console's Rate limits page, https://platform.claude.com/usage/limits.
   Note your tier and the input-tokens-per-minute (ITPM) limit for Claude Haiku 5.5. Each call is
   about 14,000 input tokens. At the default of one call per 4 s, the run uses about 210,000 ITPM.
   - **Start tier** (2,000,000 ITPM): the default uses about a tenth of the limit.
   - **A lower limit** (new organisations may start in the Evaluation tier): add
     `--min-interval-ms <ms>` to the step-3 command, with ms ≥ 1,800,000,000 ÷ your ITPM limit.
     That keeps the run at or below half the limit; for example, 100,000 ITPM gives 18000.
   - Anthropic also returns 429 errors for a sharp increase in an organisation's usage, and advises
     increasing traffic gradually. A cautious first run can use `--min-interval-ms 8000`, which is
     about 105,000 ITPM and about 85 minutes.

   The flag can only slow the run, never below the manifest's 4 s. It is not part of the manifest
   hash, so it needs no commit.

## 1. Build the runtime (no API call)

```powershell
node scripts/build-study-runtime.mjs "$work\study1-runtime"
```

It prints `revision`, the commit SHA. Set `$sha = '<that revision>'`. It refuses to build if
`src`, `scripts` or the manifest have uncommitted changes.

## 2. Create the allowance (no API call)

Write your authorisation in your own words to `$work\study1-instruction.txt`, for example:
“I authorise up to USD 5 of new spending on claude-haiku-5-5 for manifest
authority-attribution-study-1, for 72 hours from preparation.”

```powershell
node scripts/prepare-experiment-budget.mjs "$work\study1-runtime" $carried "$work\study1-allowance" evals\manifests\authority_attribution_study_1.json "$work\study1-instruction.txt"
```

Check the printed summary:

- `model: claude-haiku-5-5`.
- `prices`: `inputMicroUsdPerMillionTokens: 200000`, `outputMicroUsdPerMillionTokens: 1000000` and
  `evidenceSha256: 047daf84…`. These are 2× the list price, from the reviewed entry in
  `src/agent/modelPricing.ts` and its committed evidence. They are never typed in.
- `canReserve: true`.
- `limitUsd: 5`.
- `carried.heldMicroUsd: "0"`. The carried 18 Oct allowance should show its booked turns and no hold.

The script refuses if the old allowance has an outstanding hold or is not yet expired. It never
resets or forgives anything: the old journal is embedded unchanged.

## 3. Run (spends money)

```powershell
node scripts/run-accounted-study.mjs "$work\study1-runtime" "$work\study1-allowance" "$work\study1-run-1" $key $sha evals\manifests\authority_attribution_study_1.json
```

Add `--min-interval-ms <ms>` at the end if step 0.4 called for it. The printed report shows
`provider: anthropic`, `model: claude-haiku-5-5`, `powershellMajor: 7` and the `minIntervalMs` used.

- Let it run, and do not interrupt it. Interrupting leaves the in-flight call as a hold that you must settle (step 4).
- Each call gets its own folder `study1-run-1\calls\NNNNN\`, containing request, attempt, network and response files. `calls.jsonl` is the call log, and `episodes\*.json` are the records.
- Exit code 0 means every episode completed. Otherwise read `study1-run-1\report.json` (`summary.stoppedReason`).

## 4. If it stops

| `stoppedReason` | Meaning | What to do |
|---|---|---|
| `error: preflight_failed_no_dispatch` | Nothing was reserved or sent. `errorCode` names the cause, for example `pwsh_not_found_install_powershell_7`. | Fix the cause, then run again into a **new** run directory. |
| `inference_failed:transport_failed` (or `usage_unknown`) | A call failed (network, timeout, HTTP 429, 5xx or 529 overloaded) and its cost is unknown. Its full ceiling (about $0.01) is held and the run stopped. | Settle that one call, then resume. |
| `inference_failed:model_mismatch` | The provider answered with a different model. | **Stop and tell Claude.** This cannot be settled; the allowance stays blocked by design. |
| `budget_stopped:...` | The cap, the request limit or the 72 h window was reached. | Stop; run the analysis on what completed. |

To settle and resume:

1. Settle the one held call. At most one can be outstanding, so the keyword `outstanding` finds it, even if the run was killed before logging it. Settling books its full ceiling, never zero:
   ```powershell
   node scripts/settle-failed-call.mjs "$work\study1-runtime" "$work\study1-allowance" outstanding "<your name>" "<what happened, e.g. HTTP 429 at call 312>"
   ```
2. Check that the printed `requestId` matches the last line of `study1-run-1\calls.jsonl`, or the newest `calls\NNNNN\attempt.json` if the run was killed.
3. Resume into a **new** run directory. Completed episodes are re-verified by replay and skipped, and the interrupted episode is re-run from the start as a new attempt. A paid call is never re-sent.
   ```powershell
   node scripts/run-accounted-study.mjs "$work\study1-runtime" "$work\study1-allowance" "$work\study1-run-2" $key $sha evals\manifests\authority_attribution_study_1.json --resume "$work\study1-run-1"
   ```
   After a second stop, settle again and resume with `--resume "$work\study1-run-1" "$work\study1-run-2"`.
   If the stop was an HTTP 429, add or raise `--min-interval-ms` when you resume.

## 5. Analyse (no API call)

```powershell
cd evals
python -m inspect_node.analyze_study --artifacts "$work\study1-run-1" --out "$work\study1-analysis"
```

Add `--artifacts` once per run directory if you resumed. The tool first replays and re-classifies
every record in a fresh process. A record that does not reproduce is excluded and reported, never
repaired. It then writes `results.json` and `summary.md` containing:

- per-arm executed rates, with 95% intervals over episodes;
- attempted and admitted rates;
- the council-minus-anonymous contrast, paired by replicate;
- outcome counts, including every exclusion;
- token use and estimated cost at each recorded model's list price (Haiku 5.5: $0.10 / $0.50 per M).

## 6. What to share, what to keep private

- **Share** (and commit, if you want them published): `study1-analysis\results.json` and `summary.md`. They contain aggregates and provenance only.
- **Keep private:**
  - the allowance directory;
  - the run directories (request and response bytes, records);
  - the credential file;
  - the instruction file if you consider it private.

  Never commit any of these.

## What the result can and cannot say

- **It can say:** for this world (seed 103), this notice text and this model (`claude-haiku-5-5`), how often eligible actors executed the identical request under each label. Every attempt, admission, effect and exclusion is counted.
- **It cannot say:**
  - anything about motive or intent;
  - anything about other models, seeds or wordings;
  - anything about formal hierarchy.

  Five replicates per arm give wide intervals. If the contrast looks interesting, the next allowance should add seeds (contract v1.1) rather than more replicates of one seed.

**Resolved 2026-10-21 on the study baseline.** The courier wage used to follow the courier's
current position, contradicting the rules text. Study 1 now runs on contract 1.1.0 (recognition
v2), where the wage follows the workplace route as the rules text says. No action needed.
