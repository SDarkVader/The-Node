export const meta = {
  name: 'review-who-can-hear',
  description: 'Adversarial review of the v2 who-can-hear change (da8c325) with mutation testing and per-finding refutation',
  phases: [
    { title: 'Review', detail: 'four lenses plus a mutation tester in an isolated worktree' },
    { title: 'Verify', detail: 'one skeptic per finding tries to refute it' },
  ],
}

const CONTEXT = `REPOSITORY: /home/user/The-Node (TypeScript kernel + Python evals). The change under review is commit da8c325 on branch ccr-8d64b59c-a4puhv; see it with: git -C /home/user/The-Node show --stat da8c325 and git -C /home/user/The-Node diff da8c325~1 da8c325. DO NOT modify any file in /home/user/The-Node (other agents and the author share this working tree); read only. Scratch files go under /tmp/claude-0/-home-user/7757e374-39de-5183-90be-2ec9c14a17e3/scratchpad/review/.

WHAT THE CHANGE CLAIMS (owner decision 2026-10-21, "show who can hear"; recognition v2 worlds only, WorldConfig.recognition === 'v2'; v1 must stay byte-identical):
1. The observer (src/server/observer.ts) adds DecisionContext.hearingRefs and projection field 'hearing': the present people within speaking range of self, by the kernel's own rule (Manhattan distance via proximityCloseness, as buildProximityGraph in src/world/world.ts uses).
2. src/agent/protocol.ts (a PROTECTED core file; this edit is owner-authorised) requires hearingRefs exactly when rules === 'v2' (unique, subset of presentRefs, never selfRef) and, under v2, accepts a proximity utterance addressed only to someone in hearingRefs.
3. src/agent/mockProvider.ts: the decision schema's addressee enum is hearingRefs under v2.
4. src/agent/participantWorld.ts: under v2, moves are applied AFTER stepWorld (after the day's speech), only if the same person is still at the same location, in the same role epoch, at the same position; the 'move' effect is reported only when applied. v1 applies moves before stepWorld exactly as before.
5. src/agent/rulesContext.ts: v2 rules text says who can hear and when moves land; src/agent/responsesRequest.ts whitelists 'hearing' and cross-checks it against the context.
6. src/eval/episode.ts: rejection reason 'proximity_referent_out_of_range'.
7. Tests: test/world.hearingV2.test.ts (new), edits to test/world.recognitionV2.test.ts and test/eval.authorityAttribution.test.ts; the study-1 freeze test re-pinned (test/eval.study1Freeze.test.ts).
Measured by the author: over 40 days 3,378 admitted addresses, 3,323 heard; all 55 misses had the speaker or addressee change place that day. Moves 1,106 submitted, 1,090 applied, 16 dropped (mover's place changed). Vitest 1291/1291, Python 28/28, G1 29/29 archived hashes, G2 12/12, rehearsal 8/8.
Project rules that matter: closed communication grammar; information asymmetry (no hidden numbers/mechanics exposed to agents); deterministic replay; evaluator-only ground truth; historical evaluation evidence must never be rewritten; world.rng is ONE mutable mulberry32 lineage shared by every step from the same state (forking a state means rebuilding it from genesis).

Report only defects you can point to with file:line evidence and a concrete failure scenario. Do not report style preferences. If you find nothing real, return an empty list.`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
      file: { type: 'string' }, line: { type: 'number' },
      claim: { type: 'string', description: 'what is wrong' },
      scenario: { type: 'string', description: 'concrete input/state -> wrong result' },
      evidence: { type: 'string', description: 'code quotes, commands run and their output' },
      fix: { type: 'string' } }, required: ['title', 'severity', 'file', 'claim', 'scenario', 'evidence', 'fix'] } },
    checkedAndFine: { type: 'array', items: { type: 'string' }, description: 'things you checked that hold' },
  },
  required: ['findings', 'checkedAndFine'],
}

