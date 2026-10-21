# Recognition model v2: pre-build simulation

2026-10-21. A follow-up to the [A01 diary contract](DIARY_CONTRACT_A01.md). Constraint 1 says to
simulate before trusting, so v2 was run in simulation before anything is built.

**Bottom line.** Study 1 is not affected; nothing here touches the kernel. v2 *as worded* fails:
"proximity conversations count" and "sharing a district does not count" contradict each other in
the kernel as built. A rule that credits only **direct address**, judged by the **speaker's
intent**, meets the 10–20 day target exactly and keeps bystanders out. A permanent ledger still
saturates over a long game, so the owner has four decisions to make (below).

## Method

- [`src/sim/recognitionV2Harness.ts`](../../src/sim/recognitionV2Harness.ts) drives real
  participant-kernel episodes, through the same pipeline study 1 uses, with scripted policies for
  the seven study actors.
- Each day's real hearings (`lastRumourEvents`, `lastProximityConversations`) are replayed through
  candidate rules into a **shadow ledger**. Nothing is written back, so the kernel keeps running
  v1 and study 1's frozen inputs are unchanged.
- **Faithfulness check.** Rule v1 replayed on kernel hearings reproduces the kernel's own ledger:
  694 recognised pairs over 5 seeds × 40 days, with 0 mismatches.
- **Modelled, not measured.** The Grifter channels do not exist in the kernel. They are rebuilt
  with the kernel's own rules: talk is heard within range, and a district Wall post reaches a
  Grifter with the base chance 0.6. Each such hearing is flagged `modelled`.
- **Not simulated.** Trades, deliveries and campaign cooperation have no per-person record, so no
  rule credits them.
- **Reproduce:** `npm run recognition-v2-sim` (about 4 minutes, deterministic). Raw output:
  [`evals/evidence/recognition-v2-simulation-2026-10-21/report.txt`](../../evals/evidence/recognition-v2-simulation-2026-10-21/report.txt).
  Tests: `test/sim.recognitionV2.test.ts` (11 tests; 6 mutations of the rule engine and Grifter
  model all killed).

**Candidate rules** (integer credit units):

| Rule | Talk credited when | Ledger |
|---|---|---|
| v1 | never (heard Wall post = 1, threshold 5) | permanent |
| L | any utterance heard | permanent |
| C | any utterance heard, weighted by closeness | permanent |
| XR | both speak in range within 1 day (no address needed) | permanent |
| A1 / A2 | addressed, **as the listener heard it**; A2 also needs an answer within 2 days | permanent |
| I1 / I2 | addressed, **as the speaker intended**; I2 also needs an answer within 2 days | permanent |
| I1D / I2D | as I1 / I2 | leaky: loses 1 unit/day |

Except for v1, overheard talk earns 1 unit, a heard Wall post 2, and qualifying talk 10 against a
threshold of 100. I1D and I2D use 14 against 120 with decay 1.

**Scenarios.** A = baker-0 and B = importexport-0 are the dealing pair, and C = miller-0 is a
silent bystander. The scenarios are:

- **pair_daily / pair_alternate:** A and B address each other every day / every other day;
- **one_way:** A addresses B, and B never speaks;
- **broadcast:** every role holder posts to the Wall daily;
- **room:** every role holder speaks to the room daily;
- **grifter_pair:** the Grifter and A address each other;
- **mixed:** the pair deal on alternate days and post to the Wall otherwise, while the others post daily.

## Results (60 days, seeds 101–120; median days, ∅n = never in n of 20)

| Check | v1 | L | C | XR | A2 | I1 | I2 | I1D | I2D |
|---|---|---|---|---|---|---|---|---|---|
| pair_daily, A knows B | ∅20 | 10 | 13 [6–50] | 10 | 21 [10–55] | 10 | 10 | 10 | 10 |
| pair_daily, **silent bystander** C knows A | ∅20 | **10** | **17** | ∅20 | ∅20 | ∅20 | ∅20 | ∅20 | ∅20 |
| pair_alternate, A knows B | ∅20 | 19 | 19 [11–51] | 19 | 29 [19–55] | 19 | 19 | 19 | 19 |
| one_way, listener B knows A | ∅20 | 10 | 9 | ∅20 | ∅20 | 10 | ∅20 | 10 | ∅20 |
| broadcast only, A knows B | 13 [7–52] | ∅20 | ∅20 | ∅20 | ∅20 | ∅20 | ∅20 | ∅20 | ∅20 |
| room talk, A knows B | ∅20 | 10 | 12 | 10 | ∅20 | ∅20 | ∅20 | ∅20 | ∅20 |
| grifter_pair, either direction (modelled) | ∅20 | 10 | 9 | 10 | 10 | 10 | 10 | 10 | 10 |
| share of population knowing A, pair_daily | 0.00 | **0.79** | **0.68** | 0.01 | 0.01 | 0.01 | 0.01 | 0.01 | 0.01 |

**Over 200 days** (seeds 101–110), without decay every positive overheard or Wall credit
eventually recognises:

