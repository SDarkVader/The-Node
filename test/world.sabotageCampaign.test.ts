import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../src/world/world.js';
import { BACKSTOP_PRODUCTIVITY } from '../src/engine/ecosystem.js';

/**
 * Real, wired integration for the 2026-08-18 sabotage restructure — pattern-based campaigns
 * promoted from `ecosystem.ts`'s "PROPOSAL, not shipped" to the live model, as persistent
 * multi-tick state on `World`. The pure state machine is covered in
 * `test/sabotageCampaign.test.ts`; this covers what only a real `stepWorld` run can show.
 */

function run(seed: number, days: number, config = DEFAULT_WORLD_CONFIG): { world: World; events: World['lastSabotageCampaignEvents'] } {
  let world = createWorld(seed, config);
  const events: World['lastSabotageCampaignEvents'] = [];
  for (let i = 0; i < days; i++) {
    world = stepWorld(world);
    events.push(...world.lastSabotageCampaignEvents);
  }
  return { world, events };
}

describe('sabotage campaigns wired into stepWorld', () => {
  it('campaigns really open, advance across days, and resolve — the mechanic is live, not dead code', () => {
    const { events } = run(1, 1500);
    const opened = events.filter((e) => e.type === 'opened');
    const caught = events.filter((e) => e.type === 'caught');
    const succeeded = events.filter((e) => e.type === 'succeeded');
    expect(opened.length).toBeGreaterThan(20);
    expect(caught.length).toBeGreaterThan(0);
    expect(succeeded.length).toBeGreaterThan(0);
  });

  it('a campaign persists on World across ticks — the property the one-shot resolver could not have', () => {
    let world = createWorld(2, DEFAULT_WORLD_CONFIG);
    let sawPersisting = false;
    let previousIds: string[] = [];
    for (let i = 0; i < 400 && !sawPersisting; i++) {
      world = stepWorld(world);
      const ids = world.sabotageCampaigns.map((c) => c.id);
      if (ids.some((id) => previousIds.includes(id))) sawPersisting = true;
      previousIds = ids;
    }
    expect(sawPersisting).toBe(true);
  });

  it('respects the concurrency cap and never runs two campaigns against the same building', () => {
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 1200; i++) {
      world = stepWorld(world);
      expect(world.sabotageCampaigns.length).toBeLessThanOrEqual(DEFAULT_WORLD_CONFIG.saboteurCount);
      const targets = world.sabotageCampaigns.map((c) => c.targetBuildingId);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });

  it('a successful campaign evicts the slot it actually targeted', () => {
    // A real behaviour change from the legacy resolver, which counted successes and then
    // evicted a RANDOM set of slots that need not have included the one it rolled against.
    let world = createWorld(4, DEFAULT_WORLD_CONFIG);
    let checked = 0;
    for (let i = 0; i < 2000 && checked < 3; i++) {
      const next = stepWorld(world);
      for (const e of next.lastSabotageCampaignEvents) {
        if (e.type !== 'succeeded') continue;
        const slot = [...next.millers, ...next.bakers, ...next.couriers, ...next.investigators, ...next.importExporters].find(
          (s) => s.buildingId === e.targetBuildingId,
        );
        expect(slot).toBeDefined();
        expect(slot!.slot.state).not.toBe('FILLED'); // evicted this very tick
        checked += 1;
      }
      world = next;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('campaign ids only ever grow, and nextCampaignId tracks them', () => {
    let world = createWorld(5, DEFAULT_WORLD_CONFIG);
    let last = world.nextCampaignId;
    for (let i = 0; i < 600; i++) {
      world = stepWorld(world);
      expect(world.nextCampaignId).toBeGreaterThanOrEqual(last);
      last = world.nextCampaignId;
    }
    expect(last).toBeGreaterThan(0);
  });

  it('the ambient hazard names nobody — saboteurId stays null until an identified actor opens one', () => {
    // The structural gap the restructure closes but does not yet fill: there is now a field to
    // hold a perpetrator, which is what any caught-saboteur consequence would need. The shipped
    // kernel's only opener is the ambient hazard, which has no actor to name.
    const { events } = run(6, 800);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.saboteurId).toBeNull();
  });

  it('CONSTRAINT 2 re-verified against live campaigns: sustained sabotage never produces a zero state', () => {
    // The design doc demanded this be re-checked rather than assumed to carry over from the
    // harness numbers, because a live stepper rolls against witness counts that move. Run with
    // the concurrency cap raised well past the default to apply real, sustained pressure.
    const heavy = { ...DEFAULT_WORLD_CONFIG, saboteurCount: 8, sabotageCadenceDays: 5 };
    for (const seed of [1, 2, 3]) {
      let world = createWorld(seed, heavy);
      let minHealth = 1;
      for (let i = 0; i < 1500; i++) {
        world = stepWorld(world);
        minHealth = Math.min(minHealth, world.economicHealth);
        expect(world.population).toBeGreaterThan(0);
      }
      // Never at or below the mechanical floor every BACKSTOPPED slot still produces.
      expect(minHealth).toBeGreaterThan(BACKSTOP_PRODUCTIVITY);
    }
  });

  it('population is still conserved every tick with campaigns evicting slots', () => {
    let world = createWorld(7, { ...DEFAULT_WORLD_CONFIG, saboteurCount: 6, sabotageCadenceDays: 6 });
    for (let i = 0; i < 900; i++) {
      world = stepWorld(world);
      const filled = [...world.millers, ...world.bakers, ...world.couriers, ...world.investigators, ...world.importExporters]
        .filter((s) => s.slot.state === 'FILLED').length;
      expect(world.grifters.length + filled).toBe(world.population);
    }
  });

  it('every campaign resolves inside the stated 100-day ceiling', () => {
    // "sabotage must be relatively easy... it can't take over 100 days" — the user's own
    // calibration target, now checkable directly because campaigns have a real duration.
    const openedOn = new Map<string, number>();
    const durations: number[] = [];
    let world = createWorld(8, DEFAULT_WORLD_CONFIG);
    for (let day = 0; day < 2500; day++) {
      world = stepWorld(world);
      for (const e of world.lastSabotageCampaignEvents) {
        if (e.type === 'opened') openedOn.set(e.campaignId, day);
        else {
          const start = openedOn.get(e.campaignId);
          if (start !== undefined) durations.push(day - start);
        }
      }
    }
    expect(durations.length).toBeGreaterThan(20);
    expect(Math.max(...durations)).toBeLessThanOrEqual(100);
  });

  it('abandons a campaign whose target already left by ordinary churn', () => {
    // Found by watching a real run: a campaign opened on day 2 was still working on day ~45
    // against a slot whose occupant had churned out on day 13 — six weeks and one of only
    // `saboteurCount` slots spent forcing out somebody already gone. Measured across 8 seeds x
    // 3000 days, 290 of 1069 resolved campaigns (27%) were in that state.
    const { events } = run(11, 1500);
    const abandoned = events.filter((e) => e.type === 'abandoned');
    expect(abandoned.length).toBeGreaterThan(0);
  });

  it('never keeps a campaign against a target that is not currently FILLED', () => {
    let world = createWorld(12, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 1200; i++) {
      world = stepWorld(world);
      const filled = new Set(
        [...world.millers, ...world.bakers, ...world.couriers, ...world.investigators, ...world.importExporters]
          .filter((s) => s.slot.state === 'FILLED')
          .map((s) => s.buildingId),
      );
      for (const c of world.sabotageCampaigns) {
        // A campaign that succeeded this very tick evicts its own target, so allow that case:
        // it is no longer in `sabotageCampaigns` either way.
        expect(filled.has(c.targetBuildingId)).toBe(true);
      }
    }
  });

  it('a fresh world starts with no campaigns in flight', () => {
    const world = createWorld(9, DEFAULT_WORLD_CONFIG);
    expect(world.sabotageCampaigns).toEqual([]);
    expect(world.nextCampaignId).toBe(0);
    expect(world.lastSabotageCampaignEvents).toEqual([]);
  });
});
