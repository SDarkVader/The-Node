# Design: Moderation logging for proximity conversation (infrastructure layer)

Source: user-supplied research report, "Architectural and Regulatory Analysis of Moderation
Logging for Constrained In-Game Communication Systems" (11pp, cites GDPR/COPPA/DSA text, FTC
guidance, and Riot/Epic/Arambro/Gankster public policy as precedent). Commissioned in response
to the 2026-08-13 correction recorded in `DESIGN_ADDENDUM_2026-08-06.md`'s proximity-conversation
section: *"there is no way this isn't in the logs."* This doc turns that research into an actual
architecture. **Design only — proximity conversation itself has no code yet, so nothing here
blocks on existing engine work; this scopes the infra layer before it gets built alongside it.**

## 0. Two verified load-bearing claims, spot-checked before building on them

The report's two most consequential legal claims were checked against primary/near-primary
sources rather than taken on faith:

- **COPPA's "support for internal operations" exception is real** and does let a platform
  collect a persistent identifier without verifiable parental consent when it's used solely for
  security, safety, and compliance purposes — confirmed against FTC guidance. One update the
  report didn't flag: the FTC's current rule text also requires the privacy policy to name
  *which* internal operations the identifier supports and confirm it isn't used to contact
  children or build behavioral profiles. Folded into §7 below.
- **DSA Article 17 (statement of reasons) and Article 20 (≥6-month internal appeal window)**
  are both accurately characterized — confirmed against the regulation text and secondary
  analysis.

A third check, on the report's single most load-bearing claim — that TTS-rendered speech from a
fixed template avoids GDPR's "special category" biometric classification — came back
**directionally confirmed, with a real caveat the report stated more confidently than the
source supports.** The AEPD's actual guidance is broader risk-based guidance on AI-driven voice
processing generally (originally aimed at transcription tools), one point of which is that GDPR
doesn't apply to voice that's "fully anonymized or purely synthetic," and that a controller must
still separately assess whether *any* processing infers emotion, health, or identity. That's
consistent with the report's conclusion for NODE's specific case (a closed-vocabulary selection
rendered through TTS, nothing physiological ever captured) but it's an application of
general-purpose guidance to this case, not a ruling issued about a system like NODE's — worth
knowing before this claim gets cited to an actual regulator or lawyer as settled. **Practical
implication: the architecture below (§2-4) is worth building regardless**, because it's the
right minimal-footprint design under either reading — if the biometric classification ever did
apply, having already committed to "no audio ever stored, structured metadata only, 30-day
default TTL, siloed from gameplay state" is a strong compliance posture to already be standing
on, not a rebuild.

