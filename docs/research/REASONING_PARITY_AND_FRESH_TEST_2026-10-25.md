# Reasoning conditions and the fresh twenty-tick check

Updated 2026-10-25. **The owner requires readiness and a separate approval before starting
the new paid run. No new provider call or allowance activation has been made.**

## Evidence and diagnosis

The initial private file independently verified through tick 18: 36 calls, with summaries
on 13 turns for `baker-0` and six for `baker-1`. Its original bytes remain preserved.
The owner's subsequent ledger includes the complete 28-tick legacy parent and the later
environmental continuation from ticks 28–38. Independent legacy recovery now confirms the
original reported counts: **14/28 for `baker-0`, 8/28 for `baker-1`**. Exact histories,
requests, responses, receipts and original world replay pass for the complete parent chain.

The later twenty archived decisions confirm **2/10 versus 1/10** additional summaries,
matching the owner's scanned report. Their hash chain, response hashes, production parser
results, usage bookings and exact retained own-history prefixes pass independent checks.
Both actors start that segment with 28 prior assistant turns. The complete 38-tick world
tape replays with the existing compiled kernel to the recorded final hash. All twenty
proposals are null actions; all stops are `end_turn`, with no redactions or input transformations.

The later segment uses the distinct `perception_*` ledger format and names runner source
`47291c82535a542d1760a6563fc818e24480fa2c`, unavailable in the local clone or GitHub at inspection.
Its actual wire bytes have the same reasoning controls and system hash below, unchanged
from each actor's signed parent. Full reconstruction of perception packets, worker agreement
and request construction still requires that source; world-tape replay does not establish
those additional checks. The actual latest allowance journal is also still pending.
[Sanitized audit results](evidence/reasoning-parity-private-archive-audit-2026-10-25.json)
separate completed checks from these remaining checks. No new provider request was made.

Every actual archived request across both supplied files has the same system prompt and
reasoning controls for both actors:

- Model: `claude-haiku-5-5`.
- Thinking: `{type: "adaptive", display: "summarized"}`.
- Effort: `medium`.
- Hard total output cap: 2,048 tokens, including native thinking and final text.
- System SHA-256: `b052321f0629bc0e34f56adc9ae00a1c8576a56b906b8c534edcb1c4bb3906f3`.

There is no actor-specific lower budget, effort, missing system guide or dropped checkpoint
prefix. All responses ended with `end_turn`; none was truncated, redacted or accompanied
by an input-transformation report. The parser records genuine absence; it does not discard
Baker 1's blocks. Own observations and received conversation contents differ legitimately.

The configuration left thinking optional. Its memory guidance asks the actor to reconsider
earlier thinking, but does not explicitly ask for deliberation before **every** decision.
The shared instruction “Return schema JSON only” also does not explicitly distinguish the
native thinking channel from the final action text.

The [current Anthropic steering documentation](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost)
states that thinking is selected per request, can be skipped even in a retained conversation,
tends to decrease as conversations grow, and is not guaranteed at any effort level.
The [Haiku 5.5 prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5)
states that effort replaces the old `budget_tokens` control and describes `high` for longer
tasks and strict instruction following. These pages were read directly on 2026-10-25.

Thus the verified discrepancy is provider-side adaptive triggering under different own
contexts, with equal request controls. The precise model-internal reason for a particular
omission is not exposed by these records; attributing it to one observation or earlier
thought would require an appropriate controlled comparison. Equal caps do not promise equal
thinking-token use or equal summary counts.

## Versioned configuration fix

The opt-in `per_turn_deliberation_v1` continuation condition gives both actors:

- Adaptive summarized thinking at the same explicit `high` effort.
- The same 2,048-token hard total output cap. No unsupported fixed thinking budget is sent.
- An identical system instruction to deliberate before each decision, including routine
  ticks, and to assess changes, retained-memory reliability and legal actions.
- The identical explicit reminder on **every** user turn, kept separate from observation data.
- A statement that schema JSON constrains the final action text; no reasoning field, invented
  explanation or extra prose is added to the four-field action contract.

Absence remains observable. The runner never fabricates a summary, adds an automatic paid
retry, or silently substitutes a response just to equalize counts. High effort can consume
more of the existing output cap; `max_tokens` remains a booked, non-actionable stop.

Omitting the profile preserves all legacy continuation bytes and frozen Study 1 pins.
The profile is bound to the plan/allowance and parent contract. A resumed conversation cannot
silently switch profiles or rewrite its system. Anthropic explicitly warns that changing
`system` while resending signed thinking can return HTTP 400. The owner's selected test is
fresh, so both actors receive the new system from genesis with no inherited context.

