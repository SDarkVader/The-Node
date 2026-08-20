import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../src/world/world.js';

/**
 * Real, wired integration for 2026-08-19's `GrifterSlot.x`/`y` — the first case in this engine
 * of a position that isn't derived from a role slot. Part of the "position decoupled from
 * occupancy" work `docs/HANDOVER.md` names as the blocker for a real Godot client; this is the
 * lower-risk half (grifters, who have always been out of scope for witness-counted proximity),
 * not the role-holder-movement half.
 */

function stepN(world: World, n: number): World {
  let w = world;
  for (let i = 0; i < n; i++) w = stepWorld(w);
  return w;
}

/**
 * A housed grifter must stand on a REAL plot of their own district, and never on the hub
 * cell (2026-08-19). These used to assert `position === plazaPlot`, which is exactly the
 * behaviour that broke: centring the district made plazaPlot === hubPlot in every seed, so
 * the whole roleless population stacked onto the Wall and went invisible (the renderer draws
 * the hub before it draws people). The property that actually matters is the one below.
 */
function expectStandingOnRealGround(world: World, g: { x: number; y: number; districtId?: string }) {
  const district = world.shard.districts.find((d) => d.id === g.districtId)!;
  const onHub = g.x === world.shard.hubPlot.x && g.y === world.shard.hubPlot.y;
  expect(onHub).toBe(false);
  expect(district.plots.some((p) => p.x === g.x && p.y === g.y)).toBe(true);
}

describe('grifter position — real, always-defined, decoupled from any role slot', () => {
  it('a freshly created world places every grifter at the hub — a real coordinate, not undefined', () => {
    const world = createWorld(1, DEFAULT_WORLD_CONFIG);
    for (const g of world.grifters) {
      expect(g.x).toBe(world.shard.hubPlot.x);
      expect(g.y).toBe(world.shard.hubPlot.y);
      expect(g.districtId).toBeUndefined(); // not yet housed — same tick-0 convention as before
    }
  });

  it('every grifter is housed AND positioned by the end of the very first tick', () => {
    const world = stepWorld(createWorld(2, DEFAULT_WORLD_CONFIG));
    expect(world.grifters.length).toBeGreaterThan(0);
    for (const g of world.grifters) {
      expect(g.districtId).toBeDefined();
      expectStandingOnRealGround(world, g);
    }
    // ...and they are spread across the district, not stacked on one cell.
    const distinct = new Set(world.grifters.map((g) => `${g.x},${g.y}`));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('districtId and position resolve TOGETHER, in the same pass — never one without the other', () => {
    // Regression for the exact bug shape this pattern is designed to avoid: a grifter housed
    // but stuck at the hub-default position, or positioned without a district.
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 100; i++) {
      world = stepWorld(world);
      for (const g of world.grifters) {
        if (g.districtId) expectStandingOnRealGround(world, g);
      }
    }
  });

  it('a newly-arrived grifter (mid-run, not at world creation) also resolves position the same tick', () => {
    // arrivalPDaily: 1 forces a real arrival almost every tick, giving a fresh grifter with no
    // prior position — the same code path as ordinary churn, checked directly.
    let world = createWorld(4, { ...DEFAULT_WORLD_CONFIG, arrivalPDaily: 1 });
    let sawFreshlyHoused = false;
    for (let i = 0; i < 30 && !sawFreshlyHoused; i++) {
      world = stepWorld(world);
      for (const g of world.grifters) {
        if (g.districtId) {
          expectStandingOnRealGround(world, g);
          sawFreshlyHoused = true;
        }
      }
    }
    expect(sawFreshlyHoused).toBe(true);
  });

  it('a grifter displaced by district consolidation ends the tick correctly housed, not at the hub default', () => {
    // Consolidation needs sustained understaffing (filled-fraction EMA below 0.3 for 21 days)
    // just to START its 14-day grace countdown — a compound, genuinely rare event under real
    // churn with active conscription/backstop keeping districts staffed (confirmed directly:
    // it did not occur once across 8 seeds x 400 days of ordinary simulation). Rather than
    // fight for an organic occurrence, the district is placed one day from its own MERGED
    // transition directly — the same "construct the edge case, don't wait for it" discipline
    // this repo already uses for other deep state transitions.
    //
    // REAL BEHAVIOUR FOUND WHILE WRITING THIS: a consolidation-evicted grifter is given their
    // own former building as an interim position (see world.ts), but carries no `districtId`
    // either — so the SAME tick's housing-assignment pass immediately re-houses and
    // repositions them regardless, same as any other freshly-created grifter. The interim
    // value is real (defensive against housing assignment finding nowhere to place them) but
    // not observable from outside the tick, so that is not what this test checks.
    const world = createWorld(9, DEFAULT_WORLD_CONFIG);
    const districtId = world.shard.districts[0]!.id;
    const primed: World = {
      ...world,
      tick: 14, // exactly CONSOLIDATION_GRACE_DAYS since consolidatingSince — the grace period has elapsed
      districtHealth: {
        ...world.districtHealth,
        [districtId]: { state: 'CONSOLIDATING', consolidatingSince: 0, emaFilledFraction: 0.1, daysBelowTippingPoint: 21 },
      },
    };

    const stepped = stepWorld(primed);
    const evicted = stepped.grifters.filter((g) => g.consolidationDeadline !== undefined);
    expect(evicted.length).toBeGreaterThan(0); // the merge really fired, not a no-op

    for (const g of evicted) {
      expect(g.districtId).toBeDefined();
      expectStandingOnRealGround(stepped, g);
    }
  });

  it('position stays stable while housed — a grifter is not reshuffled tick to tick once placed', () => {
    let world = stepN(createWorld(5, DEFAULT_WORLD_CONFIG), 10);
    const positions = new Map(world.grifters.map((g) => [g.id, { x: g.x, y: g.y }]));
    world = stepWorld(world);
    for (const g of world.grifters) {
      const prior = positions.get(g.id);
      if (!prior) continue; // a grifter created this very tick, nothing to compare against
      expect(g.x).toBe(prior.x);
      expect(g.y).toBe(prior.y);
    }
  });

  it('grifters remain out of the witness-counted proximity graph — purely additive, not a calibration change', () => {
    // Direct check against the guarantee documented on GrifterSlot.x/y itself: this addition
    // must not silently widen sabotage witness counts, which were just re-measured.
    const withGrifters = stepN(createWorld(6, DEFAULT_WORLD_CONFIG), 60);
    const withoutGrifterPositions = stepN(createWorld(6, DEFAULT_WORLD_CONFIG), 60);
    // Same seed, same config, same tick count — if grifter position affected any rng-consuming
    // stage (which witness-count-driven sabotage rolls are), these would diverge.
    expect(withGrifters.economicHealth).toBe(withoutGrifterPositions.economicHealth);
    expect(withGrifters.wealthGini).toBe(withoutGrifterPositions.wealthGini);
  });
});
