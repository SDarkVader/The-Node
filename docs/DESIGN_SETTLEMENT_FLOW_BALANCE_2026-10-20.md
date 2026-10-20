# Settlement model: a flow-balance ledger

**Status: partly BUILT (2026-10-20); see "Build status" directly below.** Tags as in the other
design docs: `[SHIPPED]` is true of the code today, `[PROPOSED]` is this document's
recommendation, `[OPEN]` is the user's call and isn't decided here, and `[ILLUSTRATIVE]` is a
placeholder number that has to be measured before anyone trusts it.

This document came out of an external audit (2026-10-20, recorded in `docs/DEVLOG.md`) of a
proposed compute-settlement model. That model has player holdings `W_i`, a district pool
`P_district`, a shard pool `P_shard`, a transit-voucher reserve `R_voucher`, and the invariant
ΣW + P_d + P_s + R_v = constant. The audit's arithmetic is correct. The constant-sum invariant
is still the wrong one for NODE, and two of the fixes it implies collide with standing rules.
This document is the version that fits.

## Build status (2026-10-20)

**Built and tested** (`engine/settlement.ts`, `test/settlement.test.ts`):
- **The flow-balance invariant (§1.3), exact every tick.** Every wealth write in `stepWorld` is
  a named issuance line, a transfer into an account, or an emigrant's carried holdings. The
  worst residual over 24,000 measured ticks is 1.2e-6 of tolerance. Floats with a relative
  tolerance, not integers (§1.4 left open, not decided here).
- **No silent destruction.** Oracle entries fund `oraclePool`, which pays wealth prizes
  (`oracleShortfall` is 0 in every measured tick). Wealth-cap overflow goes to `districtPool`.
  Balances left behind at a role change go to `dock`.
- **Standing berths (§3.1, Rule 1)** with `B_min = STANDING_BERTHS_DEFAULT = 1`
  (`WorldConfig.standingBerths`, 0 disables). Rule 2 (sizing by `k`) isn't built, because it
  only matters once wages are funded from the pool.
- **Vouchers (§4.2).** Emigrants carry their holdings. A successful crossing arrives with them
  (`receiveMigrants(..., holdings)`); a failed or impossible crossing goes to the *source* dock.
  Checked system-wide in `test/settlement.test.ts`.
- **Trajectories are byte-identical** for everything above except the standing berth, which
  never fired in 20,000 populated-shard ticks. The golden snapshot is unchanged.

**Measured** (`npm run settlement-report`): issuance is 45.79 per tick and implied
**k ≈ 2.02** wealth per nodule. **82.7% of issuance is forfeited at role transitions.** A
grifter's savings vanish when they take a role, and a slot's balance vanishes on refill. Today
that loss is the economy's only real sink; the ledger now routes it to the dock instead of
deleting it.

**Not built: decisions waiting on the user.**
1. **What bounds wealth.** If wealth follows the person (the §2 refill row), the 82.7% sink
   disappears and holdings grow without limit, unless a designed sink replaces it (upkeep,
   decay, or the dock draining back as nodules at a funded rate). This is the next real choice.
2. **Funded issuance (§2, §3):** wages paid from `districtPool` at rate `k`, floor first, with
   `I_floor` as the named last resort. That depends on 1, since the size of the sink sets what
   `k` has to be.
3. **The currency option (§5):** A, B or C.

---

## 0. The problem being solved

`[SHIPPED]` Today `wealth` is created and destroyed with no accounting at all.

| Path | Code | What happens to value |
|---|---|---|
| Miller income | `wealth.ts` `millerDailyIncome`, `world.ts` ~1618 | Created. No Baker is debited for the flour. |
| Baker income | `wealth.ts` `bakerDailyIncome`, `world.ts` ~1619 | Created. Customers pay nothing. The flour-cost term is subtracted from profit but credited to no one. |
| Courier / Investigator / Import-Export wage | `world.ts` ~1641-1658 | Created. BLUEPRINT already notes that "commissioner-funded" courier pay was never built. |
| Grifter income floor | `world.ts:1659` | Created. |
| Shift Cover payout, completion rewards | `world.ts` ~1717, ~1800 | Created. |
| Oracle entry cost | `world.ts:1739` | **Destroyed.** It is deducted and routed nowhere. This is the audit's counterexample, already live. |
| Oracle wealth prize | `world.ts:1744` | Created. |
| Slot refill | `world.ts` (every `wealth: 0` on refill) | **Destroyed.** Wealth lives on the slot, not the person, so the outgoing occupant's balance disappears. |
| Emigration | `stepWorld` → `multiShardHarness.ts` | **Destroyed** at the source. `receiveMigrants` creates the arrival with `wealth: 0`. |
| Failed crossing | `multiShardHarness.ts:161` | The person is lost, along with whatever they held. |
| `applyWealthCap` | `wealth.ts:258` | Discards overflow when everyone is at the cap. Off by default. |
| `taxAndRedistributeIncome` | `wealth.ts:229` | Conserved exactly. Off by default. |

