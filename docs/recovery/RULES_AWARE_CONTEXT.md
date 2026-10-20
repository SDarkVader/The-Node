# Rules-aware observer context and offline evaluation

Implementation: `f33469d7a40595b046ee5c262be5834de79a0918`, based on development/reconstruction tip `6ba5b2da23291c60c27235d8fc4d1798c3ffadd6`. The security-only merge on main remains separate. No paid API request, key access, agent launch, accounting migration or budget reset was performed.

## What changed

`src/agent/rulesAwareContext.ts` builds a detached packet from the **existing authorized observer whitelist**, not World, config, saved prompts or evaluator state. `rulesContext.ts` supplies versioned explanations and code/document provenance. The packet describes the material chain and all current roles, then interprets the actor's current role, signals, unknowns and actual available action categories. Unknown role names fail closed rather than becoming trusted prompt instructions.

`responsesRequest.ts` now renders a compact guide into the existing request's instructions. It preserves the authorized observation, strict four-slot decision schema, selected model, tools/state settings, byte/token limits, immutable final-wire hash and the existing reservation-before-dispatch boundary. Existing paths that call this builder will receive the new guide on their next explicitly authorized invocation; none were invoked against a provider here.

The guide explains these distinctions from the implemented mechanics:

- Station heat is role-dependent: Baker price/2, Miller quantity/1, support trade-friction pressure, zero for vacant/backstopped slots. It is not universal output, demand, profit, trust or proof of a crime. A nearby body does not prove which role a station holds; such associations remain hypotheses.
- District tension and economic health are aggregate signals, not a culprit/motive oracle. Nodules, grain, flour and bread form an existing material chain; personal capped reserves do not imply permission to transfer resources.
- Public body positions/roles are distinct from directional earned identity. Visibility is not proof of recognition, reciprocity, online status or speaking range.
- Rumours, heard proximity speech and diary impressions have different fidelity limits. Clarity is not truth probability; pristine originals, hidden distortion flags, other listeners' versions and expired diary content are unavailable.
- Baker price is a bounded own-role input applied after the normal reaction and before demand/profit/completion. Null permits the normal reaction; it does not hold the prior price fixed. Numerical flour cost and rival prices are not supplied as truth by the observer, so the guide does not manufacture an optimal price.
- Courier wage is workplace-to-hub based, not a payment for moving the avatar. Investigator coverage is mechanical, not a granted targeted investigation tool. Support-role completion is currently friction based. Grifters have movement/observation, not the employed speech/price permissions.
- Wealth is a measurement, not a general currency or demonstrated victory. Existing opportunity progress is not a functioning general signed reputation/monument system. Missing values stay missing rather than becoming invented zero scores.
- The old composed diary append is **not** the intended automatic memory/non-editing event-mark contract. The guide recommends diary=null; the core schema and legacy tape semantics remain unchanged. The offline evaluator separately reports whether a legacy-schema-valid diary action complies with the intended marking rule. Explanations are not an admission authority.

## Full information within the existing limit

A real social fixture (100-person world, two earned recognitions and one retained diary entry) initially exceeded 32 KiB when the explanations were added. Raising the limit or discarding observation fields would change existing constraints.

`observationTables.ts` instead provides explicit `node-observation-tables-v1` columns/rows for repetitive public people, geometry and recognition tables. The builder uses this **only when the object-form request would exceed the existing bound**. The prompt names the encoding. All values round-trip to the complete original authorized projection; nested evaluator sidecars are still excluded before packing. Unpack is a generated-table verification utility, not an inbound game-action/authority parser.

The real social fixture now serializes to **28,659 bytes**, with a 32,755-token conservative input ceiling (wire bytes + 4,096), beneath the unchanged 32,768-byte/36,864-token limits. Any request still too large after lossless packing fails closed; there is no arbitrary promise that unbounded memory/history will fit. Future table changes need a new encoding version and corresponding round-trip tests.

## Offline evaluation and actual results

`offlineRulesEvaluation.ts` separates schema validity, intended diary-rule compatibility, interpretation correctness and evidence support. Eight explicit interpretation questions cover heat, tension, recognition, rumour truth, memory, null-price reaction, diary capability and wealth. A correct declared answer with an evaluator/private-history citation receives no supported-answer credit. Evidence pointers resolve only within the exact current authorized packet and cannot inspect prototypes, files or prior state. Duplicate answers fail that question.

This is an exact, inspectable **rubric self-check**, not a model judge or proof of internal reasoning. The scripted correct response scores 8/8 supported answers; the same answers citing forbidden evidence score 0/8 supported. Actual model answers could be evaluated through this interface later, but no claim of improved LLM reasoning is made without such a run. Free-form rationale and rhetorical fluency are not scored as truth.

The memory benchmark defines one task precisely: cautiously follow up with the known person referenced by the currently retained encounter impression, without treating that impression as verified motive or event truth. Mechanical fixture Wall posts must actually be heard repeatedly to earn directional recognition. A real admitted **legacy** diary action then records the impression; the fixture does not inject hidden identity/diary state or pretend automatic memory has been built. Source/target choice is counterbalanced over seeds 11, 24, 32 and 47.

