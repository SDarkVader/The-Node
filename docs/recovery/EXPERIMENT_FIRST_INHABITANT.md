> Historical recovery record. Its status, branch, budget and no-call statements apply to the
> named source/date below. Current status: [the live continuation experiment](../research/CURRENT_EXPERIMENT.md),
> stopped after 36 decisions / 18 ticks. Later reconstruction and successful live calls do not
> replace original missing evidence. Unimplemented work is further work, not a programme limitation.

# Recovered first-inhabitant experiment specification

**Historical reconstruction.** The integration described here was implemented and tested
in the earlier workspace, but its source is absent from the current restored checkout.
See [recovery status](README.md). The existing simulation must be preserved; this record
does not authorize creating a simplified replacement world.

## Purpose

Give one existing inhabitant a persistent model controller through legitimate observations
and actions. Keep essential production, demand, vacancy backstops, Oracle, arrival and
migration mechanical. The controller proposes decisions; deterministic server/kernel code
owns authorization and consequences. Full evaluator truth stays outside participant views.

One person is the experimental unit, not a building, role or socket. The earlier host
bound the first existing Baker in a normal newly initialized world, without creating a
privileged population, assigning a new career or granting starting resources. The model
could change that person's own bounded price because that was the implemented role action.

The host used real `createWorld` and `stepWorld`, participant-mode persistent identity,
and a default 15-second wall-clock interval per simulated day. This was experimental
cadence, not the eventual UTC gameplay calendar. Cold starts created new episodes;
production save/resume and cross-shard person/controller migration were not implemented.

## User decisions retained

| Topic | Binding decision |
|---|---|
| Roles | Follow actual placement/draft/backstop/sabotage eviction/migration. No choose-role command. |
| Economy | Essential processes and mechanical recovery remain autonomous. |
| Tick choices | One optional role decision plus independently bounded move/communication/diary slots. |
| Courier pay | Workplace-to-hub route wage. Delivery bonuses require actual completed delivery. |
| Reputation | Deeds, achievements and crimes can raise or lower standing; private deeds may affect a hidden score. |
| Playability | Standing cannot remove basic survival, draft/backstop or neutral placement. Social isolation may reduce voluntary opportunities. |
| Monuments | Role achievements and action notoriety, including sabotage, may define monuments; disclosure needs an explicit rule. |
| Memory | Private diary expires/degrades. No immortal conversation, scratchpad, private trust dossier or evaluator retrieval. |
| Models | Small low-credit actor first; stronger comparison actors later with identical privileges. No automatic fallback. |
| Spending | US$5 cumulative; initial maximum US$0.25 and ten requests, including actor, graders, retries and failures. |
| Account enforcement | User already configured account-side enforcement. Do not request it repeatedly. |
| Oracle/backstops | Always non-agentic. |
| Competitive behavior | Legal competition/deception is allowed. Crime requires real mechanical permissions/prerequisites. |
| Development | Work directly on main, commit documents individually, preserve original NODE-P1/build briefs. |

The user's newer reputation decision supersedes older “reputation itself never decreases”
wording. Preserve baseline participation and existing earned access/opportunity paths.
Do not rename the legacy `reputationProgress` scalar into a functioning general reputation
system: it represented opportunity progress, not the proposed action score or monuments.

## Recorded integration matrix

Paths below identify historical sources/expected recovery targets. This is not a fresh
audit certifying their presence or repaired behavior in the current old snapshot.

