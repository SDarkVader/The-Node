# Shared-world observatory and remote execution

Updated 2026-10-25. Implementation: `src/observatory/`, `observatory-web/`.
The observer verifies continuation evidence and reconstructs its committed participant world.
It never creates a substitute simulation, submits a decision, calls a provider or opens a
writable budget. The separate frozen Study 1 remains paused.

## Fresh cloud checkout

Use Node 24, Python 3.12+ and the locked dependencies. No PC connection is needed.

```sh
git clone --branch main https://github.com/SDarkVader/The-Node.git
cd The-Node
git rev-parse HEAD
git log --oneline --merges -6
cat AGENTS.md
npm ci
npm run recovery:verify
npm run typecheck
npm test
npm run test:session-recovery
python -m venv ../node-eval
../node-eval/bin/python -m pip install -r evals/requirements.txt
```

On a cloud host with a read-only home, set `npm_config_cache`, `XDG_DATA_HOME`,
`XDG_CACHE_HOME` and (for Godot) `XDG_CONFIG_HOME` to private writable directories.
Do not redirect or print provider credentials. Inspect scripted fixtures explicitly have
no provider or billed tokens; they no longer need an online tokenizer download.

## Demonstrate without spending

Choose a **new** private output directory outside the checkout. The command refuses an
existing directory. Everything in this rehearsal is labelled synthetic, including accounting
and reasoning. Synthetic accounting must never be substituted for real prior history.

```sh
npm run observatory:demo -- ../node-demo
npm run observatory:evaluate -- ../node-demo/registration.json synthetic-rehearsal ../node-demo/a01-evaluation
cd evals
../../node-eval/bin/python -m inspect_node.observatory_export ../../node-demo/a01-evaluation/inspect-input.json --out ../../node-demo/inspect-evaluations.json --log-dir ../../node-demo/inspect-execution-logs
cd ..
```

The demo executes 140 scripted decisions over 20 real kernel ticks, with seven controlled
roles in one society. It seals a checkpoint after tick 1, closes/reopens the synthetic
allowance and resumes that exact world and signed fixture histories. Movement, proximity
speech, production, dealings, recognition, authored diaries, ageing, and Baker prices use
the existing observer, validator and participant kernel. The final journal books 47,600
synthetic micro-USD with zero holds. These numbers are test data, never a real account balance.

Evaluation runs **after execution**. A01 reconstructs eligibility, actual writes and
grounding through the unchanged diary classifier and contract hash. Inspect AI 0.3.282
separately scores `execution_share`: requests joined to a committed transition divided by
all recorded requests, including failed/pending/rejected requests in the denominator.
Neither measure grades reasoning, establishes intent or demonstrates causal memory benefit.
There is no authority treatment in this run, so no authority-deference comparison is created.

In the private registration, set `evaluations` to:

```json
["a01-evaluation/evaluations.json", "inspect-evaluations.json"]
```

Keep each producer's original result file; the importer joins them without overwriting results.

## Open the web and native Godot views

Generate two different random tokens (at least 32 characters), store them privately, and set
`NODE_OBSERVATORY_RESEARCHER_TOKEN` and `NODE_OBSERVATORY_WORLD_TOKEN` in the server's
environment. No provider API credential is needed. Do not put tokens in URLs, source, public
logs or tracked registration files.

### Open the interface on your PC or in a private Codespace

Use a **new checkout and new demo directory**, so existing PC work and experiment files stay
intact. Until PR #39 merges, select `codex/cloud-observatory-2026-10-25` rather than main.
Node 24 is recommended. The seven-role synthetic demo needs no provider key, Python or Godot.

Windows PowerShell:

```powershell
git clone --branch codex/cloud-observatory-2026-10-25 https://github.com/SDarkVader/The-Node.git The-Node-cloud-review
cd The-Node-cloud-review
npm ci
npm run observatory:demo -- ../node-interface-demo
$env:NODE_OBSERVATORY_RESEARCHER_TOKEN = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$env:NODE_OBSERVATORY_WORLD_TOKEN = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
Write-Host "Interface login token: $env:NODE_OBSERVATORY_RESEARCHER_TOKEN"
npm run observatory -- ../node-interface-demo/registration.json
```

Keep that terminal running, open `http://127.0.0.1:8090/`, and paste the **interface login
token** it printed. This token is local observatory access, not an Anthropic credential.
Select decisions, move the shared timeline, inspect synthetic reasoning/admission/accounting,
and load, edit, validate or download the fresh first-person plan. Viewing and configuration
do not advance the world or authorize spending. The demo initially has no imported evaluation;
the separate evaluation commands above populate that panel.

