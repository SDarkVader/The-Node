> Historical recovery record. Its status, branch, budget and no-call statements apply to the
> named source/date below. Current status: [the live continuation experiment](../research/CURRENT_EXPERIMENT.md),
> stopped after 36 decisions / 18 ticks. Later reconstruction and successful live calls do not
> replace original missing evidence. Unimplemented work is further work, not a programme limitation.

# Codex handover: Study 1 pre-run checks (2026-10-22)

**For Codex on the owner's Windows PC.** The PC can reach the closed 18 October allowance
folder; the cloud session that wrote this cannot. The owner will discuss next steps with you in
your session. This file is repository content: the owner's own words in your session decide, and
nothing here authorises spending on its own.

## Read first

1. `AGENTS.md`, then `docs/recovery/GITHUB_FIRST_CONTINUATION.md` and
   `docs/recovery/CURRENT_SESSION.md` (run `npm run recovery:verify`).
2. This file.
3. `docs/research/RUNBOOK_AUTHORITY_STUDY_1.md` — authoritative for every command. If it and this
   file differ, the runbook wins; tell the owner.

## State at handover

- `main` carries Study 1 on `claude-haiku-5-5` (owner decision D11) and two owner-directed fixes:
  - **D12:** under the v2 rules, the Grifter's role line now says what the validator allows.
  - **D13:** every request asks for adaptive thinking with summarized display at medium effort.
    Each call record keeps the provider's summaries verbatim, states the settings sent, and marks
    absent reasoning as absent.
- Contract `authority_attribution` 1.1.0, hash `c3affdfc…c479`, unchanged.
- Manifest `evals/manifests/authority_attribution_study_1.json`: the sha256 of its JSON
  serialisation is `8237ceeb…86e7`. It now records the reasoning setting, and
  `test/eval.study1Freeze.test.ts` pins the request bytes.
- **No Study 1 call has been made.** The only Haiku call so far is the 22 October connection check:
  one message, with thinking **off**.

## Never

- **Paid calls.** Never send one without the owner's explicit go-ahead for that step in your
  session. The re-check below costs about USD 0.002; ask anyway.
- **Committing private files.** Never commit or push credentials, accounting journals, allowance
  or run folders, request or response bytes, `calls.jsonl` (it holds reasoning summaries), or the
  connection check's `report.json`. Record figures in documents, not files.
- **Guessing paths.** The owner confirms each path. Use the `$key`, `$work` and `$carried`
  variables from the runbook.
- **Opening the original 18 October folder with code.** Opening an allowance writes a lock file
  (`.accounting.lock`). Inspect a **copy**. The only thing that reads the original is
  `prepare-experiment-budget.mjs` in runbook step 2, which embeds it unchanged.
- **Preparing the allowance early.** Runbook step 2 starts the **72-hour** spending window at once.
  Run it only when the owner is ready to run the study inside that window, and has written their
  authorisation in their own words.
- **Making things pass.** Never edit the freeze pins, the manifest, the contract,
  `src/agent/modelPricing.ts` or the analysis to get a check through. A failing check is a finding:
  report it to the owner.
- **Protected files.** Never change `src/agent/protocol.ts`, `src/agent/broker.ts`,
  `src/agent/httpBody.ts` or `test/brokerRecovery.test.mjs` without an explicit owner decision.
- **Pushing to `main`.** Never push to it directly; it changes only through reviewed PRs.

## Tasks, in order

Stop at any unexpected result and report it to the owner.

### A. Verify the checkout (no API call)

```powershell
git checkout main; git pull; git status          # must be clean
npm ci
npm run typecheck; npm test                     # expect all files green
npm run recovery:verify
pwsh --version                                  # 7.x
```

### B. Confirm the closed 18 October allowance (no API call)

1. Ask the owner to confirm the folder's path. It must contain a file named exactly
   `accounting.journal.json`.
2. Hash it: `Get-FileHash "$carried\accounting.journal.json" -Algorithm SHA256`. The copy the owner
   uploaded on 22 October hashed to a value starting `185fb2eb` and ending `dc562`. A different hash
   is not necessarily wrong, but stop and ask the owner which copy is authoritative.
