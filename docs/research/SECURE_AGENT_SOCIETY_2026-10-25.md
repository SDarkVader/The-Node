# Implemented agent society — 25 October 2026

The new opt-in society runs the existing participant/world kernel with two initially model-controlled
Bakers and one Miller. Courier, Investigator, Import/Export and roleless residents use ordinary
deterministic policies through exactly the same observation and action validator. No paid call or
live autonomous experiment was performed for this implementation. Older worlds, histories, grants,
private journals and frozen Study 1 contracts are preserved.

## Run and inspect

From the existing local repository:

```powershell
npm run society -- --ticks 14 --seed 42 --output .codex/session-recovery/society/proof-14.json
npm run society -- --verify .codex/session-recovery/society/proof-14.json
npm run society -- --interactive --ticks 3 --output .codex/session-recovery/society/supervised-3.json
```

Outputs must be new files. The first command uses simulated model decisions from the same trusted
deterministic policy as the other residents; it makes zero model requests. The interactive command
shows each of the three controlled residents' exact view and suggested decision; Enter accepts that
suggestion, a JSON object supplies another legal choice, and `q` stops. This is supervised local play,
not a billed model experiment. All decisions and complete reproducible transitions are retained in
the private tape, including the exact legal menu and schema. Tape verification reconstructs a fresh
world, compares every view and action, and compares the complete resulting evidence and state hashes.
Files use the lossless `node-society-evidence-v1` envelope: readable observations/actions are under
`value`; `specialValues` retains hash-significant optional undefined fields and negative zero.
Plain JSON was found to drop those configuration fields during file-based verification and was
replaced before delivery. Codec tests reopen both a full tape and a prepared plan. Earlier private
`42591f4` plain-JSON trial artifacts are retained as failed serialization evidence, not final proof.

For natural environmental changes without event injection, use the same unmodified configuration
and seed `20261025` for 60 ticks. Its first 14 ticks have calm District Weather; the longer test
observes real churn and changing tension. This is mechanical coverage, not an evaluation of reasoning.

## Information and execution boundary

The leak was traced to `buildPerceptionAgentInput` and the historical rules/request pipeline:
source paths, renderer/profile data, experiment wording, request IDs and world hashes were sent
as inhabitant context. The old global observer also lists every inhabitant and station. Repository
package descriptions and arbitrary development-update text were not found in those constructors;
establishing the exact provenance of a particular historical sentence requires that run's private
request bytes. Do not invent a source attribution from an agent's recollection.

`src/society/boundary.ts` now constructs an explicit nested allowlist: local people/places, coarse
station heat, local District Weather/condition, own holdings and input costs, earned recognition,
own currently retained diary, own degraded hearing/rumours and own dealings. Exact other-person
production decisions, holdings, diaries and intentions are absent. Public role descriptions explain
all six current role states. Baker quotes are public on the Wall; resident posts continue through
the existing rumour propagation/degradation rather than a new raw global feed.

`src/society/request.ts` accepts only an original frozen boundary view. Its current-view model
request carries public rules and a six-field schema; it has no tools or old experimental transcript.
The independent one-shot egress worker checks its bound request and safe shape before reading a
credential. The model never receives operator paths, journal data, provider controls, hash bindings
or worker interfaces. Output is parsed as data only. Invalid/out-of-menu actions halt the society;
unknown usage, failed evidence writes, wrong models, deadlines and response tool blocks halt the
accounted runner without retry. Usage is booked before action validation. Unknown outcomes retain
their full hold. These are application boundaries, not a claim to sandbox arbitrary same-user code.

Historical paid CLIs and direct workers are now gated closed. Their exact request constructors and
verifiers remain available for archived replay and offline fixtures. No history is rewritten to
pretend that a past leaking request was clean.

## Daily choices and economy

Each day has two phases. In `commit`, each current Baker can set a price in **[0,2]** and each
Miller a quantity in **[0.01,1]**. These bounds come from the original brief and existing validated
kernel. Null retains the previous commitment. All commitments resolve together before any daily
customer choice, then lock. In `act`, every present inhabitant can stay or move one legal plot,
communicate, write an eligible diary, choose a due bread order or defer, and enter/redeem/decline
the Oracle. Support role holders can work or decline. Act views show the person's own new commitment.

Existing directional recognition, hearing range/degradation, constrained grammar, speech-before-move,
diary subject eligibility, two-day expiry and drift remain authoritative. Neither raw Wall delivery
nor a role icon grants recognition. Personal impressions remain authored, not mechanically certified.

The society economy uses actual grain-limited flour and actual finite flour for bread. Customer
choice changes receipts, real provider/recipient dealings, sales, income and competitive completion.
Affordability, twelve-customer capacity and the established stable weekly due day are enforced.
There is no hidden fallback purchase from a different Baker. A quote is an offer, not a guarantee.
Import/Export work affects grain; Courier work affects real deliveries; Investigator work affects
coverage and inquiries. Declining does not secretly pay the normal occupational wage/completion.
Vacant/backstopped slots retain their mechanical recovery and production rules.

Material assumptions resolved without changing old defaults:

- Human society day is `world.tick + 1`; kernel event timestamps retain their existing zero-based
  convention. The default world configuration, old RNG paths and historical contracts are unchanged.
- A bread order preserves the existing daily activity multiplier: **0.7 bread-equivalents**, payment
  **posted price × 0.7**, flour consumption **bread × 0.2**. Public rules explain this scaling.
- Bread payments fund the existing district pool. It settles preserved Baker `max(0,price−flourPrice)`
  margin claims and Miller income on actual flour sold. A receipt is not a second direct seller
  credit. This avoids silently replacing the established cost equation with `price−0.2×flourPrice`.