None of these is a bug under the current design, where wealth is a scoreboard
(`DESIGN_ADDENDUM_2026-08-11.md` §4). They become bugs the moment wealth is meant to be
spent: on envelopes, sabotage or arson steps, upkeep, or a transit voucher. At that point,
value appearing from nowhere is inflation and value vanishing is a hidden tax.

---

## 1. The invariant

### 1.1 Why not a constant sum

- **Value enters from outside every day, by design.** Nodules are the one external input
  (§5 of the 08-11 addendum; `NODULES_PER_DAY = 6.0`, `importExport.ts`). A constant-sum
  ledger would have to deny that, or carry nodules as a second, unconserved economy.
- **Population is not fixed.** Arrivals, emigration and new shards all change headcount.
  Under a constant sum, per-capita holdings fall as a shard grows. That is deflation built
  into the rules, and it isn't anything the design asked for.

### 1.2 Accounts `[PROPOSED]`

Per shard:

- `W_i`: each person's holding, for role-holders and grifters alike. **It belongs to the
  person, not the slot** (see §2, refill).
- `P_district`: one per district. The shipped config has one district per shard, so this is
  one account today.
- `P_shard`: shard reserve.
- `R_voucher`: escrow for vouchers issued in this shard and not yet settled.
- `D`: **the dock.** Every sink that the addendum says "returns as nodules" credits `D`, and
  `D` feeds the next tick's issuance. This turns "returns as nodules" from prose into an
  account, the same way item 5 turned nodule supply into real structure (BLUEPRINT_HISTORY,
  "Item 5").

System-wide:

- `T`: vouchers in flight between shards (debited from one shard, not yet credited to
  another).

### 1.3 The rule

Every posting is a pair: one account debited, another credited, same amount, same tick. There
are exactly two ways value enters the closed set, and nothing ever leaves it.

```
per shard s, per tick t:
  Σ_s(t+1) − Σ_s(t) = I_nodule(s,t) + I_floor(s,t) + V_in(s,t) − V_out(s,t)

  where Σ_s = ΣW_i + ΣP_district + P_shard + R_voucher + D

system-wide:
  Σ_all(t+1) − Σ_all(t) = Σ_s [ I_nodule(s,t) + I_floor(s,t) ]

  where Σ_all = Σ_s Σ_s + T          (dormant shards included)
```

- `I_nodule` is issuance from nodule arrivals. It is the only routine source.
- `I_floor` is an emergency issuance that exists only to keep constraint 2 (see §3). It is
  normally 0, and every nonzero tick is reported.
- `V_in` and `V_out` are cross-shard voucher movements. They cancel system-wide through `T`.
- **There is no destruction term.** Fees, fines, action costs, entry costs and failed
  crossings all credit an account (usually `D` or a pool). That is the audit's "destruction
  flaw" closed by construction, not by remembering to route each case.

### 1.4 How it is checked `[PROPOSED]`

A per-tick assertion sits next to the existing population-conservation test in
`test/world.regression.test.ts`, with a multi-shard version in `multiShardHarness.ts`.
Treat a break as a build failure, the same way the `flourRatio` and nodule→grain coherence
filters are treated.

`[OPEN]` **The unit.** With floating-point balances the check needs a tolerance (1e-9), and
drift accumulates over long runs. Integer minor units (say, thousandths) make the assertion
exact at the cost of rounding rules in every income formula. Recommendation: integers. A
conservation test that needs a tolerance can't tell a rounding error from a real leak.

---

## 2. Posting table: every current path, rerouted `[PROPOSED]`

