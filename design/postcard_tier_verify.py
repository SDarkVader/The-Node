"""Independent verification of docs/DESIGN_ADDENDUM_2026-08-07.md's §6 simulation
findings (2026-08-07). The original simulation
(`/home/claude/node_sim/postcard_tier_sim.py`, per the addendum's own text) lives in a
different local sandbox and was never pushed to this repo, so this is a fresh,
independently-written model built only from the addendum's prose description — not a
copy of the original script. Two things are checked:

1. The deterministic safe-path baseline (no gambling) by closed-form math: 5^4 = 625
   White per Orange, x3 Orange = 1875 White needed. At 2.0/hr that's 937.5 hours =
   39.06 days (addendum states "40"); at 1.0/hr, 1875 hours = 78.12 days (addendum
   states "79"). Both close-form, not simulated — exact given the stated recipe.
2. The gambling-strategy population table (§6), via Monte Carlo. Modeling assumption
   (not fully pinned down by the addendum's prose, flagged in the verification note):
   a "strategy k" player gambles with exactly k same-tier pieces at every gamble-eligible
   step (Green->Blue, Blue->Purple, Purple->Orange) as soon as k pieces are available,
   never banking to 5 for a safe fuse at those tiers. White->Green stays safe-only
   (5:1, no gamble), per the addendum's explicit rule for the bottom tier.

Run: `python3 design/postcard_tier_verify.py` (no dependencies beyond the stdlib).
"""
import random
import statistics

WEIGHTS = {'white': 1, 'green': 3, 'blue': 8, 'purple': 20, 'orange': 50}
RATE = 2.0  # White/hour, the addendum's illustrative baseline
TICKETS_NEEDED = 3


def simulate_player(rng, k):
    counts = {'white': 0.0, 'green': 0, 'blue': 0, 'purple': 0, 'orange': 0}
    hour = 0
    while counts['orange'] < TICKETS_NEEDED:
        hour += 1
        counts['white'] += RATE

        # White -> Green: always safe, deterministic 5:1 — no gamble option at this tier.
        while counts['white'] >= 5:
            counts['white'] -= 5
            counts['green'] += 1

        # Green -> Blue, Blue -> Purple, Purple -> Orange: fixed strategy k.
        for lo, hi in [('green', 'blue'), ('blue', 'purple'), ('purple', 'orange')]:
            if k == 5:
                while counts[lo] >= 5:
                    counts[lo] -= 5
                    counts[hi] += 1
            else:
                while counts[lo] >= k:
                    counts[lo] -= k
                    # Same-tier pieces contributed => weights cancel in the addendum's
                    # p_success formula, leaving p = k/5 exactly.
                    if rng.random() < k / 5.0:
                        counts[hi] += 1
        if hour > 24 * 365 * 5:  # 5-year safety cutoff against a stuck run
            return None
    return hour / 24.0


def run(k, n=300, seed=42):
    rng = random.Random(seed)
    days = [simulate_player(rng, k) for _ in range(n)]
    days = [d for d in days if d is not None]
    return {
        'median': statistics.median(days),
        'mean': statistics.mean(days),
        'min': min(days),
        'max': max(days),
    }


if __name__ == '__main__':
    print("Closed-form safe-path check (no simulation needed, exact given the recipe):")
    white_needed = TICKETS_NEEDED * 5**4
    for rate in (2.0, 1.0):
        print(f"  rate={rate}/hr -> {white_needed / rate / 24:.2f} days")

    print("\nMonte Carlo, n=300 (matching the addendum's stated population size):")
    print(f"{'strategy':<12}{'median':>8}{'mean':>8}{'min':>8}{'max':>8}")
    for k in [5, 4, 3, 2, 1]:
        r = run(k)
        label = 'safe (5/5)' if k == 5 else f'k={k}/5'
        print(f"{label:<12}{r['median']:>8.1f}{r['mean']:>8.1f}{r['min']:>8.1f}{r['max']:>8.1f}")