A fourth check, the Epic Games precedent (14-day base TTL, up to 28 with an appeal), came back
**confirmed** — with one architectural note this doc's design should probably imitate: Epic's
own voice-reporting capture is a **rolling 5-minute buffer**, not a persistent log, meaning
almost nothing exists to retain in the unflagged case at all. NODE's structured-metadata
approach is lighter-weight than raw audio in the first place, so a full 30-day unflagged TTL
(vs. Epic's ~5-minute buffer) is still a reasonable, more generous default — but it's worth
knowing the most aggressive real precedent goes further than what's proposed here, not less.

## 1. What this is not: it is not game-mechanic state, and constraint 4 does not govern it

`CLAUDE.md` constraint 4 (personal memory mortal, civic memory immortal) governs what NODE's own
*mechanics* remember about a player — the diary, the rumour mill, reputation. This moderation
log is neither. It's infrastructure a real deployed platform is legally required to keep,
completely outside anything a player or an in-game system can query, exactly the distinction
`DESIGN_ADDENDUM_2026-08-06.md`'s proximity-conversation correction already drew. **The game's
own guarantee is unchanged and still real: no mechanic, NPC, or player-facing system anywhere
reads this log or lets anyone replay a conversation.** This doc is about the separate, siloed
system that exists purely to let humans (Trust & Safety, a court order, a DSA regulator) do
their job — never referenced by `stepWorld`, never touched by simulation code.

## 2. What gets logged — minimum viable footprint, no audio ever

TTS synthesis is deterministic: the same INTENT/TONE/REFERENT/CONTEXT selection always renders
the same audio. That means the audio itself is redundant data — storing it would violate GDPR
Article 5's data-minimization principle for no operational benefit, since any investigator can
regenerate the exact clip from the structured selection alone. **The rendered audio file is
never generated server-side for storage, and never persisted, full stop.**

| Field | Source | Purpose |
|---|---|---|
| Event timestamp | Infra clock | Chronological context; correlates with a user report |
| Actor ID | Identity/auth layer | Who sent it, for any disciplinary action |
| Target ID(s) | Connection/spatial resolver | Who was addressed — needed to validate a targeted-harassment claim |
| Grammar payload | Comms engine (the exact INTENT/TONE/REFERENT/CONTEXT selection) | The actual substance of an alleged violation |
| Spatial coordinates / district | Spatial primitive | Confirms the interaction was physically possible under the game's own proximity rule |

This is the entire footprint. No free text (there isn't any — the grammar is closed-vocabulary
by construction), no derived sentiment score, no behavioral profile, no cross-reference to any
other player's log entries beyond what a single flagged incident needs.

## 3. Architecture: siloed backend, gameplay state stays unaware

- Structured events are transmitted from the WebSocket server to an isolated backend logging
  service as they pass through — never written to any table or object the game's simulation
  loop, NPCs, or clients can read.
- The simulation kernel (`world.ts`, `stepWorld`, everything in `src/engine`) has zero
  dependency on this service and zero awareness it exists — same discipline as `decay.ts` being
  generic and reusable without knowing what consumes it. If this service is ever offline, the
  game itself is completely unaffected; it isn't in the gameplay critical path.
- Access is restricted to Trust & Safety tooling and whatever automated abuse-classifier the
  platform runs — never exposed through any client-facing API, matching §1's guarantee.

## 4. Retention: bifurcated, and *not* required to match the diary's window

**Tier 1 — unflagged, rolling 30-day TTL, then permanently deleted or irreversibly
anonymized.** Justified independently of anything else in this codebase: GDPR requires DSAR
responses "without undue delay, and in any event within one month," so a platform that purges
unflagged logs at 30 days can answer a request by simply querying current state — nothing older
ever needs producing, which is a real, meaningful reduction in e-discovery/compliance surface,
not just a round number.

**Tier 2 — flagged (by a user report or an automated classifier), moved to a secure Dispute
Archive.** Retained for the duration of the investigation plus the DSA Article 20 minimum
6-month appeal window, then deleted. This is the *only* path any entry survives past 30 days,
and it requires an actual flag — nothing is retained longer "just in case."

**On the report's own suggestion to align this 30-day number with the diary's retention
window**: that recommendation was accurate when written but the premise moved the same day —
the diary's own retention shrank from ~30 days to ~2 the same session this report was
commissioned in (`DESIGN_ADDENDUM_2026-08-06.md`, corrected 2026-08-13; see `docs/DEVLOG.md`).
**These two systems are not required to share a number, and shouldn't now:**
- The diary's window is a *game-design* choice (how long a player's own private impressions
  stay fresh) with no legal basis and no compliance obligation attached to it at all — it could
  be 2 days or 20, nothing outside the game cares.
- The moderation log's 30-day window is a *compliance* choice, independently justified by
  GDPR's own one-month response cycle, completely unconnected to what the diary happens to do.

Coincidentally reusing "30 days" for the *unflagged-tier* TTL is fine and even convenient
(it's a familiar number, well-precedented industry-wide per the report's Riot/Epic/Arambro/
Gankster survey) — but it should be understood as independently arrived at, not "matching the
diary," since the diary no longer has that number and the two systems have no reason to track
each other going forward. If either changes later, the other is unaffected.

## 5. DSA obligations this architecture actually satisfies

| DSA mandate | What it requires | How this design satisfies it |
|---|---|---|
| Article 16 | Notice-and-action mechanism | A report UI plus Tier-2 archive gives Trust & Safety an actual record to act on |
| Article 17 | Statement of reasons for enforcement | The grammar payload + timestamp is the specific evidentiary basis a ban/warning notice cites |
| Article 20 | ≥6-month internal appeal window | Tier-2 Dispute Archive retention covers the full window by construction |
| Article 15 & 24 | Annual transparency reporting | Aggregate counts (notices, suspensions, automated-flag rate) are derivable from Tier-1/Tier-2 volumes without needing per-player content beyond the retention window |

## 6. Privacy policy / EULA language this requires

Per the report's own recommendation, refined with the FTC's disclosure requirement from §0:
state plainly that no microphone is used and no biometric voice data is ever collected; name
the specific internal operations the logged data supports (abuse investigation, moderation
appeals, legal compliance — nothing else); confirm it is never used for behavioral profiling or
advertising; and state the retention structure in plain terms (30 days if unflagged, up to the
duration of an investigation plus 6 months if flagged and appealed). This is drafting work for
whoever owns the platform's actual privacy policy — not simulated or modeled in this repo, same
as the rest of NODE's legal/EULA surface.

## 7. What this doc does NOT decide

- The actual backend logging service's technology, hosting, and data-residency choices — genuine
  infra decisions outside a game-design doc's scope.
- Encryption-at-rest specifics and access-control implementation for the Dispute Archive.
- Breach-notification procedure — a real legal obligation, but not a NODE design question.
- Whether/how this pattern extends to Wall/Envelope content once those exist server-side in a
  persisted form (they already do, per the grammar module) — worth a follow-up pass, not
  addressed here since the user's research request was scoped to proximity conversation
  specifically.