| Path | Debit | Credit | Note |
|---|---|---|---|
| Nodule issuance | (external) | `P_district` | Amount from `nodulesReceivedToday` plus `D` drained. |
| Bread purchase | buyer `W_i` | Baker `W_i` | This *is* the "daily overhead / upkeep" the audit worried about. It is a transfer to a Baker, not a burn. |
| Flour purchase | Baker `W_i` | Miller `W_i` | Replaces two independent calculations with one transfer. |
| Courier fee | commissioner `W_i` | Courier `W_i` | The 08-11 addendum's §6, finally literal. |
| Investigator / Import-Export wage | `P_district` | holder `W_i` | Wages paid by the town, not minted. |
| Grifter floor | `P_district` (see §3) | grifter `W_i` | |
| Shift Cover payout | covered slot's `W_i`, or `P_district` while the slot is vacant | coverer `W_i` | `[OPEN]` which one. The covered slot paying makes "covering is always worse than holding" (addendum §7) structural. |
| Completion reward | `P_district` | holder `W_i` | |
| Oracle entry | entrant `W_i` | Oracle pool (sub-account of `P_shard`) | |
| Oracle wealth prize | Oracle pool | winner `W_i` | The prize must be solvent from entries, so prize size times win odds must not exceed entry inflow. That is a real constraint on the Oracle's calibration, not just bookkeeping. |
| Action costs (envelope, sabotage step, arson step) | actor `W_i` | `D` | Returns as nodules. |
| Fine | caught `W_i` (floored at 0) | `D` | Same as `DESIGN_FINES_ECONOMY_2026-08-13.md` §6. |
| Wealth cap overflow | over-cap `W_i` | `P_district` | Replaces the "pool has nowhere to go, discarded" branch. |
| Slot refill | nothing | nothing | The outgoing occupant keeps their `W_i` (it moves with them into a `GrifterSlot`). The new occupant brings their own. |
| Voucher issue, settle, fail | see §4 | | |

`[OPEN]` **Slot refill depends on a person existing across the transition.** Today a
grifter filling a slot is removed from `grifters[]` and the slot starts at `wealth: 0`. There
is no record linking the two (`player.ts` defers identity, HANDOVER 2026-08-13). The minimum
needed is to carry the number across at the moment of fill or eviction, inside the same
`stepWorld` pass that already selects the specific grifter. That needs no persistent account,
so it doesn't hit the identity wall. It still has to be built and checked.

---

## 3. Funding the grifter floor

