# DESIGN — The Fines Ruleset: Crafting, Trading, Detection, and Refund

**2026-08-13. Design only — no engine code in this pass**, same discipline as everything
else this session. This document turns the tongue-in-cheek disallowed-rules mechanic
(captured piecemeal in `docs/DEVLOG.md` across several messages the same day) into one real,
coherent, buildable design — cross-referenced with, not duplicating, the trespass/key and
arson pieces already written up in `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7.

---

## 0. The ruleset, restated in full for one place to point to

1. No stealing
2. No arson
3. No trespass
4. No detected misinformation

Enforced mechanically by Journalist and Detective. Tone is load-bearing: a short, deadpan,
in-fiction "code of conduct," not a solemn legal document — matches the brief's own "a world
that never visibly risks anything reads as vanilla" tone target
(`docs/DESIGN_ADDENDUM_2026-08-06.md`).

Three structural facts, given by the user across several messages and treated here as fixed
requirements, not suggestions:

- **Nobody can go solo.** Committing a violation requires an "item"; no single role can
  produce every part of it alone.
- **Every role has a resource they produce via play, to a limit.** Parts of the item come
  from spending that resource; the remaining parts have to come from trading with players in
  other roles.
- **Fines refund the economy**, and **nodule supply keeps pace with the node's growth**, so
  the fine/craft/trade loop doesn't quietly drain or flood the economy as population scales.

---

## 1. The resource: reused, not invented

`engine/resources.ts` already gives every role a named, owned resource — this is the
"resource they produce via play" the ruleset needs, not a new economy to build:

| Role | Resource (already shipped) |
|---|---|
| Import/Export | grain |
| Miller | flour |
| Baker | bread |
| Courier | parcels |
| Journalist | stories |
| Detective | leads |

**Real gap this design has to close**: `resources.ts` tracks these as SHARD-AGGREGATE flows
(total flour milled shard-wide today), not a personal stock any individual role-holder could
spend or trade. Crafting needs a personal balance. The clean fix, checked against the
architecture rather than assumed: `RoleEconomicSlot`/`SupportRoleSlot` already carry a
per-slot `wealth: number` that accrues while occupied and resets to 0 on a new occupant
(`world.ts`'s own documented convention). A parallel `personalResourceStock: number`, same
slot, same lifecycle, is architecturally consistent — it does NOT need the persistent
cross-role-transition identity that blocked reputation levels (`docs/BLUEPRINT.md`'s
"Reputation levels" entry), because it only needs to persist for as long as someone holds
that specific slot, exactly like wealth already does. [ILLUSTRATIVE, not yet measured]: caps
at a small number (e.g. 5) per role, refilling slowly (e.g. +1 every few days a slot stays
FILLED) — deliberately scarce, so contributing to a craft is a real, felt choice against
whatever else the resource might be used for later, not a free action.

**Grifters produce no resource** (no role, no `RESOURCE_OWNER` entry) — they cannot
contribute a crafting resource directly. This is not a gap to fill; it's a real, thematically
useful asymmetry: role-holders supply the *materials*, and anyone — grifter or role-holder —
can be the one who actually performs the risky final act (§4). Division of labour is a real
option, not a requirement.

---

## 2. What gets crafted, and from what

Three items, one per "physical" rule (misinformation is handled separately — §5, no item
needed). **[ILLUSTRATIVE recipes — the exact resource mix, tune later, per the user's own
"we can name every variable in play later, just ensure we can track them easily."]**

| Item | Rule it enables | Recipe (illustrative) | Why this mix |
|---|---|---|---|
| **Key** | No trespass | 1 parcels + 1 leads + 1 stories | The three "knowledge/mobility" roles combine: Courier knows the routes, Detective knows the timing, Journalist knows the schedule. Deliberately excludes Miller/Baker/Import-Export — production roles have nothing to contribute to "knowing how to get in somewhere." |
| **Firestarter** | No arson | 1 grain + 1 flour + 1 parcels | Grain and flour are real fuel (flour dust is genuinely flammable — a small, true detail, not just flavour); Courier delivers the kit to the target building. |
| **Theft tool** | No stealing | 1 bread + 1 leads + 1 stories | Bread as something of tradeable value; Detective knows what's worth taking and when; Journalist supplies a cover story/distraction. |

No recipe repeats the same three resources — a coalition specialized for one crime doesn't
trivially double as a coalition for another, so "who's in on this" has to be decided fresh
each time, not assumed from an existing arrangement.

**Crafting is communal pooling, not bilateral trade — mechanical, not negotiated (constraint
3).** No haggling UI, no price discovery, no player-to-player transfer ledger to build. A
craft attempt is anchored to a target (an abode for a Key, a building for a Firestarter, a
building or abode for a Theft tool — see §6's open item on arson's exact target) and accepts
contributions from any eligible role-holder's personal stock until the recipe is satisfied,
at which point the item exists and is usable by whoever wants to attempt the act. This is the
concrete shape of *"so each person only knows one part of the puzzle"* — a contributor sees
"this craft needs 1 more parcels," not the full plan, not who else is contributing, not what
it's ultimately for.

---

## 3. The absence-gates, already designed — restated here for completeness only

Already fully specified in `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7.1 (trespass) and
§7.6 (arson) — not repeated in full here, just indexed:

