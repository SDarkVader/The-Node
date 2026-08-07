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
  corrected formula.**