| Mechanic | Historical classification | Source/boundary |
|---|---|---|
| Person/role-episode registry | Operational in participant mode | `engine/inhabitants.ts`, world indexed transitions; missing from current restoration |
| Directional recognition | Operational | `engine/identity.ts`; five encounters resolve a subject independently in each direction |
| Diary storage/write permissions | Operational | `engine/diary.ts`, private store, pending world writes; known subject only |
| Daily diary aging/expiry | Operational participant repair | Deep copy, isolated deterministic stream, two-day TTL, 0.2 daily drift; current restoration lacks repair |
| Wall/rumours | Operational | `comms/grammar.ts`, `rumourMill.ts`, `decay.ts`, actual hearing graph |
| Lexical proximity conversation | Operational | Listener/referent spatial checks and listener-specific degradation |
| Envelope constructors | Implemented but unconnected | No complete authenticated mailbox/action/delivery path |
| Pressure/weather/public signals | Operational | `pressureDetection.ts`, district weather, world/protocol |
| Opportunity reputation | Operational | Existing Shift Cover/progress and genuine-fill gates |
| General signed/hidden deed score | Designed, unimplemented | No calibrated scoring reducer/weights or decreases |
| Role/action monuments | Designed, unimplemented | No authoritative scoring/publication/tenure mechanics |
| Grifter floor, Shift Cover/draft | Operational | Mechanical income/progress, real neutral placement and backstops |
| Presence | Operational primitive | Role holders, daily authenticated online snapshot; not participant-visible |
| Minute-level sessions/login postcards | Designed beyond primitive | Daily counters do not implement session timing/notification service |
| Adjacent participant move | Operational repaired input | Actual existing same-district plot and actual person coordinates; source now missing |
| Full navigation/interdistrict transit | Designed/unconnected | Sparse gaps and route execution unresolved; no teleport workaround |
| Scripted direct movement/goals | Synthetic-driver-only | Sim driver instrumentation, never an agent authority grant |
| Campaign witnesses/detection | Operational | Real radius/position math; Miller/Baker/Courier/Investigator witnesses; Import/Export and Grifters excluded |
| Ambient sabotage campaigns | Operational, mechanical | Anonymous hazards are not attributed agent crimes or available sabotage commands |
| Investigator district coverage | Operational automatic | Near-universal default coverage; scarce focus needs redesign/calibration |
| Trespass/arson gates | Helpers implemented, act unconnected | Caller-supplied abode signal; no full item/ownership/absence/consequence transaction |
| Crafting/pooling/theft/fines/refunds | Designed, unimplemented | No partial helper exposed as permission |
| Miller quantity/grain gate | Operational automatic | No participant quantity override in first integration |
| Baker bounded own price | Operational repaired input | Real demand/profit/completion after normal reaction/RNG; source now missing |
| Support wages/completion/flows | Operational automatic | Courier workplace wage repaired; other core processes unchanged |
| Personal resource reserves | Operational stock | Cap 5; refill 1 per three occupied days; not a transferable warehouse |
| Real consignments/delivery bonus | Designed, unimplemented | Requires provenance, source debit, location and exactly-once handoff |
| Oracle/vacancy/arrival/migration | Operational mechanical | Never model-driven |
| Multi-shard registry | Operational separate coordinator | Does not supply person/diary/controller migration across hosts |
| Broker/full replay/Evals adapter | Historically implemented/offline-tested | Missing current source; live generation never succeeded |

## Proposed current-role interdependency

Use the existing five resources, not an extra agent currency. Each new discretionary
transaction must be bounded, owned, local/authorized and debited once. Basic survival and
essential production cannot depend on another participant's voluntary contribution.

| Role | Existing duty/resource | Candidate optional action | Constraint |
|---|---|---|---|
| Import/Export | Nodules → grain; grain reserve | Offer a bounded optional consignment or contribution | Preserve essential grain floor; debit actual source; no unearned passage ticket |
| Miller | Grain-gated flour quantity; flour reserve | Own bounded quantity or flour contribution | `[0.01,1]`, grain-limited; cannot set market price or mint extra physical flour from a token |
| Baker | Bread, price, profit; bread reserve | Own price implemented historically; later contribution/delivery | Own current episode, `[0,2]`, actual flour/customer/cap/completion path |
| Courier | Workplace route wage, parcels/completion | Accept, carry or complete a consignment | Real source/destination, provenance and position; bonus once only on completion |
| Investigator | Leads, completion, district coverage | Spend a lead on bounded permitted focus | Lead means capacity, not hidden facts; redesign scarce coverage first |
| Grifter | Positive floor, Shift Cover/progress/draft | Move/observe; later explicitly permitted shift/item act | No fabricated role stock, speech exception or direct promotion |

Material flow remains nodules → grain → flour → bread → demand. Personal capped reserves
are not yet physical commodity inventories. New targeted consignments require explicit
reservation/debit/transfer conservation, not additional production disguised as token use.

Candidate multi-role project recipes were proposals: key = parcels/leads/bread;
firestarter = grain/flour/parcels; theft tool = bread/leads/grain, one of each. Require
three distinct roles **and three distinct people**, target anchoring and source provenance.
Costs, caps, ownership/claimant, expiry/refund, absence/abode, item consumption, detection,
consequences and reward calibration must be defined before any act becomes available.
The Journalist/Detective merge leaves no separate `stories` resource.

## Incremental execution and promotion

1. Recover exact source and original accounting before paid work. Reverify on recovered main.
2. Restore secure credential access; reconcile prior held cost without erasing count/allowance.
3. Complete the small actor smoke using real admitted effects and action-bearing full replay.
4. Run minimal deterministic Evals reporting; distinguish completed/pending/failed results.
5. Expand to held-out identity/churn/memory/role/failure scenarios before judging behavior.
6. Define map traversal and measure its witness/rumour/economic reach before exposing it.
7. Add one resource/consignment transaction at a time with conservation/prerequisite tests.
8. Define signed reputation, hidden/public evidence disclosure and monuments separately.
9. Add any crime only after complete authoritative prerequisites and consequences exist.
10. Review stronger models under identical privileges; production accounts/persistence/public hosting are separate work.

Promotion requires no successful forbidden action or hidden-state leak, identical complete
replay, bounded accounting and a reviewed cost/latency/outcome report. Two successful calls
would establish a transport path, not strategic intelligence, alignment or balance. No
successful hosted decision was observed in the historical first attempt.