- **Trespass**: only possible while the target is offline, or online but away from their
  abode.
- **Arson**: only possible while the target is neither actively working their role nor
  present at their abode — two presence signals, both must be absent.
- Both compose with the "above bakeries" mixed-use housing model (§1.1 of that document): a
  target's workplace and abode can be the same building, so the gate collapses to one check
  in that case, not two independent ones.

---

## 4. The act itself: reusing pattern-based sabotage's step-chain, not new detection math

`engine/ecosystem.ts` already has exactly the mechanic this needs:
`patternSabotageAttempt`/`patternStepDetectionProbability`/`detectionProbability` model a
multi-step process where each step is independently witnessable, detection risk scales with
real nearby witness count (not an assumed number), and no single step is definitively
incriminating on its own — "many individually-innocuous steps, only the accumulated pattern
incriminating" (`docs/BLUEPRINT.md`'s sabotage re-specification entry). A fines-ruleset
violation is structurally the same shape:

1. **Contribution steps** (crafting): each player's contribution to a pooled item is one
   step, witnessable by whoever's nearby when it happens.
2. **The act itself** (entering, striking the match, taking the item): one final step,
   usually the highest-witness-risk one since it's the most "visible" part of the sequence.

Reusing `patternSabotageAttempt`'s machinery directly rather than inventing parallel
detection math means: Detective's existing bonus to detection (already modeled), the existing
witness-count-scales-with-real-spatial-density behavior (`space.ts`'s density gradient, once
it's re-derived per `docs/VISUAL_FRAMEWORK_2026-08-12.md` §8's resolution note), and the
existing "no learnable pattern" discipline all transfer for free, with zero new detection
logic to design, test, or calibrate from scratch.

**Who gets caught**: same as sabotage today — a witnessed step implicates whoever performed
*that* step, not automatically the whole coalition. A contributor who was never witnessed
stays clean even if a later step in the same craft gets caught. This is a real, deliberate
asymmetry worth stating: coordinating a crime is safer than committing it, structurally, not
just by luck — which should create real social dynamics around who volunteers to do the risky
final step versus who just contributes a resource from a distance.

---

## 5. Misinformation is different in kind — no item, no crafting

