"""
NODE core mechanics — consolidated, tested reference implementation.
Every function here was validated by simulation during the design session.
This file is the source of truth for the TypeScript port that follows.

KNOWN GAP, surfaced by writing this test suite (not previously caught):
Two economic-health formulas were used across the session, with different
denominators, and were never reconciled or run together:
  - economic_health()               -- used in the sabotage/floor tests (§8),
    normalizes against baseline (non-experience) output. This is the formula
    behind the "floors at exactly 40%" finding.
  - economic_health_with_experience() -- used in the experience/migration tests
    (§9), normalizes against the experience-boosted ceiling.
They are kept SEPARATE below rather than silently merged. Unifying them into
one model (experience-aware economic health under sabotage) is real, unstarted
work -- flagged explicitly, not assumed solved.
"""
import random
from typing import Optional

# ---- Canonical constants (do not silently change without re-running validation) ----
S_DEFAULT = 24                    # role slots per shard
NPC_PRODUCTIVITY = 0.4            # output multiplier for a BACKSTOPPED (NPC-run) slot
PLAYER_PRODUCTIVITY_BASE = 1.0    # base output multiplier for a player-held slot
EXPERIENCE_CAP = 0.5              # max experience bonus (player output caps at 1.5x)
EXPERIENCE_GAIN_PER_DAY = 0.01    # experience growth rate while actively in-role
MIGRATION_THETA = 0.30            # roleless-fraction threshold before emigration engages
MIGRATION_K = 0.08                # emigration rate coefficient once f > theta
TRAVEL_DAYS_TARGET = 168          # ~6 months, the corrected migration commitment window
TRAVEL_DECAY_PER_DAY = 0.0010     # experience decay/day while traveling (mid-band choice)
DETECTION_P_PER_WITNESS = 0.05    # per-witness, per-day detection probability

# ------------------------------------------------------------------------------------
# LAYER 1 — the NPC economic floor
# ------------------------------------------------------------------------------------

def economic_health(filled_by_player: int, s: int = S_DEFAULT) -> float:
    """
    Baseline economic health, 0..1, NO experience factored in.
    This is the formula validated by the sabotage/floor simulations (§8):
    floors at exactly NPC_PRODUCTIVITY (0.4) when filled_by_player == 0,
    because a vacated slot always reverts to NPC-run output, never to zero.
    """
    npc_slots = s - filled_by_player
    total = filled_by_player * PLAYER_PRODUCTIVITY_BASE + npc_slots * NPC_PRODUCTIVITY
    return total / (s * PLAYER_PRODUCTIVITY_BASE)


def economic_health_with_experience(filled_by_player: int, avg_experience: float,
                                     s: int = S_DEFAULT) -> float:
    """
    Extended variant incorporating experience bonus (§9's model).
    NOT yet validated jointly with the sabotage/floor tests above -- treat as a
    separate mechanic until a combined simulation is run.
    """
    npc_slots = s - filled_by_player
    player_output = filled_by_player * (PLAYER_PRODUCTIVITY_BASE + avg_experience)
    npc_output = npc_slots * NPC_PRODUCTIVITY
    max_possible = s * (PLAYER_PRODUCTIVITY_BASE + EXPERIENCE_CAP)
    return (player_output + npc_output) / max_possible


# ------------------------------------------------------------------------------------
# LAYER 2 — occupancy: detection risk, experience growth/decay, districting
# ------------------------------------------------------------------------------------

def detection_probability(other_role_holders: int, p_per_witness: float = DETECTION_P_PER_WITNESS) -> float:
    """P(at least one witness sees a given action), given n other role-holders present."""
    return 1 - (1 - p_per_witness) ** max(0, other_role_holders)


def grow_experience(current: float, gain_per_day: float = EXPERIENCE_GAIN_PER_DAY,
                     cap: float = EXPERIENCE_CAP) -> float:
    return min(cap, current + gain_per_day)


def decay_experience_traveling(current: float, decay_per_day: float = TRAVEL_DECAY_PER_DAY) -> float:
    return max(0.0, current - decay_per_day)


def district_arrival_choice(core_open: bool, periphery_open: bool, core_bias: float,
                             rng: random.Random) -> Optional[str]:
    """
    core_bias: weight ratio favoring core when both are open (e.g. 2.0 = 2x more
    likely to choose core over periphery). Validated range for a defensible split
    without emptying periphery: 2.0-3.0. Beyond ~10, periphery starts to empty out.
    """
    if core_open and periphery_open:
        return "core" if rng.random() < core_bias / (core_bias + 1) else "periphery"
    if core_open:
        return "core"
    if periphery_open:
        return "periphery"
    return None


# ------------------------------------------------------------------------------------
# LAYER 3 — migration valve (roleless-pressure-driven emigration)
# ------------------------------------------------------------------------------------

