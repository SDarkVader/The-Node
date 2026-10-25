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
`47291c82535a542d1760a6563fc818e24480fa2c`. The owner identified the newly opened
[foundation PR #40](https://github.com/SDarkVader/The-Node/pull/40) and dependent
[runtime PR #41](https://github.com/SDarkVader/The-Node/pull/41). The source is preserved in
#41's ancestry; its runtime code is unchanged at that PR's head. A clean exact-source
checkout compiled, its full perception verifier passed on the actual archive, and nine
perception-continuation plus four frozen Study 1 tests passed. Request reconstruction,
audit bindings, exact signed histories, admission, costs and world replay now verify.
The actual latest allowance journal is still pending, so current journal binding is not claimed.
[Sanitized audit results](evidence/reasoning-parity-private-archive-audit-2026-10-25.json)
record the source-pinned verification. No new provider request was made.

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

## Owner-selected fresh first-person test, pending approval

The owner explicitly selected **first-person Godot perception from PR #41**, beginning at
fresh genesis with no prior model context. The earlier original-observer proposal is not
the selected condition. Configuration:
[two-baker-first-person-reasoning-20-ticks.json](../../experiments/two-baker-first-person-reasoning-20-ticks.json).
Two Baker identities, seed 103, 20 rounds and at most 40 paid calls. Human rounds 1–20
correspond to canonical source ticks 0–19. Financial history is carried independently;
no old experiment conversation or world is attached as a parent.

The cloud branch imports the perception, context, independent-worker and Godot geometry
components from #40/#41. The shared accounted loop now supports a separately versioned
fresh start with a common first-person system, high effort and the explicit reminder on
every turn. Historical continuation request construction stays compatible; the actual
38-tick archive also verifies through the integrated backend. This is component integration
into #39, not a merge of #40/#41 into main or a claim that their separate interface branches
have been fully reconciled.

Two separately launched Godot workers must agree before each agent receives its packet.
The real host remains authoritative. Fresh and historical perception prefixes are verified
before the web/Godot observatory displays them, including requests, actual returned summaries,
admission, effects, usage and historical cursor selection. A01 diary adherence is explicitly
`not_applicable` in this narrower condition: no recognized diary subjects are supplied and
the action schema requires `diary=null`. Hidden social state is not used to grade that agent.
The existing Inspect execution-share evaluation remains separate from execution and is not
a reasoning-quality score.

The proposal caps the new allowance at USD 1, forty paid requests, USD 0.03 per-request
admission and 24 hours. The explicit counted-input profile allows 200,000 serialized bytes
with the unchanged 100,000-input-token ceiling. A free count plus schema/overhead margin
must fit before each paid dispatch. Both actors have the same 2,048 total output-token cap
and 20-second response deadline. Conservative bounds are **22,048 micro-USD per request**
and **881,920 micro-USD over forty requests**. At most forty free counts accompany them.
These are proposals/bounds, not spending, invoices or an activated clock.

The owner's authenticated encrypted credential upload is installed privately with mode
0600. Its format/permissions pass local checks; provider authentication is untested. Actual
funding remains `actual_journal_not_provided`. The latest `accounting.journal.json` must pass
its checksum, full accounting replay and exact binding to the supplied latest ledger, with
no unresolved holds or overrun and a closed prior grant. An older journal is rejected.
Neither the archive nor synthetic rehearsal accounting replaces this file.

Offline preparation, using an actual installed Godot binary:

```sh
NODE_GODOT_BIN=/path/to/godot npm run reasoning-test:rehearse -- <NEW-private-offline-directory>
NODE_GODOT_BIN=/path/to/godot npm run reasoning-test:readiness -- <NEW-private-report.json> --ledger <actual-latest-ledger> --journal <actual-latest-accounting.journal.json> --credential-file <approved-private-env>
```

Readiness starts no allowance, count request or provider call. The rehearsal uses real
Godot processes and kernel transitions but explicitly synthetic provider responses, counts
and accounting. It does not verify Haiku emission. Missing accounting is never assumed zero.
The original-observer checks remain separately named `reasoning-test:observer-rehearse`
and `reasoning-test:observer-readiness` for their historical scope.

Build from committed source using `node scripts/build-study-runtime.mjs <NEW-runtime>`.
The bundle contains committed client/plan/transport files and its locked WebSocket dependency.
The fresh CLI verifies its own code against that bundle. A preflight can then use:

```text
node <runtime>/scripts/run-fresh-reasoning-test.mjs <runtime> <actual-latest-ledger> <actual-latest-accounting.journal.json> <NEW-private-output> <approved-private-env> <owner-instruction-file> --preflight-only
```

The latest ledger is a financial binding reference only. It is never the model/world parent.
The paid path requires replacing the final flag with `--owner-approved-fresh-20-ticks` only
**after readiness and separate explicit owner approval**. Do not run that path yet. It creates
the new carried allowance and starts its clock only after real Godot/request preflight.
No automatic retry or signature/history rewrite is permitted. The later actual live report
must distinguish per-actor summary presence, missing blocks, truncation, usage and effects
from any separately attributed evaluation of decision quality.

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