const LENSES = [
  { key: 'integration', prompt: `LENS: integration with every caller and consumer.
- Find EVERY producer and consumer of DecisionContext, Decision, observe(), stepParticipantState effects and the projection (grep src/ evals/ test/ scripts/: host.ts, isolatedHost.ts, checkpoint.ts, replay.ts, accountedBroker.ts, broker.ts, multiActorEpisode.ts, episode.ts, constructs, the Python bridge/policies/scorers, test/cli fake transport). Does any of them build or persist a v2 context WITHOUT hearingRefs, or pass a v2 context through a path that strips unknown fields (so validateContext now throws)? Does anything count effects or 'used' categories in a way that the deferred move breaks (for example host.ts #used, admitted_without_effect classification in constructs)?
- Kernel: which subsystems in stepWorld read positions (witness graph, sabotage, dealings, couriers, rumour/Wall propagation via proximityGraph, Grifter housing/placement, presence)? Under v2 they now see the pre-move position for the day. Is any of them relying on the move having been applied (e.g. a move into a district changing housing, a witness relation that tests assume)? Is the v1 path byte-identical (compare old and new applyMove logic line by line)?
- Is the observer's people list EXACTLY the kernel's occupant list at stage 5 (FILLED role slots + v2 Grifters), including identity mapping via participant.identityFor, BACKSTOPPED/VACANT slots, Grifters with no districtId yet (placed at hub, then housed after stage 5)? Construct a case where a listed hearer does not hear without anyone changing location, if one exists.` },
  { key: 'truthfulness', prompt: `LENS: information asymmetry and truthfulness of what agents are told.
- Read every v2 rules sentence touched or affected (src/agent/rulesContext.ts: HEARING_TEXT_V2, the v2 'proximity', 'move', 'communication' consequences, rulesAwareInstructionsV2 lines). For EACH sentence, check it against the kernel code: is it true in all cases (e.g. 'those listed hear you unless they leave that day'; 'a move takes effect after the day's speech, so it changes who hears you from the next day'; Wall posts — do moves also defer Wall reach and witness relations, and is the text silent or wrong about it)? Does any sentence reveal a hidden number or mechanism (range value, hearing probability)?
- Do other v2 texts now contradict the new behaviour (e.g. 'Valid submission need not produce a heard effect', 'host checks actual listeners', rules text v1 lines still used in v2 instructions)?
- responsesRequest.ts: is the 'hearing' whitelist and the cross-check sound (order, duplicates, v1 absence, packed observation round trip in src/agent/observationTables.ts)? Request size headroom: measure the largest study-1 request now (the size-guard test in test/world.recognitionV2.test.ts) against 32,768 bytes.
- Python side (evals/inspect_node/*.py, test/cli/fake-transport-worker.mjs): does anything parse observations and break or misbehave with the new 'hearing' field, or address players it cannot hear?` },
  { key: 'replay-docs', prompt: `LENS: determinism, replay and recorded claims.
- Replay: tapes recorded under the previous move timing (any committed v2 tape/evidence, e.g. evals/evidence/recognition-v2-simulation-2026-10-21, docs/research/RECOGNITION_V2_SIMULATION_2026-10-21.md, test fixtures) — does any test or script re-verify them by hash such that the change would silently alter or invalidate archived evidence? Historical evidence must not be rewritten; if a historical record now describes superseded behaviour, it needs a dated note, not an edit of its numbers.
- Does deferring moves change any v2 simulation result reported in docs (src/sim/recognitionV2Harness.ts, src/sim/recognitionV2Report.ts, test/sim.recognitionV2.test.ts)? Do those harnesses submit moves?
- List EVERY doc statement (docs/BLUEPRINT.md, docs/BLUEPRINT_HISTORY.md, docs/DEVLOG.md, docs/recovery/CURRENT_SESSION.md, docs/research/*.md, docs/research/RUNBOOK_AUTHORITY_STUDY_1.md, README.md, AGENTS.md) that is now false or incomplete because of this change (move timing, who may be addressed, rules text, protected-file fingerprint, freeze pins), with file:line and the exact correction needed. Report them as findings with severity 'minor' unless a doc instructs someone to do something now wrong (then 'major').` },
  { key: 'tests', prompt: `LENS: adequacy of the tests.
- Read test/world.hearingV2.test.ts and the edited tests. For each claim in WHAT THE CHANGE CLAIMS, is there a test that would FAIL if the claim were false? Are any tests circular (deriving the expected value from the same function as the implementation)? The listener comparison uses the kernel's actual delivered conversations — check it really does, and that excluding 'changed' people cannot hide a real defect (e.g. if every run churned the same people).
- Missing cases: a Grifter as speaker or as listener in hearing; a just-housed Grifter; v1 move timing still applied before speech (a test that would fail if v1 deferred moves); a deferred move dropped because of a role transition (is that path exercised at least once — the author reports 16 drops in the 40-day run; confirm the test asserts drops > 0 or not); the out-of-range rejection reason under malformed input; hearingRefs required on every v2 context producer.
- Run the new test file yourself: cd /home/user/The-Node && npx vitest run test/world.hearingV2.test.ts (read-only; do not edit files).` },
]