- The sole Miller completes only on real positive flour sales; no fictional rival is introduced.
  Multi-Miller configurations retain the existing rival comparison plus actual sales. Baker
  completion requires both competitive pricing and a genuine sale. Existing funded rewards apply.
- Nearby heat is presented in thirds of its established scale; it does not disclose the Miller's
  exact private commitment. This changes the society's observation, not the underlying heat mechanic.
- The selected temporary Oracle opportunity is a prepaid entry voucher, not a permanent role prize.

## Oracle

Explicit optional entry preserves `oracleWinProbability` and eligible weighted fair prize selection.
The visible menu gives the current **5%–30%** win chance, **0.3** entry cost, bounded **0.3** wealth or
**+1 capped current-role stock** awards, and conditional prize chances. The former time-nudge result
in this new society instead reserves one entry cost from the Oracle pool for a personal voucher
valid on the next three days. Legacy Oracle behavior is preserved outside this mode.

Voucher redemption pays the ordinary entry cost from escrow and draws with the ordinary chance;
it cannot guarantee a win or grant/bypass a role or eligibility. One entry per day and one voucher
maximum apply. A repeat voucher prize pays the bounded wealth award without extending the held
voucher. Expiry returns escrow even when the inhabitant abstains or departs. Wealth, pool and
escrow are conserved. No new permanent standing, tenure or cross-role resource is awarded.

## Separately approved model run

The new accounted adapter is implemented and tested with a simulated sender and synthetic journals.
Its default is three ticks/eighteen calls; explicit plans allow up to twenty ticks/120 calls for the three controlled inhabitants, with the
same high-effort request and 2,048 output-token cap. It creates no allowance. It requires a reviewed
plan, owner approval tied to its hash, and an already authorized empty allowance carrying the latest
actual accounting history. There is no historical-world resume or budget-reset shortcut.

Prepare a concrete private plan after committing source (no credential, allowance or API call):

```powershell
npm run society:live -- --prepare --ticks 3 --bundle C:/Users/steve/Documents/Codex/node-society-approved-plan.json
npm run society:live -- --preflight --bundle C:/Users/steve/Documents/Codex/node-society-approved-plan.json
```

The future approved execution form is:

```powershell
npm run society:live -- --owner-approved --bundle <reviewed-plan.json> --budget <approved-allowance-directory> --carried-fingerprint <reviewed-latest-history-sha256> --approval <owner-approval.json> --credential <private-Anthropic-key-file> --output <new-private-run-directory>
```

The approval JSON is `{ "approved": true, "planSha256": "<reviewed hash>", "instruction": "<owner's exact approval>" }`.
Its instruction must match the allowance authorization. Paths must remain outside the repository;
Node 24+ is required for this proxy-aware worker. The provider credential is read only in the
separate one-shot worker after the real reservation. No API call, free token count, allowance
creation, approval file or credential read was performed here. Actual funding/approval for this
new plan has not been supplied; the existing consumed grants are not authorization.
The terminal reports each validated proposal before submission; outcome events and the tape separately prove submission. Ctrl+C stops further dispatch without retry. All exits attempt partial tape, summary and raw dump writes.

The owner subsequently authorized a twenty-tick run and supplied the latest actual journal. This request supersedes the earlier no-call status for that one bounded run. The requested deliverable is raw data only: `npm run society:dump -- --input <private-run> --output <new-private-dump> --raw`. Per-identity JSONL retains exact context, choices, provider-returned summaries, proposed/validated/submitted actions, shared transitions and explicit unavailable responses. No hidden reasoning is reconstructed.

## Evidence and further work

Automated tests cover leakage, role descriptions, illegal actions and halt, transaction constraints,
same-seed complete replay, evidence tampering, all roles, natural environmental change, Oracle
population balance, and accounted transport/usage failures. At source `acb0d0b331440f0351909d10ae2aede89b886064`,
all **1,568 Vitest tests / 131 files pass**, with zero failures and seven explicit skips: six real-Godot
cases require `NODE_GODOT_BIN`, and one POSIX fake-PowerShell test skips Windows. TypeScript passes.
The compiled broker/participant runner passes **80 checks** against original `4196b79`; eight recovery
tests pass. These native checks ran on `42591f4`, whose kernel/engine/participant bytes are identical
to `acb0d0b`. The old Python suite was not rerun: this checkout has no `inspect_ai` installation,
and no Python source changed. [Sanitized evidence](evidence/secure-society-offline-2026-10-25.json)
records the scope; full raw contexts remain private.

| Offline run | Decisions | Moves | Heard effects | Diary writes | Bread orders | Voucher redemptions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 14 ticks, seed 42 | 237 | 89 | 194 | 21 | 6 | 20 |
| 60 ticks, seed 20261025 | 889 | 374 | 716 | 306 | 78 | 75 |

Both lossless files replay in separate CLI processes with the exact final hashes. The longer run
observes tension `0`, `0.68`, `0.16` without forced actions/events; district state remains ACTIVE.
The largest conservation residual is `1.4477308241112041e-13`. The paid CLI's three-tick/eighteen-call
prepare and reopen/preflight also pass with no credential read, allowance or provider request.

The secure society does not yet have a Godot/observatory presentation adapter. Paid behavior has
not been observed in this new contract, and real-world economic balance has not been established.
The deterministic fallback is an explicit resident policy, not evidence of human/model strategy.
Transcript-memory experiments remain separate: this mode supplies current authorized memory only.
No reasoning-quality or causal memory-benefit grade is claimed. Frozen studies and prior results
retain their own evidence, histories and source revisions.
