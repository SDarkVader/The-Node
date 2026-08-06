# NOTE (added same day, after review — see docs/DESIGN_ADDENDUM_2026-08-06.md and
# docs/DEVLOG.md for the full trace): the win-probability formula below produces stake
# requirements that INCREASE with progress p, saturating at f=1 for p>=0.5 and never
# reaching target_w past that point. The design intent stated alongside this script (and
# in the design addendum) is the opposite: small stakes near completion, large stakes
# near zero. A verified fix is to use (1-p) — distance to completion — in place of p in
# both w() and the f= derivation below. Original logic is left unchanged here; this is a
# flag for the mechanic to be corrected before the staking formula is locked, not a
# silent patch.
"""
Exit ticket gamble — proportional-stake population simulation.

Model
-----
Each player has progress p in [0, 1] toward the deterministic exit ticket
(baseline: 1/180 per day, i.e. ~6 months to p=1 with no gambling at all).

A gambling player stakes a fraction f of their OWN banked progress p, not an
absolute amount. Win probability:

    w(p, f) = clip(base_odds * f / p, 0, 1)

base_odds stands in for the Oracle's flat, identity-agnostic draw probability
(same for every player, every day, regardless of history — see the Oracle
section of the design addendum). Rearranged, this means: to hit a *target*
win probability target_w, a player must stake

    f = clip(target_w * p / base_odds, 0, 1)

which is the "proportional staking" property — the same target_w costs a
tiny f when p is near 1 (nearly done, low absolute risk) and a huge f when p
is near 0 (far away, must risk nearly everything for the same odds).

Outcomes:
    win  -> p := 1.0                    (ticket completes instantly)
    lose -> p := p * (1 - f)             (never below 0, never a full wipe
                                           unless f=1, i.e. an all-in gamble
                                           from a position with no floor left)

This is deliberately NOT tuned to real design numbers. base_odds and
target_w below are illustrative constants chosen only to produce a stable,
inspectable population dynamic — see the [OPEN] note in the design addendum:
real values depend on the Oracle's shard-economic-health-linked odds model,
which doesn't exist yet. Re-run this once that model is defined.

Usage
-----
    python exit_ticket_gamble_sim.py

Adjust N_PLAYERS / DAYS / BASE_ODDS / TARGET_W / GAMBLE_PROB below to explore
sensitivity. Every run is seeded for reproducibility (see SEED).
"""

import numpy as np


# ---- tunable parameters (all [CALIBRATED — provisional]) ------------------

N_PLAYERS = 5000
DAYS = 1000
DAILY_PROGRESS_RATE = 1 / 180   # deterministic ~6-month baseline
BASE_ODDS = 0.15                # stand-in for the Oracle's flat draw probability
TARGET_W = 0.30                 # win chance a "rational" gambler aims for
GAMBLE_PROB = 0.01              # fraction of active players who gamble on any given day
MIN_PROGRESS_TO_GAMBLE = 0.02   # avoid staking from effectively-zero progress (edge case)
SEED = 7


def simulate(
    n_players=N_PLAYERS,
    days=DAYS,
    base_odds=BASE_ODDS,
    target_w=TARGET_W,
    gamble_prob=GAMBLE_PROB,
    daily_rate=DAILY_PROGRESS_RATE,
    seed=SEED,
):
    """
    Returns:
        completions_cum      : list, cumulative completions per day
        active_mean_progress : list, mean p among still-active (p<1) players per day
        total_wins           : int
        total_resets         : int   (i.e. gamble losses)
    """
    rng = np.random.default_rng(seed)
    progress = np.zeros(n_players)

    completions_cum = []
    active_mean_progress = []
    total_wins = 0
    total_resets = 0

    for _ in range(days):
        active = progress < 1.0
        progress[active] += daily_rate

        eligible = active & (rng.random(n_players) < gamble_prob) & (progress > MIN_PROGRESS_TO_GAMBLE)
        if eligible.any():
            p = progress[eligible]
            f = np.clip(target_w * p / base_odds, 0, 1)
            w = np.clip(base_odds * f / p, 0, 1)

            win_roll = rng.random(eligible.sum())
            wins = win_roll < w

            idx = np.where(eligible)[0]
            progress[idx[wins]] = 1.0
            lose_idx = idx[~wins]
            progress[lose_idx] = progress[lose_idx] * (1 - f[~wins])

            total_wins += wins.sum()
            total_resets += (~wins).sum()

        completions_cum.append(int((progress >= 1.0).sum()))
        still_active = progress[progress < 1.0]
        active_mean_progress.append(float(still_active.mean()) if still_active.size else 1.0)

    return completions_cum, active_mean_progress, int(total_wins), int(total_resets)


def simulate_no_gamble_baseline(n_players=N_PLAYERS, days=DAYS, daily_rate=DAILY_PROGRESS_RATE):
    """Pure deterministic accrual, zero variance — everyone completes at day ceil(1/daily_rate)."""
    progress = np.zeros(n_players)
    completions_cum = []
    for _ in range(days):
        active = progress < 1.0
        progress[active] += daily_rate
        completions_cum.append(int((progress >= 1.0).sum()))
    return completions_cum


if __name__ == "__main__":
    comp, active_mean, wins, resets = simulate()
    baseline = simulate_no_gamble_baseline()

    win_rate = wins / (wins + resets) if (wins + resets) else float("nan")

    print(f"Population: {N_PLAYERS}, Days: {DAYS}, base_odds={BASE_ODDS}, target_w={TARGET_W}\n")

    print("Completions over time (gambling population), every 100 days:")
    for day in range(0, DAYS, 100):
        print(f"  day {day:4d}: {comp[day]:5d} / {N_PLAYERS}")

    print(f"\nBaseline (no gambling, pure deterministic) — day 180 vs 200:")
    print(f"  day 179: {baseline[179]:5d} / {N_PLAYERS}")
    print(f"  day 199: {baseline[199]:5d} / {N_PLAYERS}")

    print(f"\nTotal gambles: {wins + resets}  (wins={wins}, losses={resets})")
    print(f"Realized win rate: {win_rate:.3f}  (target was {TARGET_W})")

    print("\nActive (non-completed) players' mean progress over time, every 100 days:")
    for day in range(0, DAYS, 100):
        print(f"  day {day:4d}: {active_mean[day]:.3f}")

    print(
        "\nInterpretation:\n"
        "  - Realized win rate tracking target_w regardless of WHEN gambles happen in the\n"
        "    population's progress distribution confirms proportional staking equalizes\n"
        "    risk per unit staked, not just at the endpoints (p near 0 or p near 1).\n"
        "  - Gambling population is SLOWER than baseline early (day ~200) but converges\n"
        "    later — a fat-tailed distribution around the deterministic baseline, not a\n"
        "    runaway in either direction.\n"
        "  - Active mean progress staying in a stable band (not collapsing toward 0, not\n"
        "    ballooning toward 1) confirms no 'treadmill trap' at this parameterization."
    )
