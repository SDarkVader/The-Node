> Historical recovery record. Its status, branch, budget and no-call statements apply to the
> named source/date below. Current status: [the live continuation experiment](../research/CURRENT_EXPERIMENT.md),
> stopped after 36 decisions / 18 ticks. Later reconstruction and successful live calls do not
> replace original missing evidence. Unimplemented work is further work, not a programme limitation.

# Read-only accounting recovery inventory

17 October 2026. Prepared from baseline reconstruction `deede499ceaf59b61f734ad599162ff5c5bc535f`. No spending ledger was initialized, imported, reset, settled or changed. This is an evidence inventory, not a budget or permission to send requests.

## Findings

The targeted local search found recovery documentation and complete source-history bundles, but no matching original private spending ledger or run-record file. Historical executable commit `b7c87f45ddb253a1c55a0ea28f27734479f442e3` is absent from the complete reconstruction bundle. The Git history's only ledger-named file is `design/playtest-aesthetics/Ledger.dc.html`, a design artifact, not broker accounting.

The evidence establishes a historical **19,114-microUSD / US$0.019114 reservation** and **one attempted actor request**, with actual token usage and actual billed cost unknown. The reservation remains held. It does not establish total costs for every diagnostic admission.

## Request-count conflict and handoff correction

`CREDENTIAL_BINDING_SUPPORT_REPORT.md:37-38` says:

> Diagnostics have reached nine conservatively counted request admissions including the historical failed actor attempt and sandbox-denied diagnostics.

The unchanged reconstructed `RECOVERY_HOLD` in `src/agent/broker.ts` instead labels its value of nine as `totalDiagnosticAdmissionsRecordedInHandover`, alongside a separate actor-request field of one. The earlier portable handoff repeated that diagnostic wording too strongly.

The direct documentary reading is **nine combined recorded admissions, including the one actor attempt**. Do not add one plus nine and claim ten observed events. Preserve the legacy field/value without relabeling or editing the protected core. Its label and the documentary description disagree; the missing original event ledger is needed to establish exact event identities, overlap and provider delivery. Sandbox-denied admissions are not proof that a provider received a request.

This resolves an error in the handoff's wording. It does not recover the private counter or establish a fresh request allowance. The old handoff ZIP is an earlier dated artifact; the new continuation pack supersedes its count interpretation.

## Search scope and limits

Before creating the new offline-provider checkout, a filename inventory examined 5,129 files under:

- The current Codex task workspace.
- `C:\Users\steve\OneDrive\Desktop`.
- `C:\Users\steve\Downloads`.

The inventory used hidden and ignored files, excluding `.git`, dependencies, attachment folders, Python environments and the duplicate handoff restore-check clones. It matched budget/ledger/reservation/accounting/recovery/recovered/evidence/experiment/first-pass/run names. There were 35 filename matches; the three record/archive-extension candidates were the original recovery bundle and two copies of the latest checkpoint bundle. Other matches were source, tests, documentation and the design HTML.

This was a targeted filename inventory, not a full-content scan, cloud-backup/account query or exhaustive search for generically named files. Local Git history paths were checked separately; the named historical executable object was checked directly. No credential files or environment bindings were read. Earlier archive/source inspections are documented in the preserved integration recovery analysis.

## Evidence fingerprints

Document fingerprints below describe the LF checkout made from the pinned Git bundle with `core.autocrlf=false`. Older Windows working copies may contain CRLF line endings and consequently have different file hashes without different text. Bundle hashes identify exact archive bytes.

| Evidence | SHA-256 |
|---|---|
| Original `recovered-experiment-documents.bundle` | `BBAE7476B06C09F1F62D969F149BEA5D624E6E65927778854E36768FC43520F4` |
| Baseline `broker-checkpoint-recovery.bundle` | `43B37C44C4192B69A99951370F6F7BEF22F19D8AD9F10683B800E4E85C422436` |
| `EXPERIMENT_FIRST_PASS_RESULTS.md` | `2927CE73BEB571DCFCCB41CFC94B5DF831A18750386430EB189F04672E5C7B8A` |
| `CREDENTIAL_BINDING_SUPPORT_REPORT.md` | `D2BC9C429CE2AC38BC4DA7F2FEFFB099C43A4F50C1960571DE5EA0EE05FFAEAB` |
| `EXPERIMENT_EVALS_AND_SAFEGUARDS.md` | `CA3078CE4D4F816DE2E0646F1DC32F4F7840462561F45D924169F1824D8E41AA` |
| Protected `src/agent/broker.ts` | `A17D0FEE2B1A3591034876C04182D7E789F470AB3B506364044420761B03DBAC` |

## Disposition

Hold preserved; unknown costs remain unknown; request history not rewritten; no new allowance calculated. `assertLiveAdmission()` still rejects unconditionally. See [the reviewable reconciliation proposal](ACCOUNTING_RECONCILIATION_PROPOSAL.md). The implemented [offline mock provider boundary](OFFLINE_PROVIDER_BOUNDARY.md) neither reads nor writes spending records.
