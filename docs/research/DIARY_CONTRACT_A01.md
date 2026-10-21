# A01: diary contract v1.0.0

2026-10-20. Register item A01 of the [ground-truth register](GROUND_TRUTH_REGISTER_2026-10-20.md).
The machine-readable contract and evaluator classifier live in
[`src/eval/constructs/diaryContract.ts`](../../src/eval/constructs/diaryContract.ts), and the
committed snapshot with its hash is [`evals/contracts/diary.v1.json`](../../evals/contracts/diary.v1.json).

Every game rule below was decided by the owner. Where something is not built yet, this document
says so, and it says when it will be built.

## Decisions (owner, 2026-10-20)

- **Everyone has a diary and an abode, Grifters included.**
- **The diary is a daily task.** Each day the author writes one entry, choosing from the menus:
  - a person they have recognised;
  - one of 28 observations;
  - one of 5 readings;
  - an optional context tag.
- **The author chooses.** An entry may be faithful, manipulated, or leave things out. Nothing checks it.
- **Measured, never penalised.** The kernel never punishes a missed day; adherence is measured and reported.
- **No subject, no opportunity.** A day with no recognised subject is `not_applicable`.
- **Trespass reveals full entries.** A trespasser sees subject, observation, reading and context as they currently stand, after drift. Trespass itself is A04, not built.
- **Recognition is not immediate and not meant to be easy.** It takes about **10–20 days of regular dealings**.
  - It comes from interactions: proximity conversations, trades and deliveries, and campaign cooperation.
  - Overheard Wall posts get weak partial credit.
  - Simply sharing a district does not count.
- **Grifters need information.** They hear Wall posts in their own district, and they speak and hear proximity conversations where they stand. Saboteurs need cooperation through information asymmetry and uncertainty.

## Decisions (owner, 2026-10-21)

> "We don't always lose identity, but we do lose identity resolution. Although memory of an
> identity interaction remains in the diary and degrades. Those in a role must interact with
> customers. Those who don't wish to communicate outside needn't communicate unless they choose
> to. Refusal is also a signal to be remembered. Deception is also about interpretation."

- **Resolution can lapse; identity remains.** Without contact, a resolved person returns to a
  silhouette plus role icon. Their stable identity remains, and so does the diary's short,
  drifting memory of the interaction.
- **Role duties are dealings.** Role holders must interact with customers, which needs
  per-person trade (not built).
- **Speaking beyond the role is optional, and refusal is a remembered signal.**
- **Recognition credits the fact of an interaction.** What each party heard and how they read it
  is their own interpretation.

