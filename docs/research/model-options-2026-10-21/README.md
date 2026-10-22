# Model options for the accounted studies — verified synthesis (2026-10-22)

**Status: every family verified.** The researchers worked on 2026-10-21. Independent verifiers
checked every claim against its cited source on 2026-10-21/22 (Anthropic, open-weight and local in a
verification-only rerun, at the owner's direction). This synthesis was written without an agent,
from the verified files only:

| Family | Researcher output | Verification |
|---|---|---|
| OpenAI | `research-openai.unverified.json` | `verification-partial.json` → `verify:openai` |
| Google | `research-google.unverified.json` | `verification-partial.json` → `verify:google` |
| Anthropic | `research-anthropic.unverified.json` | `verify-anthropic.json` |
| Hosted open-weight | `research-open-weight.unverified.json` | `verify-open-weight.json` |
| Local | `research-local.unverified.json` | `verify-local.json` → **[LOCAL_REQUIREMENTS.md](LOCAL_REQUIREMENTS.md)** |

Workflow scripts: `cheaper-model-research.workflow.js` (research + verify) and
`verify-saved.workflow.js` (verify only, 3 agents).

## Two corrections to what the researchers and verifiers were told

1. **The schema form has been accepted live.** The researchers and verifiers were told that no
   live call had produced a decision. That was wrong. On 2026-10-18 two calls to
   `gpt-5.4-nano-2026-03-17` returned HTTP 200 and valid decisions
   (`docs/recovery/INITIAL_GAME_TURN.md`), with this strict schema form:
   - string and numeric `const`;
   - `minimum`/`maximum`;
   - nested `anyOf` with a `{type:'null'}` branch.

   OpenAI therefore accepts what it does not document. The schema has since dropped `const` in
   favour of one-value enums (2026-10-22), the form every provider documents.
2. **The per-call deadline is 12,000 ms, not about 16 s.** It is enforced in `broker.ts` and
   `httpBody.ts` (found by the local verifier and checked in code).

## Verified facts that drive the choice

- **The study-1 model is deprecated.** `gpt-5.4-nano-2026-03-17` was deprecated on 2026-10-01 and
  will be removed from the API on 2027-04-01. Study 1 can still run on it now, and it is the only
  model with live evidence for our schema. A later 30–40-day diary study, or a replication after
  April 2027, cannot use it.
- **Pinnability.** Only these options can be pinned:
  - `gpt-5.4-nano-2026-03-17`, a dated snapshot, until its removal;
  - `claude-haiku-5-5`, which is itself a pinned snapshot, with retirement no sooner than
    2027-10-07;
  - local GGUF files, pinned by sha256 for as long as the file is kept.

  `gpt-6-luna`, `gpt-5.6-luna` and the Groq gpt-oss models are aliases and can change under the
  same id.
- **Schema documentation.**
  - OpenAI and Google document the current form, apart from `{type:'null'}` as a standalone anyOf
    branch. Google does not document that branch; OpenAI does.
  - Anthropic rejects `minimum`/`maximum` with HTTP 400. Those keywords would have to be dropped
    for Anthropic only; `validateDecision` already enforces price ∈ [0, 2].
  - Local llama.cpp grammars enforce everything except number `minimum`/`maximum`, which are
    silently ignored; the validator catches those.
- **Transport changes for any non-OpenAI path.**
  - `responsesTransport.ts` hard-codes `https://api.openai.com/v1/responses`.
  - The model-id check rejects `/`.
  - Groq's gpt-oss always returns a plaintext reasoning item, which `recordedResponse.ts` rejects.
  - Anthropic needs its native Messages API.
  - Google needs `generateContent` or Chat Completions.

## Cost at verified list prices (no cache hits: the schema changes on every call)

7,000 input tokens per call. The range is 250–500 output tokens, including reasoning. Booked =
the project's 2× conservative booking, set against the USD 5 study-1 allowance.

| Model | USD per M in / out | Study 1, 630 calls | Booked 2× | Diary study, 3,500 calls | Code change needed |
|---|---|---|---|---|---|
| gpt-5.4-nano-2026-03-17 (current; deprecated) | 0.20 / 1.25 | 1.08 – 1.28 | 2.55 | 5.99 – 7.09 | none |
| gpt-6-luna (alias) | 0.10 / 0.50 | 0.52 – 0.60 | 1.20 | 2.89 – 3.33 | none (set the cache mode to explicit) |
| claude-haiku-5-5 (pinned) | 0.10 / 0.50 | 0.52 – 0.60* | 1.20* | 2.89 – 3.33* | Messages adapter; drop min/max |
| gemini-3.1-flash-lite | 0.25 / 1.50 | 1.34 – 1.57 | 3.15 | 7.44 – 8.75 | new adapter |
| gemini-2.5-flash-lite (access restricted) | 0.10 / 0.40 | 0.50 – 0.57 | 1.13 | 2.80 – 3.15 | new adapter |
| gpt-oss-120b on Groq (alias) | 0.15 / 0.60 | 0.76 – 0.85 | 1.70 | 4.20 – 4.72 | endpoint, id, reasoning item |
| gpt-oss-20b on Groq (alias) | 0.075 / 0.30 | 0.38 – 0.43 | 0.85 | 2.10 – 2.36 | endpoint, id, reasoning item |
| Local GGUF (owner's GPU) | — | electricity | — | electricity | see LOCAL_REQUIREMENTS.md |

\* Claude's tokenizer count for our requests is unmeasured. The free `count_tokens` endpoint
gives it before any spending.

Dropped after verification:
- Fireworks gpt-oss-120b: serverless removal on 2026-11-07.
- DeepSeek: no documented enforcement, and the alias cannot be pinned.
- Mistral and Together: enforcement undocumented, and Chat Completions only.
- Alibaba open-weight Qwen: no JSON Schema mode.
- Haiku 4.5: ten times the price of Haiku 5.5.
- gpt-5-nano: shutdown on 2026-12-11.
- gpt-4o-mini: shutdown on 2027-01-14.
- gpt-4.1-nano: shutdown on 2026-10-23.

## Owner direction (D10, 2026-10-22) and the Haiku check

The owner prefers local, free models where they are suitable, and accepts paid models for the
rest, including mixed within one study. The Anthropic adapter (`src/agent/anthropicRequest.ts`,
`anthropicResponse.ts`) and an owner-run connection check are built and tested offline; see
[HAIKU_CONNECTION_CHECK.md](HAIKU_CONNECTION_CHECK.md). Mixed per-actor sourcing and accounting
are designed (register D10). They will be built once the check and the local measurement show which
models qualify.

## Owner decision D11 (2026-10-22): study 1 on `claude-haiku-5-5`

After the [connection check](HAIKU_CONNECTION_CHECK.md) passed on the owner's PC (schema accepted,
3.8 s, a valid decision) and the measured cost comparison, the owner chose Haiku for study 1: “use
haiku and make the fix please”. The allowance books Haiku at 2× its list price, from a reviewed
entry backed by a hashed excerpt of the pricing page (`evidence/`, `src/agent/modelPricing.ts`). The
recommendation below predates the decision and is kept as written. Its reason, that only nano had
live evidence for the schema, no longer holds after the check.

## Recommendation (the owner decides; superseded for study 1 by D11)

- **Study 1: keep `gpt-5.4-nano-2026-03-17`.** It is the only option with live evidence for our
  schema and transport, and it needs no code change. It is a dated snapshot, it costs about $1.1–1.3
  at list ($2.55 booked, within the USD 5 cap), and it stays available until 2027-04-01. Switching
  later is a new study condition, not a cost saving.
- **The 30–40-day diary study:** decide between local and `claude-haiku-5-5` before that study
  is built.
  - Local is free per call and pinned by file hash forever, but it needs measurement and two small
    transport changes (see [LOCAL_REQUIREMENTS.md](LOCAL_REQUIREMENTS.md)).
  - Haiku 5.5 is pinned and costs half as much as nano, but it needs a Messages adapter and a
    schema variant without min/max.
  - Running study 1's arms on a second model would also test whether its behaviour is
    model-specific. That is a design question, not a cost one.
- **Before the first call on any new model:** send one request with the real v2 schema, check
  acceptance, the token count and the latency against 12 s, and re-read the provider's
  deprecations page.
