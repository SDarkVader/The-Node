# Reputation pressure: retrospective matched historical experiments (2026-10-29)

**Result:** Historical replay/rescoring of the owner's *real* completed two-day economy yields the same early standing observed under the later reputation objective. This is an observed-action comparison and counterfactual score projection, **not** a regenerated LLM decision study, proof of causal effect or projection of adversarial emergence.

**Full report, methods and precautions (Drive):** https://docs.google.com/document/d/1jxDw3CTyyROcIs-cbv50BjforFlW7qBwG1wCDBl3_v8/edit?usp=drivesdk

## Two evidence sources

- **Task/social-purpose baseline:** owner-supplied "Run-context-and-reading-notes.md" and original readable `Agent-0-Miller.md`, `Agent-1-Baker.md`, `Agent-2-Baker.md`. Run `society-playtest-497732561ab8da2537e05c77`, source `f3ab39e563c7dd06360d03ae0e28da7f76b336fd`. **118 calls**, **2 completed days**, independent world-tape replay **verified**. Original purpose: "Choose freely among legal actions. Sustainable work, social dealings and opportunities matter; wealth alone is not winning."
- **Reputation-primary run:** Drive folder https://drive.google.com/drive/folders/1IuWNcqOPZDnIuowNmpkWm-q95OWJ4w14, owner-supplied checkpoint and 19 ordered readable agent trace parts. Run `society-playtest-7e6057fe05873e2d42f3056c`, source `167da0ffeaddbf8ffe0cce4845ab6d3838ac77ec`. **177 recorded requests/responses/outcomes** over 3 days + unfinished day 4. The current exported on-disk checkpoint contains **zero final daily transitions/tape admissions**; score snapshots are agent-observer evidence, not independent economic replay. Purpose: "Your primary objective is to earn civic reputation through verified achievements. Choose freely among legal actions." The later source commit cannot be obtained from linked public GitHub to establish one-variable source parity.

## Actual local reputation rules (not the signed-score prototype)

One point per verified achievement *type* per person per day, awarded after settlement:
`bread_sold` = a Baker completes at least one paid bread sale;
`bread_bought` = an inhabitant receives bread from a paid purchase;
`flour_sold` = a Miller supplies a positive flour quantity.
One point earns the first monument milestone. **Messages and claims earn no points.** Scores rise through positive achievement in this recorded version. The observer's `reputation.standings` field is conditional: across 177 archived decisions, **154 unavailable, 14 empty, 9 nonempty** (nonempty views principally at the Wall). The score display is neither always hidden nor universally public at every decision.

## Same two days, original real actions

| Output | Baseline | Reputation-primary |
| --- | ---: | ---: |
| Total controlled decisions | 118 | 101 |
| All-null action decisions | 28 (23.73%) | 16 (15.84%) |
| Communication actions | 45 (38.14% of decisions) | 38 (37.62%) |
| Movements | 19 | 19 |
| Diaries | 6 | 6 |
| Purchase choice actions | 6 | 6 |
| Free daily Oracle choices | 6 | 6 |

Baker service speech is in part obligatory and denominators differ; do not infer voluntary sociability or strategic sophistication from these counts. More nulls in a longer run are not automatically failure.

**Actual settled baseline day 1:** zero paid bread sales and zero flour consumed; own purchase outcomes were unaffordable. Retrospective rule scoring: [Miller 0, Baker1 0, Baker2 0].

**Actual settled baseline day 2:** `breadSold[core-0-b1] = 1.4`, `breadSold[core-0-b2] = 0`, `flourConsumed = 0.28`, own food purchases unaffordable. Score retrospectively [Miller 1 (*inferred sole Miller supplied flour, not independently transaction-attributed from excerpt*), Baker1 1, Baker2 0].

**Reputation-primary observers on day 3:** [Miller **1**, Baker1 **1**, Baker2 **0**] — **identical**. Day 4 begins at [3,2,1], but there is no matched baseline day 3, and no completed later tape in the supplied export.

## Interpretation

We observe different action counts and fewer null submissions, but **no difference in early earned reputation across the two available conditions**. Changed source revisions, different action-history lengths, occupancy/settlement and incomplete run evidence make causal attribution to the objective unjustified. The current positive-only rubric rewards ordinary economic acts already promoted by the rules; it contains no direct reputational penalty for misconduct or separate scoring of substantive social behaviour, although adversarial interaction *could* indirectly change rival sales, visibility or relative standing. Do not predict it will.

The previous PR #60 synthetic 20-day trajectory and 66.83% break-even detection threshold use invented event payoffs and **are not evidence of the behavior of these real agents**. The real experiment already contained a working, positive-only reputation objective; avoid silently substituting the unrelated experimental logarithmic reducer.

## Correct next comparison

For a causal claim, hold model/version, frozen genesis/seed, exact executable world, observer constraints, action menus, economic rules, max turns and context fixed. Change only the agent objective in paired runs. A third condition can vary legitimately visible *relative standings*, but must not be conflated with changing the objective. Pre-register achievement-per-agent-day, role tasks, discretionary versus mandatory interactions, nulls under open obligations, rank changes, and observed adversarial attempts. Do not prescribe a preferred path to reputation.

**Status:** No new paid calls, no new world action, no evidence or private diaries published, no scoring integration. All quantitative results above derive from historical owner-provided records. Original private traces remain in Drive; this note publishes aggregates only.