| Measure | Rules | Result |
|---|---|---|
| Bystanders of a daily conversation | XR, A2, I1, I2 | recognise both speakers at about day 101 |
| Wall-only posters, A knows B | XR, A2, I1, I2 | recognised at day 156 [113–193] |
| Share of population knowing A at day 200 | I2 | 0.39 |
| Share of population knowing A at day 200 | I1D, I2D | 0.01 |
| Wall-only posters | I1D, I2D | never recognised |

The daily pair took up to 46–77 days in the seeds where it started out of range, which is covered
by failure 6.

## Failures found

1. **The spec contradicts itself in the kernel as built.** `commsProximityRange` is 10 Manhattan,
   which spans most of the core. One utterance is heard by a median of 39 listeners (range 0–82).
   - Under the literal rule (L), a silent bystander recognises the speaker on the same day as the
     dealing partner (day 10 against day 10).
   - 79% of the population knows one conversing player within 60 days.
   - That is passive presence being credited, which is the "shared district" case the owner
     excluded.
   - Closeness weighting (C) does not fix it: 68% of the population, and dealing times of 6–50 days
     that depend on where workplaces happen to stand.
2. **Address must be judged by intent, not as heard.** The kernel corrupts the *heard* referent
   with distance.
   - "Addressed as heard" (A2) stretches daily dealings to a median of 21 days (up to 55), and
     alternate-day dealings to 29, outside the band, because of geometry alone.
   - By intent (I2), they take exactly 10 and 19 days.
   - The grammar supports address: `proximityConversation.ts` defines a `player` referent as
     direct address.
3. **A permanent ledger saturates.** With no decay, "far longer" becomes "eventually everyone in
   range", which erodes the asymmetry the design wants over a long game. Only a leaky ledger keeps
   bystanders and Wall-only posters at zero. The cost is that a Wall post alone *never* recognises;
   it only adds to real dealings.
4. **v2 removes a tension signal unless it is decoupled.**
   - `pressureContribution` amplifies a detected posting pattern by `1 + 1.5 × knownFraction`.
   - Today Wall posting makes about 81% know the author by day 60, so the factor is about 2.2.
   - Under every addressed rule the known share is about 1%, so the factor is about 1.0. District
     weather would lose most of that amplification.
   - `knownFraction`'s denominator (observers with any ledger entry) also changes meaning.
5. **Exchange rules are nearly symmetric.** The spec says v2 is directional and asymmetric. I2
   makes recognition mutual: both parties learn together. I1 keeps it directional, so you come to
   recognise whoever repeatedly addresses you.
6. **Smaller structural points.**
   - **Addressing out of range today.** An utterance addressed to someone out of range, or to any
     Grifter, is rejected outright, so nobody hears it. The validator accepts any person in the
     city, and the rules text already warns "valid submission need not produce a heard effect".
     Putting Grifters into the proximity graph (decided) fixes the Grifter half.
   - **Scarcity.** One communication a day means one addressee a day, so a player can bring about
     one person into recognition every 10 days.
   - **Geometry.** In 2 of 20 seeds the study pair starts 11–13 apart and must walk to meet.
   - **Unbuilt sources.** Two of v2's three counted sources (trades/deliveries, campaigns) do not
     exist. Adding them later changes the timing and must be re-simulated.
7. **Diary-study design: churn.**
   - Within 60 days, the controlled Grifter left the shard in 16 of 20 seeds (median day 29), and
     5–6 of 20 role holders lost their role.
   - Over 200 days, every controlled Grifter left, and 9 of 10 bakers lost their role.
   - A 30–40 day diary study will be heavily censored, and Grifter diaries will be short.

## Decisions for the owner

| # | Question | Recommendation | Why |
|---|---|---|---|
| R1 | Credit only direct address (by intent), with overheard talk weak or zero? | **Yes** | Failures 1–2; the only family that meets the target and excludes bystanders |
| R2 | Does being addressed count without answering (I1, directional), or only an answered exchange (I2, mutual)? | **I1** | Matches "directional and asymmetric"; two-way dealings still take 10/19 days |
| R3 | Permanent or leaky recognition? | **Leaky** | Failure 3. Constraint 4 ("personal memory is mortal") may also bear on a private per-pair record that never fades. Consequence: Wall posts alone never recognise |
| R4 | Should group talk to the room build recognition between the people who speak? | **Not by default** | XR recognises anyone who speaks in the same room, which is close to shared presence |
| R5 | Should pressure detection keep its own "how widely heard" measure rather than recognition? | **Decouple** | Failure 4; otherwise re-simulate district weather |

With R1–R3 as recommended (rule **I1D**), the measured outcomes are:

| Case | Result |
|---|---|
| Two-way daily dealings | 10 days |
| Two-way alternate-day dealings | 19 days |
| Addressed one way | the listener recognises the speaker in 10–11 days; the speaker learns nothing |
| Silent bystander, Wall-only poster | never recognised |
| Share of population knowing a conversing player at day 200 | 0.01 |

## Limits

- Policies are scripted and actors do not move.
- All seven controlled actors are in the core district, so the periphery (wider spacing) is untested.
- The shard has 100 people. Grifter channels are modelled.
- "Far longer" and "regular dealings" are operationalised here as the daily and alternate-day
  cases. Those are my readings of the owner's wording, not the owner's.

Constants should be set only after R1–R5 are decided, then re-run here before the kernel changes.