def migration_valve_step(n: int, filled: int, theta: float = MIGRATION_THETA,
                          k: float = MIGRATION_K, rng: random.Random = None) -> int:
    """
    Given current population N and filled role slots, returns emigrants this step
    (stochastic rounding). f = roleless_fraction = R/N. No emigration below theta
    (the "comfortable" cutoff). Above theta, rate scales with (f - theta) -- the
    negative-feedback term making this self-stabilizing at any density (validated:
    equilibrium f* rises smoothly from ~0.29 to a ceiling of ~0.615 across arrival
    pressure from near-zero to unbounded; it never diverges).
    """
    if rng is None:
        rng = random.Random()
    r = n - filled
    if r <= 0 or n <= 0:
        return 0
    f = r / n
    if f <= theta:
        return 0
    rate = k * (f - theta)
    expected = r * rate
    emigrants = int(expected) + (1 if rng.random() < (expected % 1) else 0)
    return min(emigrants, r)


# ------------------------------------------------------------------------------------
# LAYER 3 — sabotage: acquisition/detection roll, and forced-damage shock application
# ------------------------------------------------------------------------------------

def sabotage_attempt(saboteur_count: int, time_to_acquire_days: int,
                      detection_p_per_day: float, rng: random.Random) -> int:
    """Returns number of saboteurs who reach the acquisition deadline undetected."""
    successful = 0
    for _ in range(saboteur_count):
        caught = False
        for _ in range(time_to_acquire_days):
            if rng.random() < detection_p_per_day:
                caught = True
                break
        if not caught:
            successful += 1
    return successful


def apply_sabotage_damage(filled_by_player: int, successful_saboteurs: int,
                           damage_per_success: int) -> int:
    """Slots evicted revert to NPC (BACKSTOPPED), never to zero -- see Layer 1."""
    return max(0, filled_by_player - successful_saboteurs * damage_per_success)


# ------------------------------------------------------------------------------------
# TEST / ACCEPTANCE SUITE
# ------------------------------------------------------------------------------------

def run_acceptance_tests():
    results = []

    # T1: NPC floor -- zero players floors economic health at exactly 0.4
    eh = economic_health(filled_by_player=0, s=24)
    results.append(("T1_npc_floor_at_zero_players", round(eh, 4), 0.40, abs(eh - 0.40) < 1e-9))

    # T2: full player occupancy at max experience should hit 1.0 (experience-aware variant)
    eh_full = economic_health_with_experience(filled_by_player=24, avg_experience=0.5, s=24)
    results.append(("T2_full_veteran_occupancy", eh_full, 1.0, abs(eh_full - 1.0) < 1e-9))

    # T3: detection probability at 23 witnesses should land near 0.693 (69.3%)
    dp = detection_probability(23)
    results.append(("T3_detection_full_shard", round(dp, 3), 0.693, abs(dp - 0.693) < 0.005))

    # T4: migration valve equilibrium -- run to convergence at high arrival pressure
    rng = random.Random(1)
    n, filled = 0, 0
    S = 24
    for day in range(6000):
        if rng.random() < 0.95:
            n += 1
            if filled < S:
                filled += 1
        emigrants = migration_valve_step(n, filled, rng=rng)
        n -= emigrants
    f_final = (n - filled) / n if n > 0 else 0
    results.append(("T4_migration_ceiling_holds", round(f_final, 3), "0.55-0.68",
                     0.55 <= f_final <= 0.68))

    # T5: sustained forced-damage attack (matches §8's exact scenario: 12/24 slots
    # evicted every 20 days, forever, at BASELINE arrival pressure lambda=0.10 --
    # NOT the saturating 0.95 used in T4's ceiling-hunt) permanently suppresses
    # the shard to a long-run average near 40%, never fully recovering.
    # IMPORTANT: this must be measured as a long-run AVERAGE over many post-
    # transient days, not a single snapshot -- the system oscillates between
    # shocks, so a snapshot timed between attacks can misleadingly show near-100%.
    rng = random.Random(1)
    n, filled = 40, 24
    econ_tail = []
    for day in range(1, 900):
        if day % 20 == 0:
            filled = apply_sabotage_damage(filled, successful_saboteurs=3, damage_per_success=4)
        if rng.random() < 0.10:
            n += 1
            if filled < S:
                filled += 1
        emigrants = migration_valve_step(n, filled, rng=rng)
        n -= emigrants
        if day >= 400:
            econ_tail.append(economic_health(filled, S))
    eh_sustained_avg = sum(econ_tail) / len(econ_tail)
    results.append(("T5_sustained_attack_floor_avg", round(eh_sustained_avg, 3), "0.35-0.50",
                     0.35 <= eh_sustained_avg <= 0.50))

    # T6: experience decay over a 6-month migration lands in the 25-60% loss band
    exp = EXPERIENCE_CAP
    for _ in range(TRAVEL_DAYS_TARGET):
        exp = decay_experience_traveling(exp)
    pct_lost = (EXPERIENCE_CAP - exp) / EXPERIENCE_CAP * 100
    results.append(("T6_six_month_travel_decay_pct", round(pct_lost, 1), "25-60%",
                     25 <= pct_lost <= 60))

    return results


if __name__ == "__main__":
    all_pass = True
    for name, actual, expected, passed in run_acceptance_tests():
        status = "PASS" if passed else "FAIL"
        if not passed:
            all_pass = False
        print(f"[{status}] {name}: actual={actual}  expected={expected}")
    print()
    print("ALL TESTS PASS" if all_pass else "SOME TESTS FAILED — DO NOT SHIP")