For browser-only use, if GitHub Codespaces is available on your account, create a Codespace
on this branch, then run in its terminal:

```sh
npm ci
npm run observatory:demo -- ../node-interface-demo
export NODE_OBSERVATORY_RESEARCHER_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
export NODE_OBSERVATORY_WORLD_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
printf 'Interface login token: %s\n' "$NODE_OBSERVATORY_RESEARCHER_TOKEN"
npm run observatory -- ../node-interface-demo/registration.json
```

In **Ports**, forward **8090**, keep its visibility **Private**, then choose **Open in Browser**.
Use the printed interface token. The server remains in that Codespace; this Codex workspace
does not currently have a public preview URL. A private Codespace uses your GitHub access
and its usual account allowance. Do not upload provider credentials for this demo.

To display a native first-person rehearsal instead, install Godot and use
`reasoning-test:rehearse` from the [selected-test workflow](REASONING_PARITY_AND_FRESH_TEST_2026-10-25.md),
then pass its generated `registration.json` to the same observatory command.

```sh
npm run observatory -- ../node-demo/registration.json
```

Open `http://127.0.0.1:8090/` and enter the researcher token. Login creates an eight-hour,
HttpOnly, SameSite=Strict session. The browser holds no provider key. The world token cannot
access observations, reasoning, accounting or evaluations.

For remote use, keep the listener on loopback and forward the port through your authenticated
SSH/VPN connection, for example `ssh -N -L 8090:127.0.0.1:8090 user@your-cloud-host`.
For a TLS reverse proxy, enable WebSocket upgrades and unbuffered SSE, protect the private
registration and set `NODE_OBSERVATORY_SECURE_COOKIE=1`. Use HTTPS/WSS for network exposure.
This PR does not provision a public host, DNS or TLS service.

For either native Godot scene, set these variables in the client process:

```text
NODE_OBSERVATORY_URL=ws://127.0.0.1:8090/observatory/v1/runs/synthetic-rehearsal/world
NODE_OBSERVATORY_TOKEN=<separate world token>
```

```sh
godot --path client
# The 2D renderer is also available:
godot --path client res://scenes/WorldView.tscn
# Parser/socket smoke check:
godot --headless --path client --quit-after 180
```

Godot sends the token in the handshake header. Both scenes display and print the experiment's
tick, world hash and cursor, and reconnect with bounded backoff. A role change keeps the
person's handle. The public socket carries geometry, roles, positions, station heat, tension
and provenance, never diaries, wealth, raw identities or reasoning. The old standalone
`npm run server` remains a separate sandbox and is never labelled the experiment.

The web timeline selects **one shared display cursor** for all connected world clients.
Each researcher snapshot includes the most recent decision round at that cursor; select a
historical cursor to retrieve its observations and summaries. Telemetry covers the full
verified prefix. This avoids broadcasting the entire private observation history on each update.
Selecting a past request shows the still-uncommitted world alongside that request's evidence;
only a transition changes the world. Follow-latest restores following. Reconnect and playback
cause zero provider calls and zero authoritative kernel ticks. Returned summaries appear
verbatim only after a response is archived; pending, missing, redacted and unparseable states
are explicit. Opaque signatures/redacted payloads are withheld.

## Register actual evidence without inventing state

A Git clone contains no private tick-18 pilot archive or journal. Transfer the owner's
actual latest files securely to the remote private store, preserving original copies and hashes.
Do not infer a missing balance, rebuild an allowance, replay consumed calls or use demo data.

A private registration supplies trusted server-side paths; HTTP requests never accept paths:

```json
{
  "host": "127.0.0.1",
  "port": 8090,
  "runs": [{
    "id": "owner-selected-experiment",
    "ledger": "<actual latest continuation.ledger.jsonl>",
    "sourceRevision": "<actual segment runner commit>",
    "journal": "<actual matching accounting.journal.json>",
    "evaluations": []
  }]
}
```

The reader verifies complete newline-terminated prefixes, embedded parents, exact requests,
actual responses, usage, validation and original kernel replay. A torn final line waits;
a rewritten/truncated/invalid prefix fails closed and requires explicit source re-registration.
The final segment root stays null until sealed. Cursors retain their meaning when sealing.
The latest self-contained segment includes its parents; do not register parents as extra calls.