**What constraint 2 requires:** `GRIFTER_DAILY_INCOME` is documented as *strictly positive*.
It is a floor that a present player always receives (`wealth.ts`, "constraint 2: no permanent
zero-state"). Paying it only out of `P_district`, as the audit suggests, makes it conditional
on the pool's balance.

**This case is reachable** (checked in the code; how often it occurs is not measured).
`nodulesReceivedToday` returns `(filled + backstopped × 0.4) × NODULES_PER_DAY × multiplier`.
A VACANT slot contributes nothing until the hard backstop fires at `tHard` (default 3 days,
`vacancyHarness.ts` `DEFAULTS`). If every Import/Export slot is VACANT at once, issuance is
exactly 0 for up to `tHard` days. A district that drains its pool on wages during that window
would stop paying the floor. §3.1 closes this at the source.

**Recommendation `[PROPOSED]`: a strict priority order, with an explicit last resort.**

1. Each tick, the floor is the **first** claim on `P_district`, ahead of wages, completion
   rewards and Shift Cover. The required amount is
   `grifterCount × GRIFTER_DAILY_INCOME × DAILY_ACTIVITY_MULTIPLIER`.
2. If `P_district` is short, the rest is drawn from `P_shard`.
3. If both are empty, the remainder is **issued** as `I_floor`. This is a named, reported
   creation line, not a silent mint.

Constraint 2 outranks strict conservation. Letting the floor fail to protect the ledger would
be the exact trade constraint 2 forbids. What keeps step 3 honest is that it is the *only*
non-nodule source, it pays for one thing only, and how often it fires is a metric:
`I_floor > 0` in the steady state means the issuance rate or the wage bill is miscalibrated.
It does not mean the floor should go.

Other options considered:

- **Pay the floor directly from nodule issuance, before it reaches any pool.** That is the
  same as step 1 when issuance is positive, and it fails the same way when issuance is 0.
- **Require a minimum reserve in `P_district`.** This works in steady state but just moves the
  question to what happens when the reserve itself runs out. It still needs step 3.

### 3.1 Never losing Import/Export: the standing berth `[PROPOSED]`

(User directive, 2026-10-20: the system itself must balance the equation so that Import/Export
is never lost.) Import/Export is the only role on the *source* side of the equation. Every
other role moves value around; only Import/Export brings it in. Losing it zeroes `I_nodule`,
and from then on every outflow has to come from reserves or from `I_floor`. So the guarantee
belongs on the source, not on the pools.

**Rule 1, the last berth never goes dark.** Each shard has a minimum number of *standing
berths*, `B_min` (see Rule 2), and at least one. A standing berth is an Import/Export slot
that is never VACANT. When it leaves FILLED for any reason (churn, conscription eviction,
emigration), it goes **directly to BACKSTOPPED** with `tHard = 0` for that slot only, instead
of passing through VACANT. In practice this applies to whichever slots would otherwise take
the shard's count of Import/Export slots that are FILLED or BACKSTOPPED below `B_min`.

- **It is mechanical, not an agent** (constraint 3). It reuses the same BACKSTOPPED state that
  every role already has (`vacancy.ts`); the only change is a timer of zero for these slots.
  Nothing new has behaviour.
- **Players can still take it.** A BACKSTOPPED berth keeps the ordinary
  `backstoppedRecoveryHazard`, so a real player takes it back exactly as they would any
  backstopped slot.
- **Vacancy still bites.** A backstopped berth supplies `BACKSTOPPED_NODULE_FRACTION` (0.4) of
  a staffed one, and every Import/Export slot above `B_min` keeps the ordinary VACANT phase.
  The shard is squeezed, not stopped, which is what `world.ts:1486`'s comment already
  promises once the backstop fires. This rule removes only the 0-to-`tHard` gap before it
  fires.

**Rule 2, size the berths to the floor bill, so the equation balances on its own.** The
guaranteed minimum issuance is

```
I_min = B_min × BACKSTOPPED_NODULE_FRACTION × NODULES_PER_DAY × DAILY_ACTIVITY_MULTIPLIER
      = B_min × 0.4 × 6.0 × 0.7  =  B_min × 1.68 nodules/day        (shipped constants)
```

and the guaranteed minimum outflow is the grifter floor bill,
`F = grifterCount × GRIFTER_DAILY_INCOME × DAILY_ACTIVITY_MULTIPLIER = grifterCount × 0.35`.
Set each tick:

```
B_min = clamp( ceil( F / (k × 1.68) ), 1, rImportExport )
```

where `k` is wealth credited per nodule issued `[OPEN, ILLUSTRATIVE]`, the exchange rate at
the dock. It is the one place nodules become compute. It is a fixed system constant, not a
market rate, so it stays inside option C (§5).

With `I_min ≥ F`, the floor is paid from new issuance alone even in the worst tick, and §3's
step 3 (`I_floor`) can fire only when `B_min` is already capped at `rImportExport`, meaning the
grifter population has outgrown the shard's entire dock capacity. That stays a named, reported
event, and it is also the right signal: it means the shard needs more Import/Export slots, not
more issuance from nowhere.

**Rule 3, the dock drains only through a berth.** `D` (returned fines and fees) re-enters
circulation as nodules, so it is issued through Import/Export too. Because Rule 1 guarantees at
least one berth is always running, `D` can never get stuck.

**What this costs, to be measured rather than assumed** (constraint 1):
- How often Rule 1 fires at the shipped config. With 6 Import/Export slots, an all-VACANT
  moment needs several near-simultaneous churns, so it may be rare in a populated shard. It is
  certain in a rejuvenating shard, which now starts all-VACANT (see the finding below).
- Whether `B_min` grows large enough in grifter-heavy shards to blunt Import/Export vacancy
  pressure overall. If `B_min` approaches `rImportExport` routinely, the floor is too
  expensive for the dock, and that is a calibration finding about `k` or the floor.
- Its interaction with `conscriptionFromOtherRole`: evicting the holder of a standing berth to
  cover another role is still allowed, and the berth simply backstops. Measure whether that
  makes standing-berth holders preferred eviction targets.

**Finding while designing this, since confirmed and fixed (2026-10-20):**
`createDormantWorld` (`world.ts:908`) vacated every role except Import/Export, so a dormant
shard held 6 FILLED Import/Export slots at population 0 and issued full nodules with nobody
there. `test/world.dormant.test.ts` reproduced it (`expected 6 to be 0`), and it's fixed: the
shard now starts all-VACANT. Under today's vacancy timers that means a dormant shard issues
**0** nodules for its first `tHard` days, then 0.4 per slot once backstopped. That zero window
is exactly the gap Rule 1 closes. With standing berths in place, a dormant shard's
Import/Export slots would start BACKSTOPPED and issue from day 0, which is the "automated
economic stability until a new player lands" its own doc comment describes.

---

## 4. Vouchers across shards

### 4.1 What exists today `[SHIPPED]`

- An emigrant's wealth vanishes at the source. `receiveMigrants` creates them at the
  destination as a grifter with `wealth: 0`.
- A crossing can fail (`attemptCrossing(drawTicketProgress(rng), rng)`, about 15% emergent).
  A failed migrant is lost from the simulation entirely: "a real cost, not redirected or
  refunded."
- The exit ticket is postcard progress: individual accrual, non-transferable. It is
  **progress toward permission to cross**, not a store of value.
- `shardRegistry.ts` has only `ACTIVE | DORMANT`. There is no DEAD state.

### 4.2 The lifecycle `[PROPOSED]`

A voucher is **escrow, not a second currency**. It holds the migrant's own `W_i` while they
are between shards. It is separate from the exit ticket: the ticket decides whether you can
cross, and the voucher decides what you carry.

| Event | Debit | Credit |
|---|---|---|
| Issue (on emigration) | migrant `W_i` (source) | `R_voucher` (source) |
| Leaves the source shard | `R_voucher` (source) | `T` |
| Crossing succeeds | `T` | migrant `W_i` (destination), replacing `receiveMigrants`'s `wealth: 0` |
| Crossing fails | `T` | `D` (**source** shard) |

**Failed crossings go to the source dock**, so the loss re-enters as nodules where the person
left. The alternatives were weighed:

- Crediting the destination makes a failed crossing *feed* the place the migrant was trying
  to reach. That is an odd incentive, and it makes interception rates matter to the
  destination's economy.
- Crediting an "interceptor" means modelling one, which is an agent with motivation. Per
  constraint 3, that is a deception surface for no gain.

`[OPEN]` **The audit's 0.5 × overflow split into `R_voucher`.** The audit refers to an
overflow split without stating the rest of it, so this document doesn't assume it. Whatever
the rule is, it has to be a *single* posting in which the `P_district` debit equals the sum of
the `W_i` and `R_voucher` credits. That is the audit's third flaw (the reward split not adding
up), and it is solved by the pair rule in §1.3 rather than by a special case.