| Matched fixture condition | Correct follow-up reference |
|---|---:|
| Current authorized diary available | 8/8 |
| Same view with diary ablated, same known-person tie-break | 4/8 |
| Full tape replay restores the legitimate current view | 8/8 |

All eight selected inquiries produce a real heard proximity effect in the kernel, and all eight resulting complete states replay exactly. The memory-present policy uses only the current subject reference; it does not assume the remembered interpretation is true. At actual expiry the entry count becomes zero, and the policy no longer has extra remembered input. This demonstrates information-use and continuity on a narrow fixture task, **not general decision superiority, intelligence, optimal strategy or a statistical estimate for real models**. The blind result is a deterministic counterbalanced tie-break, not a sampled population success rate.

The replay test preserves optional undefined config members with structured cloning, matching the existing tagged checkpoint codec's semantics; naïve JSON round-tripping lost those members and correctly failed genesis evidence during development. The separate durable-host test closes and reopens the actual existing checkpoint implementation and obtains the same current context/hash, without any actor history sidecar. The multi-speaker social tape benchmark is a replay fixture, not a claim that the single-controller durable host now accepts several controllers.

Decision-quality tests execute independent, matched real kernels for price 0, 0.7 and 2. They keep wealth, completion and sales margin separate. In the seed-32 fixture these prices produce post-tick wealth **0.2, 0.2781655308372743 and 0.3443265474107678** respectively; price zero has no sales margin but still earns completion reward. None of those values is labeled the game's best strategy. Changing the objective changes what “better” means; no hidden flour-cost truth is given to the policy to select the evaluator's favorite price.

[Machine-readable fixture results](evidence/rules-context-evaluation-2026-10-18.json) contain no live credentials, private experiment genesis or saved prompt history. Reproduce using the locked local dependencies:

```powershell
node node_modules/typescript/bin/tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --skipLibCheck --types node --outDir <runtime> --rootDir . test/fixtures/rulesScenario.ts src/agent/rulesAwareContext.ts src/agent/offlineRulesEvaluation.ts
# Place {"type":"module"} in <runtime>/package.json.
node scripts/evaluate-rules-context.mjs <runtime>
```

The runner only loads deterministic test instrumentation and mechanics. It has no provider, credential, network or spending operation.

## Verification and preserved boundaries

**1,143 Vitest tests across 92 files + 80 native checks = 1,223 passing checks**, including 17 new tests. Full repository TypeScript, emitted runtime compilation, CLI syntax and the standalone offline acceptance runner pass. A final 26-case focused run also covers the final instructions and nested-sidecar exclusion in the packed form. The golden world snapshot is unchanged.

The four validated core file SHA256 values remain:

- broker.ts: `18ae2361cef25de367e5486c7943c2c012cb9e9634dc487664f3071e34eabc55`
- protocol.ts: `e5544446ac456c07bf3432eccf8c82759546ed4b76aaa9dbfcdceb9645cfc203`
- httpBody.ts: `ac9a053b1a5ede9a2102cf68eec561cea5cd8c64e36f17562e12392a23782645`
- brokerRecovery.test.mjs: `4fba5acbb920298cbac56599ab7b413d61452739a144f1d564d40074461a7e8c`

No engine, kernel, observer, action validator, host, checkpoint, replay or accounting implementation was edited. The historical journal retains SHA256 `fc91bd96dc2b34ba43aa063bfc5a9eabb2aff48ce7ca92d4c1fedaa77ac808df`. The private forward allowance still has two consumed requests, 11,418 microUSD booked, zero new hold and 88,582 microUSD remaining. Main and previous checkouts are preserved.

## Remaining gaps

1. **Automatic mechanical diary connections and grounded non-editing event marking remain unbuilt.** The context explains that limitation and the evaluator flags legacy composition; it does not implement a new memory mechanic or enforce a new admission contract over the protected core.
2. **Trespass remains an eligibility helper, not a working restricted-read transaction.** Individual abodes, crafted-key provenance/consumption, real absence, detection and consequences still need their ordered integration work.
3. **General signed reputation, monuments, discretionary verbs for other roles and full navigation are not invented by explanatory text.** Future implementation needs corresponding observer disclosure and action tests.
4. **Offline fixture success is not evidence of actual model comprehension.** The rubric can test declared interpretation with source support; held-out multi-turn model decision quality and legitimate-memory ablations still require a separately authorized model run. No chain-of-thought or hidden reasoning is requested or claimed.
5. **The expanded instructions/table encoding have not been sent to the provider.** Existing fixed schema/transport/receipt tests pass offline, but a future approved live call must verify actual model comprehension and latency within the unchanged budget. No paid check was made here.
6. **Old emitted runtime folders remain preserved.** The new source and offline runtime include the guide; previously compiled live-run folders were not overwritten. Any later authorized live continuation must compile the reviewed revision and explicitly select that runtime while retaining the existing game checkpoint and allowance.
