import { describe, expect, it } from 'vitest';
import { postToWall } from '../src/comms/grammar.js';
import { ConnectionGraph } from '../src/comms/connections.js';
import { DEFAULT_RUMOUR_CONFIG, propagateRumour, type RumourMillConfig } from '../src/comms/rumourMill.js';
import { mulberry32 } from '../src/sim/rng.js';

function config(seed: number, overrides: Partial<RumourMillConfig> = {}): RumourMillConfig {
  return { ...DEFAULT_RUMOUR_CONFIG, rng: mulberry32(seed), ...overrides };
}

describe('§3.2 — rumour mill', () => {
  it('propagates to a strongly connected neighbor', () => {
    const graph = new ConnectionGraph();
    graph.connect('a', 'b', 0.9);
    const seed = postToWall('a', 'isolated', 1);

    const events = propagateRumour(seed, graph, config(1, { baseSpreadChance: 0.9 }));

    expect(events.some((e) => e.heardBy === 'b')).toBe(true);
  });

  it('never reaches a player with no path from the origin', () => {
    const graph = new ConnectionGraph();
    graph.connect('a', 'b', 0.9);
    graph.connect('c', 'd', 0.9); // disconnected component
    const seed = postToWall('a', 'isolated', 1);

    const events = propagateRumour(seed, graph, config(2, { baseSpreadChance: 1 }));

    expect(events.some((e) => e.heardBy === 'c' || e.heardBy === 'd')).toBe(false);
  });

  it('is reliably imperfect: distortion happens across enough trials, but not every trial', () => {
    const graph = new ConnectionGraph();
    graph.connect('a', 'b', 1);
    const seed = postToWall('a', 'isolated', 1);

    let distortedCount = 0;
    let totalHeard = 0;
    for (let trial = 0; trial < 200; trial++) {
      const events = propagateRumour(seed, graph, config(trial, { baseSpreadChance: 1, distortionRate: 0.25 }));
      const heard = events.find((e) => e.heardBy === 'b');
      if (heard) {
        totalHeard += 1;
        if (heard.distorted) distortedCount += 1;
      }
    }

    expect(totalHeard).toBeGreaterThan(150); // spread chance is 1, so nearly every trial delivers it
    const distortionFraction = distortedCount / totalHeard;
    expect(distortionFraction).toBeGreaterThan(0.05);
    expect(distortionFraction).toBeLessThan(0.5);
  });

  it('respects maxHops even on a long connected chain', () => {
    const graph = new ConnectionGraph();
    const chain = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (let i = 0; i < chain.length - 1; i++) {
      graph.connect(chain[i]!, chain[i + 1]!, 1);
    }
    const seed = postToWall('a', 'hopeful', 1);

    const events = propagateRumour(
      seed,
      graph,
      config(3, { baseSpreadChance: 1, distortionRate: 0, decayPerHop: 0.01, clarityFloor: 0, maxHops: 3 }),
    );

    expect(events.every((e) => e.hop <= 3)).toBe(true);
    expect(events.some((e) => e.heardBy === 'h')).toBe(false); // h is 7 hops from a
  });

  it('decay stops propagation before maxHops once clarity drops below the floor', () => {
    const graph = new ConnectionGraph();
    const chain = ['a', 'b', 'c', 'd', 'e'];
    for (let i = 0; i < chain.length - 1; i++) {
      graph.connect(chain[i]!, chain[i + 1]!, 1);
    }
    const seed = postToWall('a', 'secure', 1);

    const events = propagateRumour(
      seed,
      graph,
      config(4, { baseSpreadChance: 1, distortionRate: 0, decayPerHop: 0.5, clarityFloor: 0.4, maxHops: 10 }),
    );

    // clarity: hop1 = 0.5 (passes, >= 0.4), hop2 = 0.0 (dropped, below floor) -> stops at b
    expect(events.some((e) => e.heardBy === 'b')).toBe(true);
    expect(events.some((e) => e.heardBy === 'c')).toBe(false);
  });

  it('a zero-probability spread chance never propagates', () => {
    const graph = new ConnectionGraph();
    graph.connect('a', 'b', 1);
    const seed = postToWall('a', 'grateful', 1);

    const events = propagateRumour(seed, graph, config(5, { baseSpreadChance: 0 }));

    expect(events).toHaveLength(0);
  });
});
