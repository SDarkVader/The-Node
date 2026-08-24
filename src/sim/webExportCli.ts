import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../world/world.js';
import { computeEconomicHeat } from '../engine/economicHeat.js';
import { applyDriverTick } from './playtestDrivers.js';
import { collectEvents } from './playtestRenderer.js';
import { mulberry32 } from './rng.js';
import { completionRatio, TYPICAL_COMPLETION_RATIO, type CompletionRoleType } from '../engine/roleCompletion.js';
import { writeFileSync } from 'node:fs';

/**
 * `npm run web-export -- <out.json> [seed] [days]` — records a real run to a compact JSON
 * snapshot for the browser viewer (`docs/web/` template), so the node can be LOOKED at from a
 * phone or anywhere without a terminal.
 *
 * Deliberately a recording, not a game. It carries no avatar, no movement and no player entity,
 * because none of those exist in the engine — see `docs/DESIGN_PLAYTEST_HARNESS_2026-08-18.md`.
 * Roughly a third of the population (grifters) have no coordinates at all and so cannot appear.
 * Being INSIDE the place is the Godot client's job, not this one's.
 *
 * Encoding is positional arrays rather than keyed objects purely for size: 180 days x 62
 * buildings x 8 fields lands near 288KB, which inlines comfortably into one page.
 */

const OUT = process.argv[2] ?? 'world.json';
const SEED = Number(process.argv[3] ?? 7);
const DAYS = Number(process.argv[4] ?? 180);
let w: World = createWorld(SEED, DEFAULT_WORLD_CONFIG);
const rng = mulberry32(SEED ^ 0x5eed);

// Captured once ONLY for geometry, which never changes after generation. Anything that
// ACCUMULATES per tick (weatherHistory, population) must be re-read from the current `w` each
// frame — `stepWorld` returns a fresh World with a fresh shard, so a reference held from day 0
// silently reports day-0 values forever. That exact mistake shipped tension as a flat 0 across
// a whole 180-day export before it was caught by looking at the render.
const geom = w.shard.districts[0]!;
const buildings = geom.buildings.map((b) => ({ id: b.id, x: b.x, y: b.y, f: b.floors }));
const bIndex = new Map(buildings.map((b, i) => [b.id, i] as const));
const streets = geom.plots.filter((p) => !p.buildingId).map((p) => ({ x: p.x, y: p.y, k: p.kind === 'plaza' ? 1 : 0 }));

const ROLES: [string, CompletionRoleType, (w:World)=>any[]][] = [
  ['M','miller',w=>w.millers],['B','baker',w=>w.bakers],['C','courier',w=>w.couriers],
  ['I','investigator',w=>w.investigators],['X','importExport',w=>w.importExporters],
];
const ST = { FILLED:0, BACKSTOPPED:1, VACANT:2 } as const;

const frames: any[] = [];
for (let day = 0; day < DAYS; day++) {
  w = applyDriverTick(w, rng).world;
  w = stepWorld(w);
  const heat = computeEconomicHeat(w);
  // per-building: [roleIdx, stateIdx, heat*100, wealth*10, daysInRole, exp*1000, doneRatio*100, campaignSteps(-1 none)]
  const cells: number[][] = buildings.map(()=>[-1,-1,0,0,0,0,-1,-1]);
  ROLES.forEach(([g, role, get], ri) => {
    for (const s of get(w)) {
      const i = bIndex.get(s.buildingId); if (i===undefined) continue;
      const stats = w.completionStats[s.buildingId];
      const camp = w.sabotageCampaigns.find(c=>c.targetBuildingId===s.buildingId);
      cells[i] = [ri, ST[s.slot.state as keyof typeof ST], Math.round((heat[s.buildingId]??0)*100),
        Math.round(s.wealth*10), s.daysInRole, Math.round((s.experience??0)*1000),
        stats&&stats.attempts>0?Math.round(completionRatio(stats)*100):-1,
        camp?camp.stepsCompleted:-1];
    }
  });
  const filled = ROLES.reduce((n,[,,get])=>n+get(w).filter((s:any)=>s.slot.state==='FILLED').length,0);
  const total = ROLES.reduce((n,[,,get])=>n+get(w).length,0);
  frames.push({
    d: w.tick, p: w.population, g: w.grifters.length, fl: filled, tt: total,
    fp: +w.flourPrice.toFixed(3), h: +w.economicHealth.toFixed(3), hx: +w.economicHealthWithExperience.toFixed(3),
    gi: +w.wealthGini.toFixed(3), t: +(w.shard.districts[0]!.weatherHistory.at(-1)?.tension ?? 0).toFixed(3),
    c: cells, e: collectEvents(w),
  });
}
writeFileSync(OUT, JSON.stringify({
  seed: SEED, buildings, streets, hub: w.shard.hubPlot, plaza: geom.plazaPlot,
  bounds: {
    minX: Math.min(...geom.plots.map((p) => p.x)), maxX: Math.max(...geom.plots.map((p) => p.x)),
    minY: Math.min(...geom.plots.map((p) => p.y)), maxY: Math.max(...geom.plots.map((p) => p.y)),
  },
  typical: Object.fromEntries(ROLES.map(([,r])=>[r, Math.round(TYPICAL_COMPLETION_RATIO[r]*100)])),
  frames,
}));
console.log(`wrote ${OUT} — seed ${SEED}, ${frames.length} days, ${buildings.length} buildings, ${streets.length} streets`);
