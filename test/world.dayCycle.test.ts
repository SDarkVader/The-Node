import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG } from '../src/world/world.js';
import { IMPORT_EXPORT_WINDOWS_UTC } from '../src/engine/dayCycle.js';

/**
 * The basic day (2026-08-24) — `World.lastImportExportWindows` wiring. Confirms the daily
 * Import/Export supply is now reported as real per-window events, and that splitting it this
 * way is byte-identical in total to the pre-existing single blended figure (`nodulesReceivedToday`/
 * `grainDeliveredToday`, still called exactly once per tick — see world.ts).
 */
describe('World.lastImportExportWindows', () => {
  it('reports exactly one event per dayCycle.ts import/export window, every tick', () => {
    let world = createWorld(1, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 5; i++) {
      world = stepWorld(world);
      expect(world.lastImportExportWindows.length).toBe(IMPORT_EXPORT_WINDOWS_UTC.length);
    }
  });

  it('window totals sum to exactly the same nodules/grain this tick\'s own resource ledger records — same source values, just reported with real per-window structure now', () => {
    let world = createWorld(2, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 5; i++) {
      world = stepWorld(world);
      const totalNodules = world.lastImportExportWindows.reduce((a, e) => a + e.nodulesReceived, 0);
      const totalGrain = world.lastImportExportWindows.reduce((a, e) => a + e.grainDelivered, 0);
      expect(totalNodules).toBeCloseTo(world.resources.today.nodulesReceived, 9);
      expect(totalGrain).toBeCloseTo(world.resources.today.grainDelivered, 9);
    }
  });

  it('windows are tagged in schedule order with real UTC hour anchors', () => {
    let world = createWorld(3, DEFAULT_WORLD_CONFIG);
    world = stepWorld(world);
    world.lastImportExportWindows.forEach((e, i) => {
      expect(e.window).toBe(i);
      expect(e.hourUtc).toBe(IMPORT_EXPORT_WINDOWS_UTC[i]![0]);
    });
  });

  it('is deterministic for a given seed, same as everything else in this kernel', () => {
    let a = createWorld(9, DEFAULT_WORLD_CONFIG);
    let b = createWorld(9, DEFAULT_WORLD_CONFIG);
    for (let i = 0; i < 10; i++) {
      a = stepWorld(a);
      b = stepWorld(b);
    }
    expect(a.lastImportExportWindows).toEqual(b.lastImportExportWindows);
  });
});
