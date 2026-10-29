# The Node — Civic Reputation v0: offline mathematical test

**Date:** 29 October 2026  
**Repository reference:** `SDarkVader/The-Node` / `main` at `ea5bbc389a3c02c35b2026148daf771c5a0c3e63`  
**Status:** Isolated experimental prototype on a review branch; **not** wired to the live world, agent instructions, observation schema, role permissions, backstop, billing or histories.

## Research question

Can an immutable civic record support a *changing, signed* competitive reputation, while making inactivity different from failure, separating notoriety from approval, and giving adversarial behaviours nontrivial risk-reward incentives?

The live `reputationProgress` in `src/engine/reputation.ts` measures legacy opportunity/role-gate progress; it is **not** the general signed civic reputation proposed here. The later owner decision in `docs/recovery/EXPERIMENT_FIRST_INHABITANT.md` permits earned standing to fall, while retaining basic survival, neutral placement and backstop recovery. Earlier additive-only wording is not used as a new signed-score rule. The recorded civic/deed system has not been integrated.

## Proposed pure scoring kernel

For verified positive and negative civic evidence totals \(P_i,N_i\) and tunable \(k,b>0\):

\[R_i=k\log\left(\frac{b+P_i}{b+N_i}\right),\qquad V_i=k\log\left(1+\frac{P_i+N_i}{b}\right).\]

Here `R` is signed standing and `V` is nonnegative notoriety. Both are derived from the immutable event history, not stored as an editable fact. The prototype uses illustrative `k=10`, `b=5`, `dailyCap=3` evidence units per subject/day/domain/valence. Domains are `service`, `cooperation`, and `conduct`, each available as a public-event-derived projection. No persistent private trust dossier is created. No inactivity penalty is applied automatically.

Events have an ID, persistent subject ID (supplied by caller), day, domain, positive/negative valence, and integer weight in `[1,3]`. IDs must be unique; duplicate events cause rejection. A subject/day/domain/valence cell is capped before aggregation. The same verified event cannot be multiplied by witness count. These input checks **do not prove an event happened**; world-owned authoritative event verification is still required before any integration.

An illustrative relative standing share is computed by a numerically stable softmax: \(C_i=\exp(R_i/5)/\sum_j\exp(R_j/5)\). This is a competitive index, **not** the probability of winning or taking a role.

## Verification conducted

- TypeScript scoring kernel compiled locally with `tsc` under strict settings (isolated compile, not the full repository).
- The actual compiled scoring kernel passed **20 explicit offline checks**, including **10,000 numeric pairs** verifying increasing positive evidence never lowers standing and increasing negative evidence never raises it.
- Checks cover zero evidence, signed versus notorious reputation, no penalty for empty days, event-order independence, duplicate rejection, same-day farming cap, cross-day accumulation, separate positive/negative caps, domain separation, malformed inputs, normalized relative shares, and synthetic adversarial payoffs.
- Independent Wolfram Language evaluation matched the two-agent payoff calculation, the critical detection threshold and the day-20 signed values (within floating-point precision).
- A *scripted* three-inhabitant, 20-day event trajectory produced **21 snapshots** for each of three cases. These are **hypothetical event histories**, not agent-generated actions, real day-end settlements or evidence of model learning.

### Synthetic 20-day outcome

The Miller has 8 initial positive and 1 negative units; the Grifter has 5 positive; the Baker has 4 positive. The Grifter is scripted to earn one positive verified service event each day; the Baker earns one every two days. The Miller does not accrue further evidence in the quiet scenario. In attack variants the Miller gets one verified negative conduct event on days 8, 9 and 10. In the detected variant, the Grifter receives two negative evidence units on each of days 11 and 12.

| Scenario at day 20 | Miller standing | Grifter standing | Baker standing | Largest competitive share |
| --- | ---: | ---: | ---: | --- |
| Quiet, earned growth | 7.7319 | 17.9176 | 13.3500 | Grifter 65.29% |
| Attack, no attribution | 3.6772 | 17.9176 | 13.3500 | Grifter 68.54% |
| Attack, attributed | 3.6772 | 12.0397 | 13.3500 | Baker 52.25% |

**Observation:** An idle Miller's absolute score remains fixed; rivals can nevertheless pass it. An adversarial act can shift the relative order, while attribution may change who leads. There is no operational job loss in this experiment because the prototype does not touch vacancy/backstop.

### Two-agent adversarial payoff sensitivity

For a smaller, directly controlled two-agent contrast: legitimate activity leaves the Grifter's competitive share at **55.096%**; the example attack changes it to **73.409% if undetected**, **46.006% if detected**. Equating expected competitive share against the legitimate alternative gives a detection break-even of **66.829%** for `b=5, k=10, temperature=5`. With a *hypothetical*, independent 5% detection probability per effective witness, 22 witnesses first cross that threshold.

The result is parameter-sensitive. Holding the example constant, Wolfram gave break-even probabilities of **37.648% (`b=1`)**, **61.024% (`b=3`)**, **66.829% (`b=5`)**, **71.087% (`b=10`)** and **73.095% (`b=20`)**. There is no basis yet for choosing the prior or detection law as a final policy. This is not the Node's live witness algorithm.

## Unresolved design and validation work

1. **Provenance:** Decide which kernel-owned verified deeds, public witnesses and attributed harms can produce records; refuse rumour-as-fact and duplicated claims.
2. **Identity across roles/shards:** Attach events to persistent inhabitants independently of current Miller/Baker/Grifter slots; do not revive the old `GrifterSlot` reset behaviour.
3. **Anti-farming trade-off:** The illustrative cap restricts both credit and harms. Stress-test genuine repeated service, coordinated false accusations, colluding counterparties and mass harm; a cap can itself introduce exploits.
4. **Visibility:** Specify public record versus observer-specific projection, and keep private diary judgements mortal. The three domains are event categories, not a hidden per-person trust ledger.
5. **Calibration:** Sweep scale, evidence prior, caps, types of events, population sizes, relative-share temperature and detection models. Measure whether strategies become competitive rather than asserting they will.
6. **Adversarial agency:** Separately compare real policy decisions under different objectives and adversarial conditions. Offline synthetic outcomes are mechanism checks, not observed autonomous strategy.
7. **Backstop:** Do not conflate reputation with automatic replacement. Decide and test consequences after the reputation system itself is validated. Preserve the mechanical backstop and baseline survival floor.

## Reproduction and provenance

Prototype: `src/engine/civicReputation.ts`  
Vitest coverage: `test/civicReputation.test.ts`  
Model-free reproduction: `npx tsx scripts/civic-reputation-offline.mjs`  
Machine-readable results: `docs/research/evidence/civic-reputation-offline-2026-10-29.json`  
Time series: `docs/research/evidence/civic-reputation-trajectory-2026-10-29.csv`

Evidence SHA-256 after local execution:

- JSON: `c0def41e2407831fa16de27eba356579f9487c8d98ba930748ec65baf566e57d`
- CSV: `918f0dca59b9f30136126152c30631feafebea513229bd28fceb4491a8ec12b7`

**No paid agent calls, provider dispatch, private accounting access, committed world transition or live simulation was performed.** The Vitest suite was authored for the repository but could not be run against the entire repository from this isolated checkout; the Node native offline harness executed the actual compiled reducer. Any CI result must be attributed to the exact PR commit.
