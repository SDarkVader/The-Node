# NODE

*Nobody is fully anonymous here. Nobody is fully known either. Everyone knows
something; nobody knows everything. There's always another shard to run to —
but what the node did together, it did for good.*

There's no combat in NODE. The tension comes from somewhere quieter: you can
never be sure who knows what about you, whether the price you just saw is
real or a message, whether the shop that's been quiet for three days is a
coincidence or a squeeze. A node holds somewhere between 50 and 80 people.
Small enough that everyone is, eventually, someone's business. Big enough
that you'll never actually know all of them.

The world is built to sit permanently a little uphill — never comfortable
for long, never actually collapsing either. If a place ever starts to feel
safe, that's the system telling on itself. Somebody's about to notice.

## Project status — 20 October 2026

**This `main` branch is not the latest development line.** Its documented baseline is the August 2026 multiplayer simulation and Godot client. More recent broker, agent-context, accounting, security and recovery work is maintained on [`broker-rules-context-2026-10-18`](https://github.com/SDarkVader/The-Node/tree/broker-rules-context-2026-10-18). **Do not assume the development branch's features, tests or files are present on `main`.** Check the branch and source before running, changing or reporting anything.

For current development, begin with the development branch's [`AGENTS.md`](https://github.com/SDarkVader/The-Node/blob/broker-rules-context-2026-10-18/AGENTS.md), [GitHub-first continuation contract](https://github.com/SDarkVader/The-Node/blob/broker-rules-context-2026-10-18/docs/recovery/GITHUB_FIRST_CONTINUATION.md) and [current session checkpoint](https://github.com/SDarkVader/The-Node/blob/broker-rules-context-2026-10-18/docs/recovery/CURRENT_SESSION.md). Those are the cross-device source of shared, sanitized project context; no local PC or previous conversation is required to read them. Verify the live development branch HEAD rather than relying on a fixed SHA.

### What exists on this branch

The August baseline includes a TypeScript social-economic world with a Miller/Baker supply chain, Courier and other roles, a multi-shard registry, district conditions, constrained social communication, presence, reputation and an Oracle. The Godot client provides an isometric world view and visual signals for stations, districts and movement. These are **historically documented implementation claims** for `main`, not a new test run or a guarantee that every proposed mechanic is complete.

The simulation is designed around partial knowledge, temporary private memory, persistent collectively witnessed events, noncombat social consequences and deterministic mechanics. The [original build brief](docs/NODE_Build_Brief_v1.pdf) defines the design intent; [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) describes implementation and invariants.

### Work on the active development branch

The development branch adds offline participant/broker integration, durable execution and replay protections, reconstructed accounting controls, a Responses provider adapter, rules-aware agent context and deterministic evaluation fixtures. See its [rules-aware context evidence](https://github.com/SDarkVader/The-Node/blob/broker-rules-context-2026-10-18/docs/recovery/RULES_AWARE_CONTEXT.md) and [recovery documentation](https://github.com/SDarkVader/The-Node/tree/broker-rules-context-2026-10-18/docs/recovery).

Its last recorded rules-context stage reported **1,143 Vitest tests, 80 native checks and passing TypeScript**, but these are stage-specific recorded results, not tests rerun for this README update. The deterministic memory fixture reported eight of eight with legitimate memory, four of eight without, and eight of eight after replay restoration. That does **not** establish real model comprehension or live multi-turn strategy.

**Added on 20 October 2026** (development branch, now at `41da84f`; see its [DEVLOG](https://github.com/SDarkVader/The-Node/blob/broker-rules-context-2026-10-18/docs/DEVLOG.md) and [settlement design](https://github.com/SDarkVader/The-Node/blob/broker-rules-context-2026-10-18/docs/DESIGN_SETTLEMENT_FLOW_BALANCE_2026-10-20.md)):

- **Settlement ledger.** Every wealth change in a tick is a named payment, a transfer between accounts, or money leaving with an emigrant, and nothing is destroyed. The default "funded" mode makes wealth follow the person through role changes; the dock pays for each tick's nodules, wages come from a district pool (the grifter income floor first), and upkeep is the sink that keeps holdings bounded. The previous economy remains available as a byte-identical "legacy" mode. Measured before → after: new money per tick 45.8 → 6.3, and losses at role changes 37.9 → 0.
- **Import/Export can never be fully vacant.** At least one slot is always staffed or backstopped, so nodule income never drops to zero.
- **Migrants carry their holdings between shards**, and a failed crossing returns them to the departure shard's dock.
- **Dormant shards no longer hold staffed Import/Export slots with nobody in them** (a bug fix).
- **Alternative shards no longer depend on population.** Opening used to require an average of 100 people per shard, which could only happen on the first day or two. A fixed cap of three shards replaces it, and migration is unchanged.

Verified at `41da84f` on 20 October from a fresh clone: **1,177 Vitest, passing TypeScript and 7/7 session-recovery tests**. The 80 native checks were not rerun, because they need private baseline files that a fresh clone doesn't include.

**In review:** an [Inspect AI safety evaluation harness](https://github.com/SDarkVader/The-Node/tree/inspect-safety-evals-2026-10-20) (branch `inspect-safety-evals-2026-10-20`, pull request into the development branch). It runs an agent through the real participant pipeline using scripted fixtures and Inspect's offline mock model only, so it makes no model API calls. Independent scorers keep observed actions, inferred intentions and simulation failures separate, and results are classified against the NIST AI RMF. Verified from a fresh clone: 29 samples deterministic across two runs, 29/29 replays, and 56/56 fixture checks. Real-model runs stay blocked until they go through the accounted broker and budget ledger. See that branch's [`docs/EVAL_INFRASTRUCTURE.md`](https://github.com/SDarkVader/The-Node/blob/inspect-safety-evals-2026-10-20/docs/EVAL_INFRASTRUCTURE.md).

Known development gaps include automatic diary/event connections, full restricted trespass transactions and held-out live-model evaluation. Several settlement questions are open design decisions rather than defects: the currency question, whether the lower inequality under funded settlement (Gini 0.68 → 0.32) is the intended feel, and whether the world should ever grow beyond three shards. Historical private accounting evidence and the original held reservation are not reconstructed merely by cloning GitHub. **Do not initialize/reset budgets, assume private runtime state is available, or launch paid model requests without explicit authorization and verified prerequisites.**

### Run the checked-out branch

```bash
npm install
npm test
npm run typecheck
npm run sim
npm run server
npm run playtest
```

These commands are available in the repository; actual results depend on the checked-out branch and environment. The Godot setup is described in [`client/README.md`](client/README.md). To work on the latest development line, explicitly switch to `broker-rules-context-2026-10-18` first and read its handover.

### Project documentation

[Blueprint](docs/BLUEPRINT.md) records mechanics and invariants; [development log](docs/DEVLOG.md) records implementation history; [historical handover](docs/HANDOVER.md) preserves earlier session context; and the [build brief](docs/NODE_Build_Brief_v1.pdf) captures original design intent. The historical handover on `main` is **not** the authority for current cross-device development: use the active development branch's Git-tracked checkpoint.

**Branch policy:** this README update documents the state of `main`; it does not merge the development branch or change runtime code. Continue active work on the agreed development branch unless explicitly directed otherwise.
