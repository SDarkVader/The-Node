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

1. Update and install: `git pull` on `main`, then `npm ci`.
2. Build the runtime from the committed source, into a new directory outside the checkout:
   `node scripts/build-study-runtime.mjs D:\node-runtime\haiku-check`
3. Put the key in a file outside the checkout, containing one line:
   `ANTHROPIC_API_KEY=sk-ant-...`
   The key is read only by `scripts/anthropic-request.ps1`. It never enters Node, the command line
   or any written file.
4. Count only (free):
   `node scripts/check-anthropic-connection.mjs D:\node-runtime\haiku-check D:\node-artifacts\haiku-1 D:\secrets\anthropic.env`
5. One real message (about $0.001):
   `node scripts/check-anthropic-connection.mjs D:\node-runtime\haiku-check D:\node-artifacts\haiku-2 D:\secrets\anthropic.env --send-one`
6. Share `report.json` from the artifact directory. It holds no key. The per-call folders hold the
   request and response bytes, which are study-1 fixture data, not private game state.

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

## Request settings, and why

- **Format:** `output_config.format = {type:'json_schema', schema}`. The schema is study 1's, with
  `minimum`/`maximum` removed, because Anthropic rejects those with a 400. The validator still
  enforces price ∈ [0, 2].
- **Reasoning:** `output_config.effort = 'low'` and `thinking: {type:'disabled'}`. For Haiku 5.5,
  thinking is off at high effort or below; this mirrors the OpenAI request's low reasoning.
- **Not sent:** temperature, top_p, top_k or an assistant prefill. Each returns a 400 on Haiku 5.5.
- **Model id:** `claude-haiku-5-5` is itself a pinned snapshot, with retirement no sooner than
  2027-10-07.

## Result — owner's PC, 2026-10-22 (runtime 973ed24)

First attempt: all seven calls returned `httpStatus: null` because PowerShell 7 (`pwsh`) was not
installed. The report did not name that cause, which is a known gap in the script. After installing it:

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
