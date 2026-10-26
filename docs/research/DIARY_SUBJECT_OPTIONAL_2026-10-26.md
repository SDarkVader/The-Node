# Subject-optional constrained diary — 2026-10-26

Owner decision: keep the constrained vocabulary and make the subject optional. A diversion
uses `subject: null` with one existing observation, one existing reading and optional existing
context. There is no prose slot or factual verification. A named subject must still be a
recognised other person. All implemented roles and roleless inhabitants use the same rule.

`WorldConfig.diarySubjectOptional: true` pins the new admission into genesis and the initial
world hash. Absent means the historical contract. The context, schema, exact serialized
allowlist, fixed worker and kernel agree on the distinction. The generic action parser
requires an explicit trusted option to parse a null subject. Slot drift and two-day expiry
remain the existing daily mechanism. The subject stays null through drift.

The canonical configured PC launcher selects this contract for fresh runs, keeping the same
review, carried accounting and human START flow. Standalone preparation supports
`-OptionalDiarySubject` on `scripts/start-society-playtest.ps1`; the offline CLI supports
`--optional-diary-subject`. Review rechecks reject a diary-contract mismatch with genesis.
Previously prepared plans do not acquire the feature: they remain source-pinned.

This slice does not yet implement multiple action turns, mandatory completion before day
rollover, physical task visits or full abode/trespass transactions. These remain required.
The owner clarified that a recorded failed food attempt permits day completion after the
other duties; no bread, wealth or Oracle win is fabricated to satisfy a duty.

Verification covers actual worker admission, kernel write, persisted replay, all six role
categories, free-text/self/unknown-subject rejection, permanent simulation halt on an illegal
submission, unchanged legacy admission, review/genesis binding, drift and expiry. Source-bound
full regression and cold CLI evidence are recorded in recovery when completed.