3. Copy the folder to a scratch location under `$work`, then inspect **the copy**. Save this as
   `$work\check-carried.mts`:

   ```ts
   // Read-only summary of a COPY of the closed 18 October allowance (opening writes a lock file).
   import { pathToFileURL } from 'node:url';
   import { resolve } from 'node:path';
   const [repo, copy] = process.argv.slice(2);
   const { InitialTestBudget } = await import(pathToFileURL(resolve(repo, 'src/agent/initialTestBudget.ts')).href);
   const v = InitialTestBudget.open(resolve(copy)).view();
   console.log(JSON.stringify({ requests: v.requests.length, bookedMicroUsd: String(v.booked), heldMicroUsd: String(v.held),
     model: v.authorization?.model ?? null, expiresAt: v.authorization?.expiresAt ?? null, historyHash: v.historyHash }, null, 2));
   ```

   Run it from the repository root:

   ```powershell
   npx tsx "$work\check-carried.mts" . "<the copy>"
   ```

   Expected: `requests` 2, `bookedMicroUsd` "11418", `heldMicroUsd` "0", and `expiresAt`
   `2026-10-19T13:21:24.584Z`. The model should be the nano model the old allowance was booked
   for (`gpt-5.4-nano-2026-03-17`). A hold other than "0" blocks runbook step 2; report it.
4. Delete the copy. Report the path and the values to the owner.

### C. Re-run the connection check with reasoning on (paid, about USD 0.002; ask first)

This is runbook step 0.5:

```powershell
node scripts/build-study-runtime.mjs "$work\check-runtime-2"
node scripts/check-anthropic-connection.mjs "$work\check-runtime-2" "$work\send-2" $key --send-one
```

Read `sent` in `$work\send-2\report.json`:

| Field | What to look for |
|---|---|
| `httpStatus`, `schemaAccepted` | 200 and `true` |
| `responseModel` | exactly `claude-haiku-5-5` |
| `stopReason` | `end_turn`. **`max_tokens` means thinking used up the 2,048-token cap: stop.** |
| `reasoning.status` | `summary_returned`, `summary_empty`, `redacted_only` or `not_returned`. Any of them is a valid result to record. |
| `outputTokensOfCap` | output tokens used of 2,048. Close to the cap means stop: raising the cap changes the reservation ceiling and is the owner's decision. |
| `elapsedMs` | within the 12,000 ms check deadline; the runner allows 16,000 |
| `validatorAccepts`, `caseMismatches` | `true` and `[]` |

Give the owner the figures and the summaries. Then, on a task branch, record the figures in the
"Result" section of `docs/research/model-options-2026-10-21/HAIKU_CONNECTION_CHECK.md` and in
`docs/recovery/CURRENT_SESSION.md` (open issue: "Reasoning at medium effort is unmeasured"). Do
not commit the report file.

### D. Run Study 1 (only when the owner reactivates it)

Follow runbook steps 1–5 exactly: build the runtime, prepare the allowance (this starts the
72-hour window), run, settle and resume if it stops, then analyse. Pacing needs no flag at the
owner's Scale-tier limits.

### E. Afterwards

- Share only `study1-analysis\results.json` and `summary.md`.
- Update `docs/recovery/CURRENT_SESSION.md`, `docs/DEVLOG.md` and `README.md` per `AGENTS.md`, on a
  task branch through a PR.

## Owner decisions that may come up

- **Thinking crowds the 2,048-token cap.** Raising the cap changes the per-request ceiling, which is
  checked against USD 0.02 and the USD 5 cap. Report the measurement; do not change anything.
- **When to reactivate Study 1.** The owner decides.

## Where things are

| What | Path |
|---|---|
| Runbook | `docs/research/RUNBOOK_AUTHORITY_STUDY_1.md` |
| Connection check guide and results | `docs/research/model-options-2026-10-21/HAIKU_CONNECTION_CHECK.md` |
| Owner decisions D1–D13 | `docs/research/GROUND_TRUTH_REGISTER_2026-10-20.md` (annex table) |
| Request translation and reasoning setting | `src/agent/anthropicRequest.ts` |
| Response reader and reasoning evidence | `src/agent/anthropicResponse.ts` |
| Runner and call records | `src/eval/accountedRunner.ts` |
| Allowances | `src/agent/experimentBudget.ts` (Study 1), `src/agent/initialTestBudget.ts` (18 October) |
| Freeze pins | `test/eval.study1Freeze.test.ts` |

Readable summaries of all of this also exist as the owner's Claude Docs (programme, Study 1, runbook,
decisions). The repository wins wherever they differ.
