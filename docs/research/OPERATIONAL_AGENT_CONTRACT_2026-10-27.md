# Operational inhabitant contract and PC verification

Verified implementation: `6665eef3cafdf9efcc9187e84270b9cb156b4cba`.
Earlier schema implementation: `b82907250ae22195a8145b676f1a41a4754d2eeb`.
All new execution evidence below is synthetic; no new paid provider test was run.

## Corrections

Fresh PC preview and paid preparation now pin `routine.information: inhabitant-v1` in
the existing v4 tape and reviewed plan. Absence preserves historical observations and replay.

The explicit allowlist adds actual public food units, flour conversion, customer capacity,
purchase cadence, activity multiplier, base wages, configured tax/cap and Oracle health;
own role tenure; own last settled food receipt; and own last paid lottery result. Existing
own assets, opportunities, home, duties, received speech, diary and public/local observations
remain. Feedback names only personally witnessed counterparties, including when shop occupants
change after settlement. Current and prior-day results are distinguished.

Commit-phase movement, purchase and Oracle menus now agree with the schema and validator.
The independent worker validates the entire new nested shape, fixed public explanations,
adjacent moves, phase restrictions and schema adaptation. Controller replay independently
binds each exact observation to authoritative state. Other inhabitants' wealth, stock, tenure,
diaries, tasks and hidden causes, operator state, random seeds and host capabilities stay out.

The production path is world projection → branded immutable observation → exact serialized
request → independent egress validation → response parsing → legal action validation →
submission → shared turn effects → daily economic settlement → fresh observation. The new
standalone proof saves every inhabitant's exact local synthetic request/response, admitted
action and before/after hashes, plus the normal tape and controlled-agent raw exports.

The preview honours `-Seed`. Observatory now labels deterministic previews as policies,
distinguishes action days/turns from settled world ticks, and displays recorded personal turn
effects. Researcher evidence remains separate from the world-only Godot channel.

## Recorded verification

| Check | Result |
| --- | --- |
| Full suite at `6665eef`, real Godot enabled | 1,979 passed / 157 files; one platform skip |
| Recovery suite | Eight passed |
| Project and affected CLI strict TypeScript; browser JS syntax | Passed |
| Three-day exact transport proof, all six roles | 1,148 decisions; 283 controlled packets |
| Resulting activity | 897 moves; 42 diary writes; 42 food receipts |
| Evidence/report integrity conflicts | Zero |
| Maximum conservative controlled request ceiling | 10,973 microUSD; existing limit 20,000 |
| Maximum economic accounting residual | 1.7763568394002505e-14 |
| Independent fresh-process three-day replay | Passed; final hash `5b386113fb7eb1a4c1a6c895803d00d860fcdc43e7b46c04b23af5eb0bb2666f` |
| Actual PowerShell/browser run at final implementation | One manual day; 389 decisions / 94 controlled packets |
| Earlier two-day PowerShell/browser run at `b829072` | 781 decisions / 192 controlled packets; cold replay passed |
| Browser/Godot | Embedded world rendered; shared historical cursor, observation/menu inspection, actual saved summaries and recorded effects verified; zero browser errors |
| Actual paid preparation with latest carried history | Passed with `STOP`: approved false, no execution, no allowance, zero calls, journal unchanged, pending pointer released |

The one-day final browser tape cold-replayed to
`add7da2061083a1056d723cd9a811f1b4854d2d1e839dd2ba3bb4bcdcb989cbd`.
[Sanitized evidence](evidence/operational-agent-contract-2026-10-27.json) records these checks.
The exact command without `-NoBrowser` also opened Microsoft Edge automatically.
Raw evidence, screenshots and local financial records remain private outside tracked evidence.
These are execution/integrity checks, not a reasoning-quality or behavioural evaluation.

## Preserved real evidence and authorized closure

The old interrupted run remains at zero completed days. Its 98 actual requests/responses
independently replay through 383 decisions with zero integrity conflicts. Of these, 285
non-model decisions remain explicitly labelled historical policy reconstructions. The
verified viewing bundle is now available in the configured PC run selector as
`society-partial-98-2026-10-26`, with `policy_reconstructed` status.

The owner explicitly approved **only** an append-only terminal closure of its unused
authorization. Production recovery first proved the stale accounting lock's owner dead.
The exact old journal and lock were backed up privately. One terminal closure was appended;
all prior events and carried history compare equal. The 98 requests, 304048 microUSD booked
and zero held are unchanged. No new request, refund, allowance, usage estimate or approval
was created. The latest journal is carried forward and the pending pointer is released.
Historical experiment/world/response files were not modified.

## Launch and inspect

From any PowerShell directory on the configured PC:

```powershell
powershell -NoProfile -File "C:\Users\steve\Documents\Github\The-Node\START-NODE.ps1" -Ticks 1
```

This launches the deterministic society, authenticated Observatory and embedded Godot.
Use the printed interface token, keep the terminal open, and click **Advance one tick**.
Select the day, turn, inhabitant and decision to inspect its exact observation, legal menu,
admitted action and recorded effects. Historical playback makes no provider calls.

For a separately approved fresh paid test, append `-Start`. It prints the exact source,
plan and bounds and requires the human to type `START`: at most USD 1 total, USD 0.02 per
request and 387 calls for the one-day/128-turn configuration. Manual advance then starts
execution. Limits can stop an unfinished day; no duties or model decisions are fabricated.
No new paid test has been approved or executed during this work.

Independent no-cost transport and cold-replay verification from the repository:

```powershell
$proof = Join-Path $env:TEMP ("node-proof-" + [guid]::NewGuid())
node --import tsx scripts/verify-node-operational.ts --output $proof --ticks 3
node --import tsx scripts/run-society.ts --verify (Join-Path $proof 'society.json')
```

Full A04 trespass, multi-district daily routing, further civic mechanics/calibration and
separately designed behavioural evaluation remain distinct development work. This change
does not silently activate them or grant inhabitants their unimplemented actions.
