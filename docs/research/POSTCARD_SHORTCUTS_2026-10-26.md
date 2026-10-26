# Postcard shortcut implementation — 2026-10-26

This is the second bounded slice of the [Oracle/civic handoff](NODE_ORACLE_CIVIC_IMPLEMENTATION_HANDOFF_2026-10-26.md), following the v1 core at `8011e60972948990b5f5d00e84663bc5542c3a79`. Previously postcards supported explicit hourly accrual, claims and safe fusion only. The new production v2 account adds the same-tier shortcut from [7 August §4b](../DESIGN_ADDENDUM_2026-08-07.md); v1 source files and saved evidence are unchanged. Existing World, society, agent, economy, role, reputation and migration paths are unchanged.

## Implemented transactions

`src/engine/postcardAccount.ts` creates a new account or explicitly upgrades a valid v1 snapshot. The upgrade retains its owner, holdings, configured rate, clock, last claim, pending fractional credit and recorded overflow. No assets or time are granted by upgrading. The complete v1 origin is retained as the replay anchor.

All clock, claim, safe-fusion and shortcut transactions require an owner, explicit integer millisecond timestamp and stable transaction ID. An exact retry returns the original effect with the current state unchanged, even after later transactions or saving/reopening. Reusing an ID with a different payload fails. A rejected transaction does not advance the clock or consume cards or RNG state.

| Recipe | Input | Output and chance |
|---|---|---|
| Safe fusion | Five held cards of one nonfinal tier | One next-tier card, guaranteed, no RNG |
| Green, Blue or Purple shortcut | `k` held same-tier cards, `k=1..4` | One next-tier card with probability `k/5`; otherwise no output |
| Five-card Green, Blue or Purple shortcut | Five held same-tier cards | Same guaranteed result as safe fusion; no RNG |
| White shortcut, Orange fusion, mixed/higher substitutions | No specified legal recipe | Rejected atomically |

Both shortcut outcomes consume the entire selected stake. Pending credit cannot substitute for held cards. Existing 16-hour storage, whole-card claims, fractional carry and indefinite held-card retention remain available in v2. The required rate remains caller configuration; the proof's 2 White/hour is the original illustration, not a newly enabled world default. A tick remains a day.

## Exact accounting and draws

White-equivalent accounting uses safe-path values `1,5,25,125,625`, separate from the original illustrative rarity weights. For a source tier with value `w`, success records issuance `(5-k)*w`; failure records burn `k*w`. Full recipes have neither. These are postcard ledger entries; no currency, grain, flour, Oracle treasury or other inventory is changed.

For denominator `d = rate.denominator * 3,600,000` and earned credit `g = (clockMs-createdAtMs)*rate.numerator`, every transaction verifies:

```text
(heldWhiteEquivalent + burnedWhite) * d + unclaimedUnits + overflowUnits
    = g + issuedWhite * d
```

Under the specified `k/5` probability, expected issuance and burn cancel: `(k/5)*(5-k)*w = (1-k/5)*k*w`. This is an expectation, not a claim of pathwise conservation without issuance/burn. Every receipt records the actual result and ledger deltas.

Version `mulberry32-rejection5-v1` addresses the existing deterministic PRNG by seed and physical draw index. A raw word of `0xffffffff` is rejected; the remaining 4,294,967,295 words divide equally into five buckets of 858,993,459 words. Success means bucket `< k`. Every physical draw, including a rejected word, advances the retained cursor. Five-card recipes consume no draw. No ambient time, `Math.random`, injected roll or world RNG mutation is used.

The seed, raw cursor, origin and receipt journal are operator state. Mulberry32 is predictable; it is not a cryptographic lottery service. Trusted world ownership, seed assignment and withholding this state from agents are subsequent integration requirements. No new state is sent to inhabitants by this slice.

## Persistence and validation

`src/engine/postcardAccountReplay.ts` supplies distinct v2 snapshots and tapes. Parsed snapshots replay every unique receipt from the v1 origin and seed, verify every effect and final ledger field, and return immutable sealed state. This detects altered issuance/burn totals even when an attacker preserves the aggregate equation and recomputes an unkeyed checksum. Tapes include duplicate attempts as explicit no-op records without appending duplicate account receipts.

Exact shapes reject extra fields, executable getters, inherited/non-dense arrays, invalid inventories, noninteger/negative timestamps, invalid seeds, unsupported recipes and conflicting IDs. Evidence has explicit depth/node/byte/record capacities; these are serialization bounds rather than game economy caps. Checksums and self-consistent replay do not authenticate an external origin or prevent someone presenting a completely different valid account. World authority must bind the actual owner, origin and seed.

## Offline evidence

The implementation candidate passes 82 core tests, 26 replay tests and three CLI tests, including 15,000 real seeded transactions across 1,000 seeds × five stakes × three eligible tiers. For that fixed seed fixture, success counts are `182,367,557,777,1000` for stakes 1–5, repeated across all three tiers. These counts are recorded fixture output, not an estimate of agent behaviour. A separate injected raw-word boundary test verifies rejection/cursor recovery; no injection callback is exposed by the production API.

```powershell
npm run postcards:shortcut-proof -- --output .codex/session-recovery/postcard-shortcut-proof.json
npm run postcards:shortcut-proof -- --verify .codex/session-recovery/postcard-shortcut-proof.json
```

Use a new output file. The proof records 31 fixed synthetic scenarios with complete v1 acquisitions, v2 transactions, snapshots, exact ledgers and rejected attempts. Seeds 4 and 5 deliberately cover first-draw success and failure; this is fixture selection, not manufactured inhabitant behaviour. Verification checks the source hashes, specified fixtures, event replay, snapshot resumption and failure receipts. Separate CLI processes produce identical proof bytes and refuse overwrite. Source-anchored full regression and saved-file results will be recorded after committing this implementation.

## Further work

Universal Oracle participation, calibrated nonlinear health-linked reward quality, agent-visible menus and non-agent parity, trusted abode/clock persistence, ticket forging and legal migration, signed deed reputation, civic monuments, optional universal wealth caps and the final independent PowerShell whole-simulation proof remain subsequent slices. None is claimed by these unit and file-replay results. No provider call, live run, private credential access, financial journal reset or old approval reuse occurred.
