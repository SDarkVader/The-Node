# Design sims

Standalone Python scripts for population-scale sanity-checking of not-yet-built
mechanics, kept separate from `src/sim/` (the production TypeScript simulation harness
for what's actually implemented). Nothing here is wired into the game engine — these are
exploratory checks run once, by hand, to sanity-check a mechanic's population-level
behavior before it's designed further or built.

Requires `numpy` (`pip install numpy`).

- `exit_ticket_gamble_sim.py` — proportional-stake exit-ticket gamble, see
  `docs/DESIGN_ADDENDUM_2026-08-06.md`. **Has a known stake-direction bug, flagged at the
  top of the file and in the design addendum — not yet fixed, pending confirmation of the
  corrected formula.** Superseded 2026-08-07 by the postcard/tier system below — kept for
  the record, not deleted.
- `postcard_tier_verify.py` — independent verification of the postcard/tier exit-ticket
  system's §6 simulation findings, see `docs/DESIGN_ADDENDUM_2026-08-07.md`. Not the
  original simulation (that lives in a different local sandbox, never pushed here) — a
  fresh model built from the addendum's prose, used to check the reported numbers rather
  than to author them. No dependencies beyond the stdlib.
- `node_core_reference.py` / `node_core.ts` — the validated reference implementation and
  cross-checked TypeScript port for the ecosystem-scale mechanics (economic floor,
  detection, experience, migration valve, sabotage, districting), see
  `docs/NODE_BUILD_SPEC_2026-08-07.md`. Kept here as the exact artifact that was actually
  run and confirmed (`ALL TESTS PASS`, both languages) before its logic was ported into
  `src/engine/ecosystem.ts` — provenance, not the thing to import from. No dependencies
  beyond the stdlib (Python) / nothing beyond `tsx` (TypeScript, run directly, not part
  of the real `src/` build — see `tsconfig.json`'s `include`).
- `tick_order_check.py` — confirms sabotage-before-arrival vs. sabotage-after-arrival
  within a single tick makes negligible difference to the long-run average (0.424 vs.
  0.423) — ported as a permanent regression in
  `test/ecosystem.regression.test.ts` rather than left as a one-off script only.
