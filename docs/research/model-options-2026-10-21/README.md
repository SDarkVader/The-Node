# Model options for the accounted studies (2026-10-21) — research in progress

**Status: UNVERIFIED.** These are researchers' outputs, saved so that a lost session or container
does not force a re-run. They were the first attempt's research stage, cut off by a session
limit at verification, then rerun. Independent verifiers were still checking them when this was
written. Do not act on a number here until the verified file (`verified.json`, to be added beside
this one) confirms it.

## What was asked

The owner asked for cheaper models that would serve the studies (2026-10-21), and mentioned local
open-source models on their own PC: RTX 4070 Ti Super (16 GB), 64 GB RAM, Ryzen 7 7800X3D.

Workload: one inhabitant decision per call, with about 5–9k input tokens, a strict JSON schema and
a ~16 s synchronous deadline. Study 1 is 630 calls; a diary study would be about 3,500.

## Files

| File | Family | Producer |
|---|---|---|
| `research-openai.unverified.json` | OpenAI | workflow `cheaper-model-research`, run `wf_c1105733-775` |
| `research-google.unverified.json` | Google Gemini | same |
| `research-anthropic.unverified.json` | Anthropic Claude | same |
| `research-open-weight.unverified.json` | hosted open-weight (Groq, Fireworks, Together, OpenRouter, DeepSeek, Mistral, Alibaba) | same |
| `research-local.unverified.json` | local runtimes and models for the owner's GPU | same |
| `cheaper-model-research.workflow.js` | the workflow script (research → adversarial verify → synthesis) | rerun with the Workflow tool's `scriptPath` |

## Claims that would matter most if verified

- **The study-1 model may be deprecated.** OpenAI reportedly deprecated `gpt-5.4-nano-2026-03-17` on
  2026-10-01, with removal on 2027-04-01, and named `gpt-6-luna` as the replacement (about half
  the list price, but no dated snapshot).
- **No provider has accepted our schema in a real request.** The only live call (2026-10-16)
  returned HTTP 401. Our schema uses numeric and string `const`, nested `anyOf` with null,
  `minimum`/`maximum`, and enums that change on every call. Several providers do not document
  `const` (OpenAI, Google, Groq).
- **Local, with the existing transport:** Ollama v0.40.7 reportedly serves `/v1/responses`. It maps
  `text.format` json_schema to a llama.cpp grammar that enforces const, enum and nested anyOf. It
  ignores `minimum`/`maximum` on numbers (our price is still checked by our validator) and cannot
  disable prompt caching.
- **Local, most controllable:** llama-server reportedly *ignores* `text.format` on its
  `/v1/responses`. It would need a Chat Completions adapter (`response_format`).
- **Repo blockers for any non-OpenAI endpoint:** the transport hard-codes
  `https://api.openai.com/v1/responses`, and the model-id check rejects `/` (needed for
  `openai/gpt-oss-120b`).
- **Hosted open-weight:** Groq documents constrained decoding for `strict:true` on gpt-oss-20b and
  gpt-oss-120b, but not `const` or `minimum`/`maximum`.
- **Changing the model changes the subject.** Behaviour is model-specific, so a different model
  is a new study condition, not a cost saving.

## Next

1. The verifiers' results and the synthesis go into `verified.json` and a short decision note.
2. The owner chooses: keep the study-1 model while it is available, move to a verified cheaper
   hosted model, or run locally.
3. Before any study call, send a first request with the real schema to the chosen model or runtime.