`[OPEN]` **Carry-over limits.** If a migrant carries 100% of `W_i`, migration becomes a way
to move accumulated advantage between shards. A carry fraction below 1, with the rest going
to the source `D`, is a natural friction. That is a design lever, not a conservation question.

### 4.3 Constraint 4 check

A voucher is per-player state that crosses shards. That is allowed because it is a holding,
not a judgement. It records nothing about what anyone thinks of the player, and it is settled
(credited or forfeited) within one crossing. It must never become a cross-shard record of
*how* someone migrated or how often they failed. A voucher has no history once it is settled.

### 4.4 Shard death `[PROPOSED]`

When a shard's population reaches 0, **its accounts stay with it.** `P_district`, `P_shard`
and `D` sit in the dormant shard untouched.

- **Constraint 2 at shard scale:** a dead shard holding reserves can recover. Its first
  arrivals find a funded floor (§3) and a dock with a backlog. This matches
  `ECOSYSTEM_VISION_2026-08-06.md` §2: "rejuvenation is just migration into a flat-priced
  shard."
- **Constraint 5:** sweeping a dead shard's reserves to its neighbours would be the system
  authoring an outcome, deciding who benefits from a collapse. Leaving the reserves in place
  doesn't pick a winner.
- The system-wide invariant (§1.3) includes dormant shards, so their balances are always
  counted.

---

## 5. The currency question

**The conflict:** `DESIGN_ADDENDUM_2026-08-11.md` §5's hard rule says: *"Do not build a
generic currency, a universal exchange, or a common denominator 'value' field."* A single
"compute" that pays wages, action costs, upkeep and voucher backing is exactly that common
denominator.

**What is already true `[SHIPPED]`:** `wealth` is *already* one fungible scalar across all
five roles and grifters, with Gini computed over it. The common-denominator *field* exists as
a scoreboard. What §5 actually guards against is its next sentence: a resource becoming
"freely exchangeable for any other at a floating rate." In other words, a market in which
wealth buys role resources and role resources buy each other.

The three options:

- **A. Keep §5 as written.** Wealth stays a scoreboard and is conserved anyway; the ledger
  doesn't need wealth to buy anything. Action costs are paid in role resources
  (`personalResourceStock`), and vouchers carry postcards or ticket progress, not wealth.
  This is the smallest change, but it means the audit's settlement model largely doesn't
  apply.
