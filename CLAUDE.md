# Working on NODE — session rules

**Assumption is the mother of all fuck ups.** (2026-08-13, user directive.) Bring up real
issues when you find them — directly, with evidence, no hedging and no attitude about it —
but don't assert something you haven't actually checked, and don't hold up real work on a
question you could resolve yourself by reading the code or running it.

NODE is a persistent multiplayer social-economic game. The design source of truth is
`docs/NODE_Build_Brief_v1.pdf` — its §0 (design intent) and build order are load-bearing;
everything else in it is an explicitly revisable hypothesis. Read it before starting work
if you haven't already.

## Cross-device orientation and branch policy (2026-10-18)

`AGENTS.md` is the common entry point for Codex and other repository-aware assistants.
Follow its GitHub-first contract: read `docs/recovery/GITHUB_FIRST_CONTINUATION.md`
and `docs/recovery/CURRENT_SESSION.md` from the current development branch, verify
Git HEAD and inspect relevant source before making claims or edits. This applies to
Claude as well; do not use this file to select a different branch or handover.

The shared development line is `main`, following PR #22 merge `acb3b2d` on
2026-10-20. Read CURRENT_SESSION.md and actual Git refs before further work.
Continue on the user's agreed branch and do not silently switch to `main`, merge,
or create a feature branch. The older August instruction to work directly on
`main` was intended to prevent stranded, unpublished work; it is superseded
for this development line by the explicit GitHub-first branch contract.
A future branch change requires the user's direction. Commit and push sanitized
handover updates so a fresh phone, cloud or PC session can resume without a local
machine. Never assume ignored/uncommitted files or private runtime state exist
on GitHub. No paid model calls or budget reset without explicit authorization.

## Documentation rules (mandatory every session)

1. **Primary orientation:** `AGENTS.md` →
   `docs/recovery/GITHUB_FIRST_CONTINUATION.md` →
   `docs/recovery/CURRENT_SESSION.md`. These define the active branch, completed
   work, current gaps, evidence boundaries and next steps. Read the relevant
   implementation and scoped evidence before continuing.
2. **Historical orientation:** `docs/HANDOVER.md` is valuable background, not a
   competing current-session authority. Resolve older status claims against the
   active branch, current source and verified evidence; do not blindly overwrite
   the current checkpoint from a historical handover.
3. **Log development** in `docs/DEVLOG.md` chronologically, including failures,
   reversals and evidence. Keep `docs/BLUEPRINT.md` as a map of implemented
   constants, state, flows and invariants, with decisions and reversals in
   `docs/BLUEPRINT_HISTORY.md`. Preserve the original design constraints.
4. **After meaningful work**, update `docs/recovery/CURRENT_SESSION.md` and,
   when the shared continuation contract changes,
   `docs/recovery/GITHUB_FIRST_CONTINUATION.md`. Commit and push the sanitized
   context on the agreed branch. Update root `README.md` alongside the checkpoint
   for feature, behaviour, verification, branch-integration or next-step changes,
   following `AGENTS.md`'s README contract. Keep one current overview and dated
   evidence links; do not stack historical status banners. Keep `docs/HANDOVER.md`
   accurate when affected, distinguishing current state from historical stages.
5. **Local recovery is optional:** `.codex/session-recovery/` and Codex hooks
   can preserve unpublished machine-specific work but are not prerequisites
   for GitHub-first continuation. Never publish secrets, private game state,
   experimental inputs or accounting journals in tracked documentation.

## Build order

Follow the brief's phase order (§0, §8): Phase 1 (economic core) before anything
player-facing, then the two-Baker-plus-rumour-mill MVP slice (§8) before full Phase 2–6
builds. Don't jump ahead to later phases' polish while an earlier phase's regression tests
(§1.4, §2.4) are unverified.

## Standing design constraints (from `docs/ECOSYSTEM_VISION_2026-08-06.md` §6)

Binding on everything built beyond the single-shard core, not just narrative — check new
work against these before shipping it, the same way the documentation rules above are
checked every session:

1. **Simulate before trusting, every time a mechanic gets new reach.** Population-check
   against a deterministic baseline before accepting a mechanic works, the same way the
   exit ticket gamble and the Phase 1 §1.4 findings were verified, not just derived.
2. **No permanent zero-state, at any scale.** Before shipping any new system, ask: does
   failure here ever produce a state nothing can recover from? If yes, it doesn't belong
   in this design — whether that's a player, a role-slot, or eventually a whole shard.
3. **Ask "does this need to be an agent" before building anything new.** Anything with
   behavior, motivation, or belief to infer is a deception surface. Minimize what's
   modelable, at every scale, by default — this is why the vacancy backstop and the Oracle
   are both mechanical, not behavioral.
4. **Personal memory is mortal; civic memory is immortal — and nothing in between gets
   invented.** (Rewritten 2026-08-08 to resolve a real contradiction — see
   `docs/BLUEPRINT.md`'s "Open deviations" for the full reasoning; do not silently
   re-read this as "nothing whatsoever persists," that reading is now wrong.) The test
   to apply: does this record capture an event the node collectively witnessed, or does
   it capture an individual's private expression or judgement? The first may persist —
   public, collectively-witnessed events (what happened in a node, monuments, the
   Wall's Emissive Soul, Ghost Shard missives) are civic memory, and the city is
   allowed to remember what it did. The second must not — anything one player privately
   holds about another (diary entries, what they heard, private impressions, proximity
   conversation) decays or expires; no private dossier ever persists, and no
   cross-session or cross-shard per-player trust score is ever built, full stop. Any
   future system touching player expression should be built so there's nothing captured
   in the first place where the *private* side of this line applies — this is why voice
   is a constrained grammar, not real audio, and why the diary uses a hard TTL rather
   than accumulating forever.
5. **Let outcomes be real, don't script them.** Shard death, rejuvenation, migration
   patterns, which shards thrive and which stay thin — none of it gets authored. The
   system's job is to make every outcome genuinely possible and consequence-bearing, then
   get out of the way.
6. **Reputation may only ever grant, never remove.** Every player holds an untouchable
   baseline of visibility and access earned simply by being present and doing their
   role day to day. Reputation sits *on top of* that baseline: it can unlock deeper
   visibility, standing, and access, but no accumulation of negative signal may ever
   push a player below the floor. The worst any group can do to a player is decline to
   elevate them — never bury them, never make them invisible, never lock them out. Any
   mechanic that subtracts from the baseline is out of scope by default, at any scale.
   (Added 2026-08-08 — no reputation system exists in code yet; this constrains it
   before anything gets built, not after. Composes directly with constraint 2 above [no
   permanent zero-state] — this is that principle applied specifically to social
   standing — and with constraint 3: exclusion is the failure mode this design is most
   exposed to, and a subtractive reputation system is structurally an exclusion engine.)

## Commands

```
npm install
npm test         # regression tests
npm run sim      # prints a stability-curve sweep to stdout
npm run typecheck
```