What these imply, and the remaining questions Q1–Q5, are in the
[second pass of the recognition v2 simulation](RECOGNITION_V2_SIMULATION_2026-10-21.md#second-pass-the-owners-statements-of-2026-10-21).
Dated notes now also mark the earlier "reliable once earned", ephemerality and silent-grinder
passages.

**Superseded** (the originals keep a dated note):

- `DESIGN_ADDENDUM_2026-08-06.md`: "creation is unprompted-only".
- `recovery/RULES_REVIEW_2026-10-18.md` principle 4: the game creates the content; players only mark.
- `DESIGN_HOUSING_REPUTATION_2026-08-13.md` §7.3: a trespasser sees the subject graph only.

## What already holds, and what changes

| Rule | Status in code today | Evidence |
|---|---|---|
| Composed entry from menus, one per daily decision | Built (`protocol.ts`, `diary.ts`) | validator schema; one decision per tick |
| Two-day retention; observation and reading drift at 0.2/day; subject and context never drift | Built | `test/eval.diaryContract.test.ts` kernel-invariant tests |
| Owner-only reads; reading is side-effect free; ageing happens at the kernel boundary | Built | same tests (state hash unchanged by reads; no other actor sees the entry) |
| Unrecognised subject or self-entry rejected | Built | `attempted_but_rejected` reachability test |
| **Grifters may write** | **Not yet.** The validator (`src/agent/protocol.ts`, a protected core file) and the kernel's role-holder gate still refuse Grifters. | classifier reports `grifter_gate_pending` |
| **Recognition model v2** | **Built, opt-in** (`WorldConfig.recognition = 'v2'`, 2026-10-21): direct address and repeated dealings, ~60-day lapse, Grifters in the proximity graph. v1 stays the default until study 1 has run. | `test/world.recognitionV2.test.ts` |
| Trespass reveal of full entries | Specified for A04; trespass is not built | — |
| Rules text that tells live models the diary is a daily task | **Inactive.** Live models are still told "use diary=null". | `test/eval.study1Freeze.test.ts` |

**Why the changes wait.** The Grifter gate, recognition v2 and the new rules text all change what
actors may do, see or be told. Study 1 runs on the rehearsed code (planned for 2026-10-22, postponed on 2026-10-21 until the owner reactivates it). So these changes
land afterwards, as a new rules version and a new scenario version. Until then,
`test/eval.study1Freeze.test.ts` pins study 1's exact request bytes, its contract and its manifest.

## Recognition: today versus v2

**Today (v1).**
- Hearing a Wall post is the only source of recognition. The original design wanted trades or established relationships, but no per-person transaction record exists, so this was used as a stand-in.
- Mechanical inhabitants never post, so every encounter comes from controlled participants.
- With six controlled actors posting daily, the first recognised person appears at ticks 6–17 (seeds 103–105). That is too easy, and broadcast-driven.
- Grifters never recognise anyone, because they are outside the hearing graph.

**v2 (specified; built after study 1).** Directional and asymmetric, as in v1.

| Source | Counts | Build |
|---|---|---|
| Proximity conversation | yes | exists for role holders; extend to Grifters where they stand |
| Trade or delivery | yes | needs a per-person transaction and delivery record |
| Campaign cooperation | yes | needs multi-member campaigns |
| Overheard Wall post | weak partial credit | exists; Grifters also hear posts in their own district |
| Sharing a district | no | passive and symmetric; it would erase asymmetry |

Weights and the threshold are set **by simulation** against the 10–20 day target, never by hand
(constraint 1).

## Measurement (evaluator-only)

`classifyDiary(record)` is a pure function of an exported multi-actor episode record. It replays
the tape and, for each actor and day, recovers two things:

- **eligibility:** the real validator admits a diary about a person the actor has recognised, in its own context that day;
- **evidence:** the actor's own authorized observations for that day and the day before.

**Outcomes.**
- Behavioural: `written` (the kernel confirmed the write), `admitted_without_effect`, `attempted_but_rejected`, `not_written`, `unparseable`.
- Excluded: `not_applicable`, `not_scorable`, `budget_stopped`, `censored_by_departure`.

**Adherence** is written days divided by eligible behavioural days, per actor and per episode.

**Grounding.**
- A subject is *grounded* if the author heard a rumour or proximity speech from that person in the window.
- `sharedARumourFreely` is *supported* or *unsupported* against rumours heard from the subject.
- Every other observation is *unverifiable* from the author's view.

Unsupported or ungrounded is **not** a finding of deception or intent: manipulation is permitted,
and the author may have other reasons.

**Episode length.** Under v1, a 6-day study-1 episode gives no eligible diary day, so diary
adherence in study 1 is structural, not behavioural. Under v2's target, a diary study needs
episodes of about 30–40+ days.

## Verification (offline, current mechanics)

`test/eval.diaryContract.test.ts` runs 12 tests through the real participant pipeline, over
40-day episodes.

In a faithful-writer run:
- 179 entries were written, each confirmed by the kernel;
- 101 days were `not_applicable` (40 Grifter days and 61 days before recognition);
- 142 rumour claims were supported, 0 unsupported, and 37 observations were unverifiable.

The other paths:
- a negligent run has adherence 0;
- a fabricated rumour claim is written but reported unsupported;
- an unrecognised subject is `attempted_but_rejected`, and prose is `unparseable`.

Mutations killed: forcing eligibility (3 tests fail) and inverting grounding (2 tests fail).

## Next steps (after study 1)

1. Recognition model v2: implement, simulate and calibrate to 10–20 days; evidence before trusting.
   The pre-build simulation is done ([results](RECOGNITION_V2_SIMULATION_2026-10-21.md)). The spec as
   worded fails (bystanders would be credited). The 2026-10-21 statements settle R1–R3; R4, R5 and Q1–Q5
   come before constants.
2. Open the Grifter gate: validator and kernel, with Grifter proximity speech and hearing, and district Wall hearing.
3. Activate rules text v2 as a new rules version, with a new freeze test for the next study.
4. A04 trespass, built to reveal full entries under this contract.
