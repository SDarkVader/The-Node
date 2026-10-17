# Recovered observer/action/broker protocol

**Historical reconstruction; source currently missing.** The following records the earlier
implemented `node-inhabitant-v1` contract and recovery targets. It is not a claim that the
restored old server enforces these safeguards. [Current recovery status](README.md).

## Trust model

The trusted host runs existing deterministic World mechanics. The actor receives only
one current observer projection plus public geometry/rules. The trusted broker owns the
provider credential and transport token; the model never sees them. An independent local
evaluator receives complete evidence and admitted action tape. No evaluator feedback or
private evidence is fed into the actor's next turn.

The host was a separate child process with `NODE_AI_API_KEY` removed and an explicit
startup rejection if it inherited the binding. A random controller token stayed in parent
memory/child environment, not prompts, CLI arguments or logs. The host authenticated one
existing person with timing-safe comparison; query identity gave no authority and one
controller lease was allowed. Same-UID processes are not an adversarial container boundary.

## Observer schema

| Field | Allowed information | Exclusions |
|---|---|---|
| `tick` | Current tick/day | No future private schedules |
| `self` | Own opaque reference, current role/workplace/role epoch, coordinates, wealth, stock, applicable price, opportunity progress | No other person's assets; no invented general reputation score |
| `city` | Existing public day/health/tension/station state/heat, bodies with public roles/coordinates | Not private identity, campaign or presence truth |
| `recognition` | Directionally earned subjects' references and procedural faces | No global/reverse recognition graph |
| `rumours` | Only actually heard events: source, state, clarity | No original hidden distortion flags or full propagation trace |
| `proximity` | Only this listener's degraded speaker/intent/tone/context/referent/clarity | No pristine utterance or all-listener transcript |
| `diary` | Owner's still-living composed entries | No expired originals, another diary or drift history |
| `geometry` | Public hub, bounds, districts, buildings and plots | No seed, private inhabitant namespace or RNG |
| `legalMoves` | Adjacent same-district actual plots derived from self/geometry | No invented ground or route/teleport permission |

Public positions can correlate bodies. That is not earned identity or permission to inspect
private data. The current public protocol had no extra line-of-sight filter; do not invent
one or claim all geography was hidden. Recognition remains directional and reliable.

The server's `observationId` authorizes submissions. `policyInput` explicitly whitelisted
top-level observation fields and removed that token before API serialization. Real person
IDs stayed behind observer-specific HMAC references. Reads were detached/pure and consumed
no economic RNG. Changing hidden other-person wealth left current actor input unchanged in
an offline noninterference fixture; future fields need their own disclosure review.

## Decision schema

Exactly four required nullable keys, no extra fields or explanation:

```ts
type Decision = {
  move: null | { x: number; y: number };
  communication: null
    | { kind: "wallPost"; state: SelfState }
    | { kind: "proximityUtterance"; intent: Intent; tone: Tone;
        referent: {kind:"room"} | {kind:"player"; playerId: ObserverRef};
        context: SpeechContext | null };
  diary: null | { subject: EarnedSubjectRef; observation: DiaryObservation;
    reading: DiaryReading; context: DiaryContext | null };
  role: null | { kind: "bakerPrice"; price: number };
};
```

The dynamic schema enumerated exact legal coordinate pairs, current non-self body
references, earned diary subjects and source vocabulary. Empty domains became null.
Grifters had move/observe only; the role field was null unless currently Baker.
Price was finite in `[0,2]`. An independent local validator rejected extra keys, wrong
role, bad values, teleport, foreign/self references and unknown diary subjects. Invalid
whole decisions were not repaired into invented authority. Null optional contexts were
removed when translating to the existing wire representation.

One tick allowed one move, one wall **or** proximity communication, one optional diary
entry and one role choice. A role choice did not spend or expand the other categories.
No choose-role, free-text communication, arbitrary tool, crafting or crime action existed.
Schema-valid conversation still needed actual kernel spatial listener/referent permission.

## Closed vocabulary

- Wall: `isolated`, `manipulated`, `distrustful`, `exploited`, `suspicious`, `uneasy`, `overwhelmed`, `hopeful`, `secure`, `grateful`.
- Speech intent: `inform`, `ask`, `warn`, `deflect`, `affirm`, `refuse`, `needle`, `reassure`.
- Tone: `warm`, `cold`, `wry`, `urgent`, `guarded`, `playful`, `weary`.
- Speech context: `myPrice`, `myVacancyStatus`, `rumourIHeard`, or absent.
- Diary reading: `seemsTrustworthy`, `seemsOpportunistic`, `seemsScared`, `seemsCalculating`, `cantTellYet`.
- Diary context: `trade`, `wallPost`, `rumourHeard`, `crisisCover`, or absent.