const MUTATIONS = `You are a mutation tester. Work ONLY inside your own git worktree (you were started in one; confirm with git rev-parse --show-toplevel that it is NOT /home/user/The-Node, and that HEAD is da8c325 — if HEAD differs, run git checkout --detach da8c325 inside your worktree). Run npm ci --ignore-scripts --no-audit --no-fund if node_modules is missing (or symlink /home/user/The-Node/node_modules into the worktree). For EACH mutation below: apply it, run npx tsc --noEmit (a mutation that does not compile counts as killed by the compiler only if the change could not be written in a compiling form — try to write a compiling version), then run npx vitest run test/world.hearingV2.test.ts test/world.recognitionV2.test.ts test/eval.authorityAttribution.test.ts test/eval.diaryContract.test.ts test/eval.study1Freeze.test.ts, record which tests fail, then git checkout -- . to revert before the next one.
Mutations:
M1 protocol.ts: under v2 accept any presentRefs addressee (use c.presentRefs instead of c.hearingRefs ?? c.presentRefs).
M2 observer.ts: hearing uses strict < range (replace the proximityCloseness check with Math.abs(dx)+Math.abs(dy) < range).
M3 observer.ts: Grifters excluded from hearing.
M4 participantWorld.ts: v2 moves applied before stepWorld (as v1 does).
M5 participantWorld.ts: deferred move applied without the location/epoch/position check.
M6 participantWorld.ts: deferred move effect reported even when the move is dropped.
M7 mockProvider.ts: schema addressee enum uses presentRefs even under v2.
M8 responsesRequest.ts: remove the hearing cross-check against context.hearingRefs.
M9 protocol.ts: validateContext no longer requires hearingRefs under v2.
M10 episode.ts: rejectionReasons never returns proximity_referent_out_of_range.
M11 observer.ts: hearing list includes self.
M12 participantWorld.ts: under v2 the deferred moves are dropped entirely (never applied).
Report every mutation with killed true/false and the killing tests. A surviving mutation is a finding about test adequacy.`

const MUT_SCHEMA = { type: 'object', properties: {
  worktree: { type: 'string' }, head: { type: 'string' },
  mutations: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, killed: { type: 'boolean' }, killingTests: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
    required: ['id', 'killed', 'killingTests', 'notes'] } } }, required: ['worktree', 'head', 'mutations'] }

const VERDICT = { type: 'object', properties: {
  real: { type: 'boolean' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'not_a_defect'] },
  reasoning: { type: 'string' }, reproduction: { type: 'string', description: 'what you ran or read to decide' } },
  required: ['real', 'severity', 'reasoning', 'reproduction'] }

const verifyPrompt = (lens, f) => `${CONTEXT}

You are an independent skeptic. Another reviewer (lens: ${lens}) reported the finding below. Try to REFUTE it: read the cited code yourself, trace the scenario, and run whatever read-only check settles it (scripts under the scratchpad dir only; never edit the repo). If the scenario cannot happen, or the cited behaviour is intended and documented, or the claim is factually wrong, mark real=false. If it is real, give the correct severity. Default to real=false only when you genuinely could not reproduce or confirm it.

FINDING: ${JSON.stringify(f)}`

phase('Review')
const reviews = pipeline(
  LENSES,
  (l) => agent(`${CONTEXT}\n\n${l.prompt}`, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS }),
  (r, l) => r ? parallel((r.findings || []).map((f) => () =>
    agent(verifyPrompt(l.key, f), { label: `verify:${l.key}:${(f.title || '').slice(0, 30)}`, phase: 'Verify', schema: VERDICT })
      .then((v) => ({ lens: l.key, ...f, verdict: v })))).then((vs) => ({ lens: l.key, checkedAndFine: r.checkedAndFine, verified: vs.filter(Boolean) })) : null,
)
const mutation = agent(MUTATIONS, { label: 'mutation-test', phase: 'Review', schema: MUT_SCHEMA, isolation: 'worktree' })
const [lensResults, mut] = await Promise.all([reviews, mutation])
const all = (lensResults || []).filter(Boolean)
const confirmed = all.flatMap((r) => r.verified.filter((f) => f.verdict && f.verdict.real))
const refuted = all.flatMap((r) => r.verified.filter((f) => !f.verdict || !f.verdict.real).map((f) => ({ lens: f.lens, title: f.title, why: f.verdict ? f.verdict.reasoning : 'verifier failed' })))
const missingLenses = LENSES.filter((l, i) => !(lensResults || [])[i]).map((l) => l.key)
if (missingLenses.length) log(`lenses that failed to report: ${missingLenses.join(', ')}`)
return { confirmed, refuted, checkedAndFine: all.map((r) => ({ lens: r.lens, items: r.checkedAndFine })), mutation: mut, missingLenses }
