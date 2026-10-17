# Recovered historical results and current retry

This distinguishes prior tool-observed results from present inspection. Original evidence
and integration source are currently absent. It is a reconstruction, not their replacement.

## Historical first live pass — 2026-10-16 UTC

| Measurement | Recorded outcome |
|---|---|
| Executable revision | `b7c87f45ddb253a1c55a0ea28f27734479f442e3` |
| Requested calls | Two |
| Actual attempted actor requests | One |
| Model | `gpt-5.4-nano-2026-03-17`, low reasoning, default service, max output 2048 |
| Host | Existing deterministic World, persistent person mode, one existing Baker |
| Provider result | HTTP 401; safe trace `http_401_reservation_held` |
| Completed decisions / admitted game actions | 0 / 0 |
| Advanced ticks / complete snapshots | 0 / 1 genesis snapshot |
| Token usage / actual billed cost | Unknown; never assumed zero |
| Held conservative ceiling | US$0.019114, 19,114 micro-USD |
| Outstanding budget records | One; further requests blocked |
| Evals calls/result | None / not run |
| Genesis comparison | Matching zero-input replay; not an action-bearing success |

Undici emitted an unhandled asynchronous destruction error while discarding the rejected
body, crashing the broker. Historical fix `befaf31` added a shared bounded-body handler
with an error listener before destruction. No provider error body/key was logged. The
failed attempt remained reserved; no retry/reset/settlement occurred. Host shutdown was
checked, leaving no game listener. A separate postmortem recorded actual partial evidence.

## Historical validations, not rerun in this restored checkout

- Clean credential-free `npm ci` passed; dependency audit after pinned Undici 7.30.1 had zero known advisories.
- Before live attempt: typecheck passed, **865 tests / 81 files**, final run **48.88 seconds**.
- After HTTP repair: typecheck passed; focused HTTP/broker/Evals tests **24/24**.
- Final historical full suite: **868 tests / 82 files**, **60.18 seconds**.
- Real local HTTP covered 401/403/429 cleanup, malformed/oversized/successful JSON.
- Offline real-socket broker tests separately exercised two own-price decisions and complete-state replay equality.
- Original NODE-P1/build-brief files were checked unchanged; local docs links checked valid before the workspace restoration.

These checks do not prove successful hosted reasoning, alignment, game balance or generation
entitlement. A model list/readiness preflight returning 200 did not prevent the later 401.

## Recorded model/pricing decision

Earlier GPT-5 nano was only a planned default. The small GPT-5.4 nano snapshot replaced it
before the attempt, with disclosure, because authoritative pricing was available from a
pinned official OpenAI cookbook source. Neither produced a decision in this experiment.
Sol/Astra were not game actors; no generic agent framework replaced the simulation.

Official source: [OpenAI cookbook rate table](https://github.com/openai/openai-cookbook/blob/5bd6cb40b6b84b69b2032d810610aa85064102df/examples/agent_optimization/simulation.py).
Pinned commit `5bd6cb40b6b84b69b2032d810610aa85064102df`; publisher price-verification date
2026-09-14; local verification 2026-10-16. The data was read without executing downloaded
code. Archived source hash was `5727a1c5fc92e853f6fd4309104cecc2bd0172313aa5b22c94c5059e203e04c6`.

| USD / million tokens | Published standard | Conservative budget |
|---|---:|---:|
| Uncached input | 0.20 | 0.40 |
| Cached input | 0.02 | Discount ignored |
| Output including reasoning | 1.25 | 2.50 |

Direct official model docs were proxy-blocked. A documentation-domain draft was not observed
active; already allowed official GitHub supplied pricing without bypassing network controls.
Those historical rate/availability observations must be rechecked for future paid requests.

## Current retry — 2026-10-17

Environment revision **3** is observed current/running, binding `NODE_AI_API_KEY` ready,
restricted API egress enforced. The new diagnostic deliberately used empty input and
`max_output_tokens:0`, which cannot start valid generation. Through the configured proxy,
OpenAI returned **401 / `invalid_api_key`** again. No successful generation is claimed.

Earlier diagnostic history on the restored machine includes two sandbox socket denials
and one provider 401. The revision-3 retry adds another provider 401. Diagnostics were
counted conservatively in a private recovery file, not used to create fresh paid allowance.
The prior US$0.019114 held amount is recorded separately and has not been forgiven.

The current checkout is the original `e6be3b2` code. Git object/reflog/unreachable searches
and workspace/temp recovery searches did not recover `f825fe0`, the original budget, old
run evidence, full patch or prior four documents. The screenshot confirms the interrupted
file list but cannot restore source contents. The current source was not modified for
these credential diagnostics; the recovery document pack is new documentation only.

## Required next steps

1. Correct the active OpenAI API key binding securely in environment settings and publish.
   Do not paste a key into chat, repository or shell text.
2. Recover the previous prepared filesystem/change set, Git bundle or source patch. Earlier
   remote push was denied 403, so local commits are not assumed to exist on GitHub.
3. Restore exact cumulative accounting/evidence; never start replacement accounting at zero.
4. Reverify restored code/typecheck/tests, then complete only the remaining bounded first pass.
5. Report actual admitted effects, action-bearing replay and completed/pending/failed Evals
   separately. Review cost/latency before any larger trial or model.

The recovery pack preserves decisions and known results while exact source/accounting and
credential recovery remain blocked. It does not certify the restored old server as safe
for a hosted participant.