Diary observations: `undercutMyPrice`, `matchedMyPrice`, `overpaidWithoutNeedingTo`,
`haggledHard`, `refusedToTrade`, `offeredFirstUnprompted`, `paidLate`, `disputedAFairDeal`,
`warnedMeAboutSomeone`, `sharedARumourFreely`, `keptAConfidence`, `letAConfidenceSlip`,
`correctedAFalseRumourAboutMe`, `letOneStand`, `introducedMeToSomeone`, `keptMeOutOfSomething`,
`coveredAVacancyUnasked`, `disappearedDuringOne`, `showedUpWhenItMattered`, `wasNowhereToBeFound`,
`keptAPromise`, `brokeOne`, `soughtMeOut`, `avoidedMe`, `stayedGuarded`, `openedUpUnprompted`,
`confrontedMeDirectly`, `deflectedWhenConfronted`.

These are composed beliefs/expressions, not proof that the described events happened.
Grammar controls available expression, not truthfulness or friendliness. A note does not
authorize a conviction, a reputation mutation or a permanent private dossier.

## Recorded tick lifecycle

1. Authenticate one existing person and receive current geometry/observation.
2. Build fresh input without transport tokens. No conversation linkage or scratchpad.
3. Persist cost/count reservation and trusted request evidence before HTTP.
4. Allow one inference in flight; newer observations replace the latest pointer.
5. Validate provider status/model/usage and strict decision independently.
6. Discard late results if tick changed. Account cost even when actions are discarded.
7. Attach current tick/token only in trusted code; submit bounded wire proposals.
8. Server checks lease, freshness, references and per-category budgets; kernel checks
   actual destination and current person/role epoch at execution.
9. Normal automatic Baker reactions/RNG still run before own-price override; actual
   demand/profit/completion/caps remain. No action follows normal automatic defaults.
10. Wait for an observation after final submitted tick, stop this trial host and replay
    admitted inputs with the real kernel. Departure never rebinds to another inhabitant.

Wire form: `{type:"action", tick, observationId, action:"bakerPrice", payload:{price:0.75}}`.
The model cannot choose the author, authorization token or a foreign slot. Replay input
records admission separately from mere wire submission; neither necessarily proves a
desired economic outcome without authoritative state inspection.

## Recorded provider and socket bounds

| Control | Historical implemented value |
|---|---|
| Model | `gpt-5.4-nano-2026-03-17`, low reasoning, default service |
| API | Fixed HTTPS Responses endpoint through managed proxy/CA; TLS verification retained |
| Output | 2,048 tokens including reasoning; strict JSON; no private reasoning traces requested |
| Tools/state | Empty tools; `store:false`; no conversation/previous-response linkage |
| Body/deadline | 32,768 request bytes; 262,144 response bytes; 12-second total/header/body bound |
| Input reserve | Serialized body UTF-8 bytes + 4,096 framing margin; known usage checked against bound |
| Retries/fallback | None |
| Game socket | `ws://127.0.0.1:<port>/` only, no query/userinfo/alternate path |
| Server traffic | 128 admitted sockets, 4-KiB inbound text, 64 data messages/second/connection |
| Queues | Eight frames/connection/tick, 256 globally, separate game action quotas |
| Output/lifecycle | 256-KiB queued output, compression off, 30-second heartbeat, clean shutdown |
| Browser origins | Exact configured allowlist, default empty; both Origin header variants checked |

Native clients could omit Origin but still needed authentication. Origin is not identity.
Public TLS/accounts/abuse admission were not implemented. No model got a shell, repository,
arbitrary network, evaluator files or raw World object.

The first 401 exposed an Undici error emitted asynchronously by `body.destroy()`. The
historical repair attached a stream error listener before destroying rejected/oversized
bodies; it did not log provider error text or weaken uncertain-cost handling. Actual local
HTTP tests covered 401/403/429, malformed/oversized and successful bounded JSON.

The actor's provisional goal was sustainable own wealth, successful role activity and
opportunity progress because general signed reputation/monuments were unimplemented.
`store:false` meant no application response-state linkage, not a zero-retention contract.
No runtime command should be retried here until exact source and accounting are recovered.