## Prepared test, not an authorization

Configuration: [two-baker-reasoning-20-ticks.json](../../experiments/two-baker-reasoning-20-ticks.json).
Two Baker identities, seed 103, fresh genesis, 20 decision rounds and at most 40 paid calls.
Human rounds 1–20 correspond to the unchanged kernel's canonical source ticks 0–19.
There is no parent ledger and no resumed model context.

The draft proposes a new allowance cap of USD 1 conservatively booked, at most 40 requests,
USD 0.03 per-request admission, and a 24-hour window. With the existing reviewed prices and
95,000-byte request bound, the full-request conservative ceiling is 21,868 micro-USD per
call and 874,720 micro-USD over 40 calls. These are bounds/proposals, not an invoice or
an activated grant. The clock must start only after the owner approves a ready test.

Readiness also requires the actual latest accounting journal, with no unresolved holds and
an eligible closed prior grant for the existing carry mechanism, plus an approved credential.
Source-only or synthetic accounting must never replace that journal.

Credential provisioning completed on 2026-10-25: the owner's encrypted upload authenticated
against the existing cloud recipient and was imported outside the checkout with mode 0600.
Read-only readiness at source `00ac75a` passed the credential format/permissions and uniform
fresh-request conditions. Provider authentication is untested. Funding remains
`actual_journal_not_provided`, so `readyForOwnerApproval` and `dispatchApproved` are false.
The actual latest `accounting.journal.json` is still needed; the previously supplied continuation
ledger is already preserved privately and does not replace the journal. No allowance was
created, no allowance clock started and no provider request was sent.

Offline preparation commands:

```sh
npm run continuation:reasoning-audit -- <actual-private-ledger> <NEW-private-audit.json>
npm run reasoning-test:rehearse -- <NEW-private-offline-directory>
npm run reasoning-test:readiness -- <NEW-private-readiness.json> --journal <actual-journal> --credential-file <approved-private-env>
```

The audit exports hashes, controls, counts and usage, without raw prompts, observations,
thinking text or signatures. Rehearsal uses an explicitly synthetic provider and budget;
its emission counts do not verify Haiku behavior. Readiness creates no allowance and sends
no provider request. Missing credentials/accounting are reported as missing, never as zero.

After code verification, build a committed runtime with the existing build script. Only
after explicit owner approval and proper real-budget authorization may the separate gate run:

```text
node scripts/run-fresh-reasoning-test.mjs <committed-runtime> <approved-new-allowance> <NEW-private-artifacts> <approved-credential-file> --owner-approved-fresh-20-ticks
```

This wrapper accepts no resume option and checks the compiled runtime's actual initial wire
conditions before opening the budget. The underlying runner still enforces every existing
accounting, request-bound, usage, validation and kernel gate. The actual live check must report
thinking presence, nonempty-summary emission, truncation, usage, latency, proposals and effects
per actor, separately from any evaluation of decision quality.

## Credential transfer from Termux

The exact variable read by both workers is `ANTHROPIC_API_KEY`, from an Anthropic Console API
key for the intended account/project. The workers send it as `x-api-key` to the fixed
`https://api.anthropic.com/v1/messages` endpoint. A Console key's display label is your choice;
it does not replace the environment variable name.

`scripts/credential-envelope.mjs` supports encrypted local transfer using a cloud-provided
public key. The Termux sender uses ephemeral X25519, HKDF-SHA256 and AES-256-GCM. It transfers
only the Anthropic entry from an existing .env file, or accepts the key through stdin. It
does not execute .env content, log plaintext, perform network calls or dispatch a model.
The cloud decryptor writes an exclusive private file outside Git with mode 0600.

Use an already working Node installation; the helper needs Node 18+ and no npm dependencies.
Do not replace a working Termux LTS installation just for this helper. A newly installed Node
that cannot find C++ symbols may need its `libc++` package brought up to date before it can run.
Neither the plaintext credential nor the cloud transfer private key belongs in Git or chat.
Provisioning a credential does not approve or start the experiment.

Run the helper's credential-free `check <cloud-public-key> [encrypted-output-file]` before
entering a key if a device has failed to seal it. This tests crypto and the recipient and
reports whether an encrypted file already exists; it reads no credential. Failures report
only a stage and fixed error code, never the native error message, stack or secret value.
