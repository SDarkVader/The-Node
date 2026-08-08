# Sanity check: confirm order-of-operations within a single day matters, since
# whoever implements the daily tick needs to replicate this exactly, not guess.
import sys
sys.path.insert(0, '.')
from node_core import apply_sabotage_damage, migration_valve_step, economic_health
import random

def run(shock_before_arrival: bool, days=900):
    rng = random.Random(1)
    n, filled = 40, 24
    S = 24
    econ_tail = []
    for day in range(1, days):
        def do_shock():
            nonlocal filled
            if day % 20 == 0:
                filled = apply_sabotage_damage(filled, 3, 4)
        def do_arrival():
            nonlocal n, filled
            if rng.random() < 0.10:
                n += 1
                if filled < S:
                    filled += 1
        if shock_before_arrival:
            do_shock(); do_arrival()
        else:
            do_arrival(); do_shock()
        emigrants = migration_valve_step(n, filled, rng=rng)
        n -= emigrants
        if day >= 400:
            econ_tail.append(economic_health(filled, S))
    return sum(econ_tail)/len(econ_tail)

print("shock BEFORE arrival (validated order):", round(run(True), 3))
print("shock AFTER arrival  (different order):", round(run(False), 3))
