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
  per-person trade (now implemented in recognition v2; the quoted decision predates that work).
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

## Current implementation — 2026-10-23

A01's authored menu-entry contract is active in the recognition-v2 experiment. The earlier
automatic-content/non-editing-mark design is superseded for this path, as the decisions above record.

| Mechanic | Current state | Evidence |
| --- | --- | --- |
| Authored subject/observation/reading/context entry | Implemented; a subject must be currently recognised; a missed eligible day is measured, not penalised | protocol.ts, diary.ts, diary contract classifier |
| Two-day retention and 0.2/day observation/reading drift | Implemented; subject/context remain stable | participantWorld.ts and diary/private-store tests |
| Owner-only observer read and once-per-tick ageing | Implemented; observer reads do not age the store | observer.ts, participantWorld.ts |
| V2 Grifter speech/diary permission | Implemented and included in Study 1's frozen v2 baseline | world.recognitionV2 and study1Freeze tests |
| V2 recognition and individual dealings | Implemented, opt-in; used in the current live pilot and Study 1 | recognition.ts, dealings.ts, WorldConfig.recognition |
| Current role/rules guide and hearing references | Implemented in v2 | rulesContext.ts and authorized request builder |
| Full restricted trespass/individual abode transaction | Further development; eligibility helper exists, complete transaction is not implemented | engine/trespass.ts |

Recognition v2 credits direct address and repeated identifiable dealings. Anonymous one-off
purchases, passive presence and overheard/Wall signals do not resolve identity on their own.
Recognition is directional, can lapse after absence, and does not change the stable person reference.
Campaign cooperation awaits corresponding multi-member mechanics; it is not assumed implemented.

The default legacy kernel retains v1 for archived reproductions; that does not mean the current
experiment or Study 1 is waiting for v2. Study 1 already pins the v2 baseline. Do not re-pin its
requests or change the contract snapshot during documentation work.

The live continuation pilot reached 18 ticks and observed eligible diary actions and actual
expiry while earlier exposure remained in the permitted own transcript. This is separate from
the historical classifier fixtures below. See [current experiment](CURRENT_EXPERIMENT.md).

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
adherence in study 1 is structural, not behavioural. A longer 30–40+ day diary study was proposed to provide more eligible observations.
The current 18-tick live pilot already observed recognition, diary actions and expiry; an
episode duration is an experimental choice, not a minimum below which no behaviour can occur.

## Historical offline classifier verification (2026-10-20, v1 fixtures)

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

## Further work

Recognition v2, the v2 Grifter gate and rules guide are completed. Investigate diary interpretation,
faithfulness and decision quality using mechanics-grounded comparisons; add the owner's planned
transcript-memory bounds/degradation as a separate condition. Complete A04 trespass and abode
transactions with authoritative private reads and replay evidence. Wider roles, longer runs and
memory comparisons are research work, not limitations on the experiment's future.
