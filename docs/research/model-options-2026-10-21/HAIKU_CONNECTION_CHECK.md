# Haiku connection check (owner-run) — 2026-10-22

Checks whether `claude-haiku-5-5` accepts the **real study-1 requests**: the same instructions,
observation, notices and decision schema, translated to Anthropic's Messages format by
`src/agent/anthropicRequest.ts`. No cloud session makes this call; you run it on your PC.

## What it costs

| Step | Endpoint | Cost |
|---|---|---|
| Count the 7 tick-0 requests | `POST /v1/messages/count_tokens` | **free** (rate-limited) |
| `--send-one`: one real message (the Baker) | `POST /v1/messages` | about **$0.001** at $0.10 / $0.50 per M. The script refuses to send if the ceiling (counted input + 25%, plus 2,048 output tokens) is over `--max-usd`, default $0.01, allowed up to $0.05 |

Nothing here is study evidence. No allowance is created or touched, and the episode is not
advanced.

## Run it (Windows, PowerShell 7)

Set `$key` to your credential file and `$work` to a folder for the check, both outside the
checkout. (The paths first shown here were invented examples; corrected 2026-10-22.)

1. Update and install: `git pull` on `main`, then `npm ci`.
2. Build the runtime from the committed source, into a new directory:
   `node scripts/build-study-runtime.mjs "$work\runtime"`
3. Put the key in a file outside the checkout, containing one line:
   `ANTHROPIC_API_KEY=sk-ant-...`
   The key is read only by `scripts/anthropic-request.ps1`. It never enters Node, the command line
   or any written file.
4. Count only (free):
   `node scripts/check-anthropic-connection.mjs "$work\runtime" "$work\count-1" $key`
5. One real message (about $0.001):
   `node scripts/check-anthropic-connection.mjs "$work\runtime" "$work\send-1" $key --send-one`
6. Share `report.json` from the artifact directory. It holds no key. The per-call folders hold the
   request and response bytes, which are study-1 fixture data, not private game state.

Both steps first check for PowerShell 7 and stop with `pwsh_not_found_install_powershell_7`
before any call if it is missing.

## What the report answers

- **Schema accepted?** `sent.httpStatus` 200 and `schemaAccepted: true`. On a 400, `errorType` and
  `errorMessage` name the rejected keyword or the complexity limit.
- **Tokenizer:** `counted[].inputTokens` per actor, against OpenAI's ~12.9k on 18 Oct for an older
  observation, plus `countedVsBilledInput` for the one message.
- **Speed:** `elapsedMs` against the study's **12,000 ms** deadline (`withinStudyDeadline`).
- **Valid decision?** `validatorAccepts`, checked by the real validator. `caseMismatches` lists
  any enum value Claude returned in a different case. Anthropic documents this can happen; we
  record it and do not repair it.
- **Cost:** `costUsd` at list price, and `stopReason` (`end_turn`, `refusal` or `max_tokens`).
- **Reasoning:** `reasoning.status` (`summary_returned`, `summary_empty`, `redacted_only` or
  `not_returned`), the summaries verbatim, and `outputTokensOfCap` (output tokens used of 2,048).

## Request settings, and why

- **Format:** `output_config.format = {type:'json_schema', schema}`. The schema is study 1's, with
  `minimum`/`maximum` removed, because Anthropic rejects those with a 400. The validator still
  enforces price ∈ [0, 2].
- **Reasoning (since 2026-10-22, owner decision):** `thinking: {type:'adaptive', display:'summarized'}`
  at `output_config.effort = 'medium'`. The reply may begin with `thinking` blocks before the
  answer; each holds a provider-written summary (never the raw chain of thought) and an opaque
  signature. Thinking counts toward the 2,048-token cap and is billed as output. The check below
  was run earlier with `thinking: {type:'disabled'}` at effort `low`, which mirrored the OpenAI
  request; re-run it (runbook step 0.5) to measure the new setting.
- **Not sent:** temperature, top_p, top_k or an assistant prefill. Each returns a 400 on Haiku 5.5.
- **Model id:** `claude-haiku-5-5` is itself a pinned snapshot, with retirement no sooner than
  2027-10-07.

## Result — owner's PC, 2026-10-22 (runtime 973ed24, thinking disabled at effort low)

First attempt: all seven calls returned `httpStatus: null` because PowerShell 7 (`pwsh`) was not
installed. The report did not name that cause, which was a gap in the script. (Fixed 2026-10-22,
D11: the check and the study runner now test for PowerShell 7 before any call, and a worker that
never ran is reported as `local_worker_did_not_run`.) After installing it:

- **Free counts (`count_tokens`, schema excluded):** 10,592–10,803 input tokens per study-1
  tick-0 request, for all seven actors, all HTTP 200.
- **One message (`baker-0`, `--send-one`):**
  - HTTP 200, `stop_reason: end_turn`, **schema accepted**;
  - **3,797 ms**, within the 12,000 ms study deadline;
  - billed **14,089 input / 42 output** tokens, so the schema adds about 3,300 input tokens over
    the count;
  - cost **$0.00143**;
  - decision `{move:null, communication:null, diary:null, role:{bakerPrice, 0.5}}`;
  - **validator accepts**, with no enum case mismatches.
- **Implied study-1 cost on Haiku 5.5:** about 630 × $0.0014 ≈ **$0.90** list, $1.80 booked at 2×.
  This uses one call's measured size and is not a forecast of output length. For comparison,
  gpt-5.4-nano at its 18 Oct size (about 12.9k in) comes to about $1.8 list.
- **Response model, confirmed by the owner on 2026-10-22** from the saved response (runbook step
  0.3): `id msg_011CgHYj9CZ73MHDVMVGusBZ`, `model claude-haiku-5-5`, `stop_reason end_turn`. That is
  exactly the manifest's model, which the study runner requires. The check now also prints it as
  `sent.responseModel`.

## Study-1 cost: gpt-5.4-nano vs Haiku 5.5 (2026-10-22, owner asked)

Request sizes are measured offline over all 126 study-1 prompts (3 arms × 6 ticks × 7 actors):
the OpenAI body averages 25,952 bytes (range 24,615–27,113) and the Anthropic body 25,777 bytes
(range 24,447–26,921). Tokens per call are projected from measured ratios:

- **nano:** three live calls on 18 Oct averaged about 12,933 input tokens for a request of about
  28,659 bytes, i.e. 2.22 bytes per token. That scales to about 11.7k tokens today, and the
  measured 12.9k is used as the upper bound. Output was 140–296 tokens, including low-effort
  reasoning (mean 208).
- **Haiku:** one live call billed 14,089 input tokens for 26,416 bytes, i.e. 1.875 bytes per
  token, which gives about 13.7k tokens today. Output was 42 tokens for a price-only decision;
  100 is assumed for decisions that include speech.

| Model | List USD per M (in / out) | Per call | Study 1 (630 calls), list | Booked 2× (USD 5 cap) | 3,500-call study at today's size |
|---|---|---|---|---|---|
| gpt-5.4-nano-2026-03-17 | 0.20 / 1.25 | $0.0025–0.0030 | **$1.6–1.9** | $3.2–3.7 | $8.8–10.3 |
| claude-haiku-5-5 | 0.10 / 0.50 | ≈ $0.0014 | **$0.88–0.90** | $1.8 | ≈ $5.0 |

These are projections from one to three measured calls each, not quotes. Prompt caching is not
assumed for either, because the schema changes on every call.