- **B. Overturn §5.** Compute is money: spendable, transferable between players, priced by the
  market. Non-fungibility would then have to live somewhere else, and the "money reinvented
  with extra steps" risk §5 names is fully live.
- **C. Spendable at fixed system prices only `[PROPOSED]`.** Compute moves *only* through
  postings the system defines: wages, bread and flour purchases at the prices
  `stepBakers`/`stepMillers` already produce, fixed-price sinks such as action costs, fines
  and Oracle entry, and voucher escrow. This comes with three rules that make it different
  from money:
  1. **There is no player-to-player transfer verb.** No gifting, no trading compute for
     anything. Every `W_i → W_j` movement is a system posting tied to a real economic event.
  2. **Role resources are never priced in compute.** There is no posting that converts
     `personalResourceStock` into compute or back. Non-fungibility stays where §5 put it.
  3. **System prices come from the engine, not from player bids.** The bread price is a
     Baker's Bertrand price, and that stays an engine output.

**The recommendation is C.** It keeps what §5 is actually protecting (no floating exchange, no
universal market) while making wealth spendable enough to settle costs.

**`[OPEN]` This is the user's decision.** If C or B is chosen, record it in
`BLUEPRINT_HISTORY.md` as an explicit revision of §5's hard rule, with this reasoning. Don't
let it arrive implicitly through the first action cost that debits `wealth`.

---

## 6. Standing-constraints check

| # | Constraint | How this design meets it |
|---|---|---|
| 1 | Simulate before trusting | §8 plan. Nothing is adopted on derivation alone. |
| 2 | No permanent zero-state | Standing berths keep issuance above 0 (§3.1), floor priority plus `I_floor` (§3), and dormant shards keep their reserves (§4.4). |
| 3 | Does this need to be an agent? | Pools, dock and escrow are accounts with no behaviour. No interceptor agent (§4.2). |
| 4 | Personal memory mortal, civic memory immortal | A voucher is a holding with no history once settled (§4.3). Pool balances are civic. |
| 5 | Don't script outcomes | No redistribution of a dead shard's reserves (§4.4). |
| 6 | Reputation only grants | Not touched. No posting is conditioned on reputation. |

---

## 7. Not decided here

- The unit: integers or floats (§1.4).
- `k`, wealth credited per nodule (§3.1). Every other number in the berth sizing comes from
  shipped constants.
- Who pays a Shift Cover payout (§2).
- The overflow split rule for `R_voucher` (§4.2). It needs the original proposal's text.
- The voucher carry fraction (§4.2).
- The currency option, A, B or C (§5).
- Every amount: action costs, fine size, Oracle pool solvency margin. All `[ILLUSTRATIVE]`
  until measured.

---

## 8. Build order and simulation plan, if this proceeds

1. **Ledger assertion first, at the current behaviour.** Add the accounts and the per-tick
   check with every current path posted honestly: minting goes to a temporary `I_legacy` line
   and destruction to a temporary `S_legacy` line. This measures how much value currently
   appears and vanishes per tick, as a baseline, before anything changes. Golden snapshot
   unchanged.
2. Move one path at a time from `I_legacy`/`S_legacy` to a real posting (§2), starting with
   the Oracle entry cost (the live destruction) and slot refill. Each move is its own commit
   with its own measured before and after.
3. Bread and flour purchases as transfers. This is the largest behavioural change, because
   Miller and Baker income becomes funded by real buyers. Expect Gini and economic health to
   move, and re-measure both.
4. Standing berths (§3.1), the grifter floor priority, and `I_floor` (§3). (The
   `createDormantWorld` prerequisite is already fixed.)
5. Vouchers in `multiShardHarness.ts` (§4), plus the system-wide assertion.

**What to measure** (8 seeds × 3000 days, matching the eviction and Oracle harnesses):
- `I_floor` frequency and size in steady state. The target is roughly 0.
- How often Rule 1 fires, the distribution of `B_min`, and how often `B_min` hits
  `rImportExport` (§3.1).
- `P_district`, `P_shard` and `D` balances over time: whether they settle, grow without
  bound, or drain.
- Per-capita holdings against population. There should be no drift built into the rules.
- `wealthGini` and `economicHealthWithExperience` against today's baseline.
- Multi-shard: total value against total population, and the reserves held by dormant shards.
