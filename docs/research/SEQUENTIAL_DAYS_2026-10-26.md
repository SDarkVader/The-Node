# Sequential days and standalone PC tests

The owner's daily rules are implemented as the opt-in `node-society-routine-v4` contract.
The earlier tape versions retain their original execution, observations and replay. Fresh
configured PC previews and real-test preparation select the new contract.

## Run without an assistant session

From the existing local repository:

```powershell
powershell -NoProfile -File .\START-NODE.ps1
```

This starts a model-free manual preview. For a short real test:

```powershell
powershell -NoProfile -File .\START-NODE.ps1 -Start -Ticks 1
```

The script delegates to the existing canonical launcher. It runs in ordinary Windows
PowerShell with Node and the configured Godot installation; no Work or Codex session is
required. Keep its terminal open. Provider calls require network access. The private PC
preset supplies existing paths, so no repeated path search or accounting reset is needed.

Preparation prints the exact source, rules, maximum calls and USD bounds. Only the human's
`START` approves that prepared test. The USD 1 total and USD 0.02 request ceilings remain.
The maximum call count is `min(5000, days * 3 * (1 + maximum turns per day))`; it is an upper
bound, not a promise that all calls will occur or fit before the spending ceiling. A budget,
turn limit or cancellation stops with an unfinished day and retained evidence.

The launcher builds the Web client when committed source changes, starts the authenticated
Observatory and opens its browser. Godot runs inside the interface. Select the run, day,
turn, agent and decision; inspect individual, daily or full chronological returned blocks.
Playback uses recorded actions and performs no policy or provider calls.

## Daily mechanics

Prices and Miller quantity commit once at the start of the day. Prices remain locked and
public. Each subsequent turn presents fresh observations. Speech uses starting positions;
legal adjacent movement resolves afterwards. The world economy, churn, recognition credit
and memory ageing advance once at the day boundary, rather than once per action turn.

Residents must leave home, visit the Wall and Oracle, make a food attempt, perform their
role duty and write one constrained diary entry at home before closing their day. Named
diary subjects must be recognised other people; a null subject is a permitted diversion.
No free text or content verification is introduced. Residents choose timing, route, wording,
prices, quantities, seller and optional Oracle participation from their legal menus.

Role holders use lexical speech and answer their actual customers. An unanswered order
remains a personal obligation; the recipient sees its own waiting seller, not another
person's private task list or intentions. Role holders remain available until the day's
food attempts have been recorded. Roleless inhabitants use the same public rules and
validator without inventing an occupation. Extra speech outside occupational duties stays
optional. Deterministic policies control every non-model resident without paid calls.

An order is an attempt, not guaranteed food. The existing day-end market settles genuine
orders with real wealth, capacity, grain and flour. Failed attempts may allow day completion
after the other duties, as the owner clarified. Seller income uses the original settlement
formula; payments are not credited a second time. No food, money or winning draw is supplied
to make a test finish. Daily Oracle participation and the existing paid lottery remain
independent choices with their existing health odds, fair draws and resource accounting.

## Explicit implementation assumptions

- This initial daily contract uses the existing one-district settlement. Multi-district
  daily routing remains further work; old multi-district simulation is unchanged.
- Homes use the generated buildings' existing residential floors and residents-per-floor
  capacity, allocated deterministically independently of employment. They persist through
  role changes. This provides homes and physical diary visits, not full A04 trespass.
- Wall and Oracle share the hub location. Participation is optional after the required visit.
- Generated isolated plots receive deterministic minimal street connections in v4 only.
  Every original plot and building is preserved; residents still choose one legal step.
- The 128-turn ceiling bounds execution. It never completes duties or rolls an unfinished
  day automatically. A fresh reviewed run is separate from a stopped historical test.

## Accounting and evidence

Variable-length runs can finish below their call cap. A terminal, append-only closure
revokes remaining authorisation only with zero held liability, all requests booked and no
overrun. The original approval, receipts and expiry remain in the journal. Further reserve
attempts fail. The next freshly reviewed test carries that same latest history, including
the closure; it never substitutes an older journal or pads request counts.

Raw output retains the exact context, legal choices, proposed/admitted action, returned
thinking or explicit absence, execution and submission/turn/day transitions. Every agent's
chronological JSONL and individual day JSON include all its turns. Failed and partial runs
are retained. The deterministic preview does not manufacture model reasoning. Researcher
history is never fed back as privileged inhabitant memory, and no behavioural interpretation
or reasoning-quality score is attached to these execution records.

Source-bound full regression, independent replay and cold PowerShell/browser evidence are
recorded in the current recovery handover after integration verification.

At source `c4ac041d537a58694cfee8c49fac38548c9002bd`, the complete local suite passed
1,964 tests across 155 files, zero failures and seven environment skips. Three days with
the approved postcard/Oracle profile produced 1,148 decisions, 897 movements and 42 diary
writes. Independent runs produced identical tape bytes and cold replay passed. Actual
Windows PowerShell preparation/check used only a generated synthetic journal and fake key;
the real launcher completed one model-free manual day in the browser with embedded Godot.
[Sanitized verification record](evidence/sequential-days-2026-10-26.json).

Role holders must speak, and each actual queued Baker customer requires a reply. Further
role-specific dialogue about exact same-day flour supply, delivery or inquiry counterparties
remains to implement: those counterparties currently arise during the existing day-end
kernel. This revision does not claim every detailed role interaction is already present.

Full routine tapes use bounded lossless gzip envelopes (128 MiB encoded, 256 MiB expanded).
Per-agent/day exports remain readable JSON. A storage-admission guard preserves a replayable
prefix when bounds approach; it never closes an unfinished day to reduce output size.
The twenty-day candidate capacity check retained and replayed 7,286 decisions in a 7.8 MB
tape, with more than ten million data nodes; this is offline capacity evidence, not a paid run.
