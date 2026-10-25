# Main integration and interface startup

The owner directed integration of PR #39 and PR #40, which includes merged PR #41.
The consolidation retains both source ancestries and their explicit evidence contracts.
The tested fresh-run runtime remains pinned at `93f4a99`; no further provider calls are
part of the merge or browser verification. Its forty-call approval is consumed.

## Supported interfaces

| Entry point | Registration | Purpose |
| --- | --- | --- |
| `npm run preview` | Creates a new small synthetic fixture | Start a browser viewer without provider credentials or manual token setup |
| `npm run preview -- <registration.json>` | Cloud `runs` registration | View the owner's actual completed run or another explicitly registered archive |
| `npm run observatory -- <registration.json>` | Cloud `runs` registration | Existing server with explicitly supplied researcher/world tokens |
| `npm run observatory:legacy -- serve <registration.json>` | `node-observatory-registration-v1` | Retained original-observer Thinking/History interface, annotations and sample imports |

Original `observatory -- serve`, `verify`, `evaluate` and `export-frames` invocations still
dispatch to the compatibility implementation. `observatory:legacy-demo` and
`observatory:acceptance` preserve the foundation commands; the default `observatory:demo`
remains the seven-role twenty-tick cloud rehearsal. Its `--quick` option is used only for
preview startup. Both implementations reconstruct the registered experiment's recorded
world through its kernel and verify hashes; neither creates a separate live world.

The historical implementation moved to `src/observatory/legacy/`; its browser scripts stay
in `src/observatory/web/`. The cloud UI stays in `observatory-web/`. The default cloud reader
supports legacy, historical-perception and fresh-perception evidence. The historical viewer
retains its narrower original-observer contract and refuses unsupported schemas. No request
bytes, signed history, budget journal, model price or frozen Study 1 contract was converted.

Both Python CLI forms remain supported: the continuation execution-share evaluator and the
original `--input ... --collection-id ...` sample importer. Sample collections do not acquire
invented continuation ticks or scores. Native WorldView/IsoView retain cloud bearer headers,
environment endpoints, original `--world-url`/`NODE_WORLD_URL` endpoints and reconnects.

## Why a localhost preview failed

`127.0.0.1` is the computer or phone opening the browser. It does not point to this Codex
cloud machine. `ERR_CONNECTION_REFUSED` means nothing is listening at that local port.
Run `npm ci` then `npm run preview` on the viewing PC, wait for **Observatory ready**, open
its printed URL and enter the printed **interface** token. Keep that terminal running.
No provider key is required. Pass the private viewing bundle's registration to show the
actual completed twenty-tick run instead of the synthetic fixture.

For browser-only use, create a private Codespace on `main`; the checked-in devcontainer
installs dependencies and forwards port 8090. Run `npm run preview` in its terminal and
open the printed Codespaces HTTPS address. Keep the forwarded port private. The image
`mcr.microsoft.com/devcontainers/javascript-node:5.2.3-24-bookworm` was confirmed available
at its registry; an actual Codespace was not provisioned in this cloud session. The managed
cloud currently has no public inbound URL or configured VPN; merging source does not deploy
a hosted service. No private run is published to make a preview work.

## Verification

The combined candidate from9f072bd +5f84cc0 passes all1,505 Vitest tests/122 files with
native Godot and0 skips,42 Python tests,8 recovery tests and TypeScript. The actual preview
entrypoint loads both a quick fixture and the extracted private twenty-tick viewing bundle;
the original Thinking/History entrypoint also loads. Desktop/mobile and both native scenes
match selected live history, with no browser errors/overflow or evidence mutation. See
[sanitized merge evidence](../research/evidence/main-integration-2026-10-25.json).
The clean destination checkout is verified after the GitHub merge. Historical source-pinned
test totals remain historical. Browser checks use the actual server entry point and preserve
ledger/journal byte hashes. No new paid/count request or allowance is used for verification.