"No detected misinformation" doesn't fit the crafted-item shape at all, and shouldn't be
forced into it. It already has a real, complete mechanical home: the rumour mill's
decay/distortion tracking plus Journalist's wall-post pressure detection
(`docs/BLUEPRINT.md`'s 2026-08-12 item 1 entry, `engine/pressureDetection.ts`). A wall post
that accumulates enough distortion/pressure to cross the existing detection threshold IS the
"caught" event — no new mechanic, no resource, no coalition required, because spreading
misinformation is (by the rumour mill's own design) already something one player can do
alone, unlike the other three rules. The fine (§6) applies the same way once detected; nothing
else about this rule needs building.

---

## 6. Fines: a real economic penalty that refunds, not vanishes

**On detection**: the caught player pays a fine — [ILLUSTRATIVE] amount, deducted from
whatever wealth/resource-stock they hold at that moment, clamped at 0 (never negative wealth,
consistent with every other wealth floor already in this engine).

**The fine refunds into the economy rather than disappearing** — user's explicit requirement,
and the only way this is consistent with nodules being the sole root input in a closed loop
(`docs/BLUEPRINT.md`'s 2026-08-11 item 5 entry, "no money — nodules as sole root input").
Concretely: a collected fine converts into extra nodules arriving at the dock that day, on top
of the ordinary `NODULES_PER_DAY` supply (`engine/importExport.ts`) — the confiscated value
re-enters circulation as raw material rather than exiting the system, matching the closed-loop
principle this engine already enforces everywhere else money-like value moves.

**"As the node grows, additional nodules arrive at the docks so the economy stays in
equilibrium"** — checked against the real mechanism, not assumed: `nodulesReceivedToday`
already scales with Import/Export's FILLED+BACKSTOPPED slot count, not a flat number. Slot
count is exactly the lever population growth already moves through this engine's own
opportunity valve (`docs/BLUEPRINT.md`'s "opportunity-adjusted migration step" entry) — so
"nodules keep pace with growth" is **already true of the shipped system**, structurally, once
Import/Export slot count is part of whatever future role/district scaling happens. This
design doesn't need to invent a second population-linked supply rule; the fine-refund above is
the only genuinely new addition to nodule supply this ruleset requires.

---

## 7. What this design does NOT decide

- Exact resource cap, refill rate, and fine amount — all `[ILLUSTRATIVE]`, meant to be
  measured against a real `stepWorld` run before shipping, the same "measure before trusting"
  discipline every other constant in this project has gone through (see
  `docs/BLUEPRINT.md`'s reputation-threshold entry for what that measurement pass looks like
  in practice).
- Arson's exact target (workplace vs. abode vs. either) — flagged open in
  `docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7.6, not resolved here either.
- Whether a caught player's contributed resources are lost (spent regardless of outcome) or
  refunded to them specifically — not stated by the user, not assumed here.
- Whether there's a cooldown or cap on how often a given target can be victimized — not
  discussed; worth deciding before this ships, given constraint 2's "no permanent zero-state"
  could plausibly apply to a repeatedly-targeted player's own standing, not just population.
- Whether reputation levels (`docs/DESIGN_HOUSING_REPUTATION_2026-08-13.md` §3) interact with
  this at all (e.g. does getting caught ever cost reputation?). Constraint 6 says reputation
  can only ever grant, never remove — so the honest answer is **no, it structurally can't**,
  and this document deliberately doesn't propose otherwise.

## 8. Suggested build order, if/when this proceeds to code

1. Add `personalResourceStock` to `RoleEconomicSlot`/`SupportRoleSlot`, same lifecycle
   convention as `wealth` — accrual rate `[ILLUSTRATIVE]`, verified against a real run before
   trusting the cap/refill numbers.
2. Add the three item recipes and communal-pooling contribution tracking, anchored to a
   target (building or abode).
3. Wire the act-attempt step-chain onto `ecosystem.ts`'s existing
   `patternSabotageAttempt`/`detectionProbability` machinery — reused, not reimplemented.
4. Add the fine/refund mechanism, feeding `nodulesReceivedToday`'s existing supply.
5. Regression tests proving: nobody can complete a craft alone (structural, not just
   probabilistic); a witnessed step really can implicate one contributor without implicating
   the rest; fines never push wealth negative; fine refunds are conserved (nothing vanishes
   from the closed loop).