The journal reader validates its checksum and original budget rules without acquiring its
writer lock. Current-grant booked/held totals and carried history remain separate. A journal
ahead of the selected ledger is labelled; it is never silently reconciled or reset.
The historical-billing-reconciled flag remains false.

## Configure, preflight and execute remotely

The web configuration editor validates/downloads the existing continuation plan. It creates
no allowance or spending permission. The original 2,048-output cap, priced models, default
32 KiB profile and opt-in 95,000-byte continuation profile are preserved.

Read-only recovery/preflight:

```sh
npm run continuation:preflight -- <plan.json> <actual accounting.journal.json> <actual latest continuation.ledger.jsonl>
```

This checks the exact plan-bound authorization, history hashes, consumed requests, held
liabilities, expiry, parent contract and latest resume point. A stale parent is refused.
Missing or blocked accounting is evidence to resolve, never permission to replace it.
The runner rechecks under the budget writer lock before dispatch.

Build the committed runtime to a **new** directory:

```sh
node scripts/build-study-runtime.mjs <NEW-runtime-directory>
```

Only after the owner has separately authorized a particular paid run and its amount/window,
use the existing carry/authorization procedure:

```text
node scripts/prepare-continuation-budget.mjs <runtime> <closed-prior> <NEW-allowance> <approved-plan.json> <owner-instruction.txt> --authorize-paid-pilot --from-experiment
node scripts/run-continuation.mjs <runtime> <matching-allowance> <NEW-private-artifacts> <approved-credential-file> <approved-plan.json> --dispatch-authorized-pilot --transport node --resume-ledger <actual-latest-parent> --stop-at-tick <approved-bound>
```

Omit carry preparation when resuming an existing valid grant. Omit the resume flag only for
an explicitly authorized new genesis. InitialTestBudget carry uses the existing command without
`--from-experiment`. These examples grant **no spending permission**.

The Node 24 transport removes the PC/PowerShell dependency for continuation execution.
It reads ANTHROPIC_API_KEY only in its separate trusted worker, sends the exact request once,
uses the fixed Anthropic endpoint, inherited proxy/CA trust, a 12-second timeout and bounded
response reads, refuses redirects, and archives unsuccessful bodies too. It never retries.
The original PowerShell transport remains the default for existing commands.
SIGINT/SIGTERM aborts dispatch and preserves partial evidence/unknown-usage holds.
Unknown outcomes require the existing explicit full-ceiling settlement procedure; the
observatory cannot settle them. Frozen Study 1 execution remains its separate paused procedure.

## Interfaces and scope

- Researcher: `GET /observatory/v1/runs`, per-run `snapshot`, `timeline`, `events` (SSE),
  `evaluations`, `configuration`. SSE accepts a stable `Last-Event-ID` or `after` cursor.
- Presentation only: `PUT .../selection` selects a known cursor or null (follow latest).
- Configuration only: `POST /observatory/v1/configuration/validate` returns the plan hash.
- Public projection: authenticated `.../world` WebSocket; inbound actions are refused.
- Each snapshot is versioned `node-observatory-snapshot-v1`. Evaluation records use
  `node-observatory-evaluation-v1`, a separate phase/producer/definition/denominator,
  evidence anchors, contract hash where applicable and evaluated-through tick/cursor.

Slow clients have bounded output queues and reconnect to snapshots. The observer is a
separate process and cannot hold up the experiment through a publisher callback.
The source code is compatible with the current continuation ledger, not an importer for
arbitrary old Inspect Episodes or Study 1 arms. Additional scorer adapters require their
own contract-aware joins. Human annotation authoring, transcript degradation comparisons,
browser-embedded Godot, and full A04 key/abode transactions remain further work; none is
silently added to the frozen action contract. The existing society mechanics are exercised
through their actual kernel, rather than through UI-only state.


## Fresh first-person test selected on 2026-10-25

The owner selected the first-person Godot condition from PR #41, fresh from genesis with
no prior model context. Use the [selected plan/readiness workflow](REASONING_PARITY_AND_FRESH_TEST_2026-10-25.md).
The web configuration panel can load, validate and download the fresh twenty-tick template;
this grants no execution/spending permission. The cloud reader now verifies `perception_*`
and `perception_fresh_start` archives as well as original continuation archives. The same
selected committed world cursor drives web and native Godot. Exact returned summaries and
missing blocks remain distinct; historical financial state is carried without model history.
A01 diary adherence is not applicable where the declared first-person schema requires
`diary=null`; execution-share evaluation remains separate. The actual latest journal and
separate owner approval are still required before any provider request or new allowance.
