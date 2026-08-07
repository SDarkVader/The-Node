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
