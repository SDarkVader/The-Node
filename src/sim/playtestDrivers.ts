import type { World } from '../world/world.js';
import type { WallPost } from '../comms/grammar.js';
import { distance } from '../engine/space.js';
import { DRIVERS, assignDriverStrategy, driverForPlayer } from './drivers/index.js';
import type { DriverAction, DriverRole, DriverStrategy, DriverVisibleState } from './drivers/types.js';

/**
 * Applies `src/sim/drivers/`'s synthetic drivers to a real `World`, so the playtest harness
 * has inhabitants doing things rather than a settlement that only churns.
 *
 * WHY THIS LIVES IN `src/sim/` AND MUST STAY HERE. `src/sim/drivers/README.md` is explicit
 * that those drivers are test instrumentation, never game content — the resolution to
 * `CLAUDE.md` constraint 3's tension ("running a world requires occupants making decisions,
 * which is in direct tension with 'ask does this need to be an agent'"). That boundary is
 * enforced structurally by `test/drivers.importGuard.test.ts`, which fails the build if
 * anything under `src/engine/`, `src/world/`, or `src/server/` imports from the drivers
 * directory. This module is the APPLIER those drivers never had, and it is deliberately on
 * the sim side of that line: `stepWorld` knows nothing about it, and adding it changes no
 * shipped behaviour. Never move this into `src/world/`.
 *
 * WHAT ACTUALLY GETS APPLIED, and why the rest doesn't (checked against every driver's real
 * emissions, not assumed from the `DriverAction` union's breadth). The four drivers only ever
 * emit five of the union's eight members:
 *
 *   - `postToWall`   APPLIED. Queued into `World.pendingWallPosts`, which `stepWorld` already
 *                    consumes. This is the one that matters: a Wall post drives rumour
 *                    propagation -> identity resolution -> diary writes -> pressure detection
 *                    -> District Weather tension, an entire causal chain that sits dead in a
 *                    world where nothing ever posts.
 *   - `idle`         APPLIED trivially (nothing happens, which is the point of the control).
 *   - `occupySlot`   NOT applied. `stepMultiRoleConscriptionDay` already owns who fills which
 *                    slot, including the reputation gate and the backstop. A driver grabbing
 *                    a slot behind its back would fight the mechanic under test rather than
 *                    exercise it.
 *   - `move`         APPLIED, for grifters AND role-holders (2026-08-19, once role slots gained
 *                    their own `x`/`y` — see `world.ts`'s `SlotPosition` note). Clamped to the
 *                    shard's real plot bounds.
 *
 *                    **This one is not inert, unlike the rest of this file.** `stepWorld`'s
 *                    `occupantsOf` reads a role-holder's OWN position now, and that set feeds
 *                    witness counts (sabotage detection), identity resolution and District
 *                    Weather. A moving population therefore produces genuinely different
 *                    detection and resolution numbers from a pinned one — not a bug, the whole
 *                    point, but it means the existing 43.6%/28.9-day sabotage calibration was
 *                    measured against a pinned layout and does NOT describe a world where
 *                    people walk around. Re-measuring that belongs with whatever first makes
 *                    role-holders move in the SHIPPED world; this applier is sim-side only, so
 *                    nothing shipped changed when it started landing these.
 *
 *                    Economically inert either way: every production/wage/market path in
 *                    `stepWorld` keys off `buildingId`, never position, so a Miller who wanders
 *                    off still mills. Whether that should stay true is a real open design
 *                    question, deliberately not answered here.
 *   - `attemptSabotageStep` NOT applied. Blocked on the campaign-persistence finding in
 *                    `docs/DESIGN_PLAYTEST_HARNESS_2026-08-18.md` §4 — `patternSabotageAttempt`
 *                    resolves a whole campaign in one call, so there is no in-flight campaign
 *                    for a per-tick step to advance.
 *
 * The remaining three (`sendEnvelope`, `vacateSlot`, `setPrice`) are unreachable: no driver
 * emits them. `sendEnvelope` additionally has no home — `World` has no pending-envelope queue,
 * unlike Wall posts and diary entries.
 *
 * ALSO A REAL LIMITATION, not an oversight: `DriverRole` is `'miller' | 'baker' | 'gossip'`,
 * from Phase C's original two-role era. The four support roles have no driver role at all, so
 * Couriers, Journalists, Detectives and Import/Exporters stay silent here.
 */

/**
 * Strategy assignment reuses `drivers/index.ts`'s own `assignDriverStrategy` rather than
 * inventing a second scheme — that function is already the spec's "chosen by seed," already
 * weighted deliberately (honest a plurality, saboteur rare), and already documented as a pure
 * function of `(seed, playerIndex)` computable independently per participant.
 *
 * The one thing it needs that this harness has to supply is a STABLE `playerIndex`. Position
 * in the participant list is not stable (slots fill and vacate, grifters arrive and leave), so
 * the index is derived from the participant's own id instead — `buildingId` for a role-holder,
 * `grifter-N` for a grifter, both stable for that participant's whole life.
 */
export function stablePlayerIndex(playerId: string): number {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) hash = (Math.imul(hash, 31) + playerId.charCodeAt(i)) >>> 0;
  return hash;
}

interface Participant {
  playerId: string;
  role: DriverRole;
  atBuildingId: string | null;
  atPlot: { x: number; y: number };
  slotIsVacant: boolean;
}

/**
 * Everyone a driver can speak for. Every participant's `atPlot` is now their OWN position —
 * role-holders read `x`/`y` off their slot (2026-08-19) rather than being looked up at their
 * building, grifters off their `GrifterSlot`. No stand-ins left anywhere in this function.
 *
 * `atBuildingId` still means "which slot this participant holds," not "where they are
 * standing" — the two genuinely came apart with this change, and the driver-visible state
 * keeps both because a driver plausibly knows its own workplace as well as its own feet.
 */
export function participantsOf(world: World): Participant[] {
  const out: Participant[] = [];

  const addRole = (slots: readonly { buildingId: string; slot: { state: string }; x: number; y: number }[], role: DriverRole) => {
    for (const s of slots) {
      if (s.slot.state !== 'FILLED') continue;
      out.push({ playerId: s.buildingId, role, atBuildingId: s.buildingId, atPlot: { x: s.x, y: s.y }, slotIsVacant: false });
    }
  };
  addRole(world.millers, 'miller');
  addRole(world.bakers, 'baker');

  // 2026-08-19: grifters now carry a real World.GrifterSlot.x/y (see world.ts), so their
  // driver-visible position is their own — no more standing in with the district plaza.
  for (const g of world.grifters) {
    out.push({ playerId: g.id, role: 'gossip', atBuildingId: null, atPlot: { x: g.x, y: g.y }, slotIsVacant: false });
  }

  return out;
}

/**
 * Builds the bounded, mechanically-observable view a driver is allowed to see. Nothing here
 * is privileged: counts and prices a real player could plausibly perceive, never another
 * player's private state or an exact detection probability. See `drivers/types.ts`.
 */
function visibleStateFor(world: World, p: Participant, radius: number): DriverVisibleState {
  const buildings = world.shard.districts.flatMap((d) => d.buildings);
  const occupied = new Set<string>();
  for (const s of [...world.millers, ...world.bakers, ...world.couriers, ...world.investigators, ...world.importExporters]) {
    if (s.slot.state === 'FILLED') occupied.add(s.buildingId);
  }
  const nearby = buildings.filter((b) => b.id !== p.atBuildingId && distance(p.atPlot, b) <= radius);

  return {
    tick: world.tick,
    playerId: p.playerId,
    role: p.role,
    atBuildingId: p.atBuildingId,
    atPlot: p.atPlot,
    slotIsVacant: p.slotIsVacant,
    flourPrice: world.flourPrice,
    economicHealth: world.economicHealth,
    nearbyOccupantCount: nearby.filter((b) => occupied.has(b.id)).length,
    visibleBuildingIds: nearby.map((b) => b.id),
  };
}

export interface DriverTickResult {
  /** A copy of `world` with this tick's driver output queued. Never mutates the input. */
  world: World;
  /** Every action every driver returned, including the ones deliberately not applied — so the
   *  harness can report honestly on what the population TRIED to do, not just what landed. */
  actions: { playerId: string; strategy: DriverStrategy; action: DriverAction }[];
}

/**
 * One driver pass. Call BEFORE `stepWorld`, so the posts this queues are consumed by the very
 * next tick — same queue-in/consume-and-clear contract `pendingWallPosts` already has.
 *
 * Takes its own `rng` rather than reaching for `world.rng`: the world's generator is part of
 * the simulation's determinism contract, and drawing from it here would shift every downstream
 * tick's trajectory — exactly the breakage inserting the Oracle's stage caused. A separate
 * stream keeps DRIVER DECISIONS from perturbing the world's own sequence.
 *
 * IT DOES NOT, HOWEVER, MAKE A DRIVEN RUN COMPARABLE TO A DRIVERLESS ONE — measured directly,
 * not assumed. `stepWorld`'s rumour stage draws from `world.rng` once per post per neighbour,
 * so queuing posts at all shifts the world's own trajectory from that tick on. At seed 7,
 * day 220: driverless reads Gini 0.662 with 8/9 Millers held; driven reads 0.705 with 6/9.
 * That divergence is inherent to there being activity at all, not a defect here — but it means
 * this harness is for FEEL, and its numbers must never be quoted as simulation results. The
 * measurement harnesses (`oracleCli`, `evictionProtectionCli`, and the rest) remain the place
 * numbers come from.
 */
/** Real bounds of every generated plot in the shard, hub included. Movement clamps to this —
 *  an unclamped random walk is recurrent but unbounded, and over enough ticks would wander a
 *  grifter arbitrarily far from the settlement it's meant to be part of. Same clamping
 *  discipline `playtestRenderer.ts`'s inspection cursor already uses, computed independently
 *  here rather than imported from it: the applier stays self-contained, the renderer stays a
 *  pure consumer of `World`, neither depends on the other. */
function shardPlotBounds(shard: World['shard']): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = shard.hubPlot.x;
  let maxX = shard.hubPlot.x;
  let minY = shard.hubPlot.y;
  let maxY = shard.hubPlot.y;
  for (const d of shard.districts) {
    for (const p of d.plots) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, maxX, minY, maxY };
}

export interface ApplyDriverTickOptions {
  /**
   * 2026-08-22: when true, each agent gets its own sampled-once disposition within its
   * strategy (`drivers/heterogeneity.ts`) instead of every agent of a type sharing one literal
   * set of constants. Defaults to false so every EXISTING caller (`playtestCli.ts`,
   * `webExportCli.ts`, and every test in this file's own regression suite) sees zero behaviour
   * change unless it explicitly opts in — this is a measured, isolated variable, not a silent
   * default flip. See `docs/DEVLOG.md`'s 2026-08-22 entry for the measurement this enabled.
   */
  heterogeneous?: boolean;
}

export function applyDriverTick(
  world: World,
  rng: () => number,
  options: ApplyDriverTickOptions = {},
): DriverTickResult {
  const radius = world.config.witnessRadius;
  const actions: DriverTickResult['actions'] = [];
  const posts: WallPost[] = [];
  const bounds = shardPlotBounds(world.shard);
  const clamp = (x: number, y: number) => ({
    x: Math.max(bounds.minX, Math.min(bounds.maxX, x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, y)),
  });
  // 2026-08-19: everyone can now really move. Grifters keyed by grifter id, role-holders by
  // their slot's buildingId (which is what `participantsOf` uses as their playerId).
  const grifterMoves = new Map<string, { x: number; y: number }>();
  const roleMoves = new Map<string, { x: number; y: number }>();

  for (const p of participantsOf(world)) {
    const strategy: DriverStrategy = assignDriverStrategy(world.seed, stablePlayerIndex(p.playerId));
    const driver = options.heterogeneous
      ? driverForPlayer(world.seed, stablePlayerIndex(p.playerId), strategy)
      : DRIVERS[strategy];
    const action = driver(visibleStateFor(world, p, radius), rng);
    actions.push({ playerId: p.playerId, strategy, action });

    if (action.type === 'postToWall') {
      posts.push({ id: `drv-${world.tick}-${posts.length}`, authorId: p.playerId, state: action.state, day: world.tick });
    } else if (action.type === 'move') {
      const to = clamp(action.toX, action.toY);
      if (p.role === 'gossip') grifterMoves.set(p.playerId, to);
      else roleMoves.set(p.playerId, to);
    }
  }

  // Only FILLED slots ever produced a participant, so an entry here can never resurrect a
  // position on an empty slot — a VACANT/BACKSTOPPED slot has nobody to move.
  const moveRoleSlots = <T extends { buildingId: string; x: number; y: number }>(slots: T[]): T[] =>
    roleMoves.size === 0
      ? slots
      : slots.map((s) => {
          const moved = roleMoves.get(s.buildingId);
          return moved ? { ...s, x: moved.x, y: moved.y } : s;
        });

  // Only role-holders have a position in the proximity graph `stepWorld` propagates rumours
  // through, so a grifter's post is queued and consumed but reaches nobody. Kept rather than
  // filtered: it still feeds the author's own pressure record (`pressureDetection.ts` tracks
  // POSTING behaviour, explicitly regardless of who heard it), which is real signal.
  return {
    world: {
      ...world,
      pendingWallPosts: [...world.pendingWallPosts, ...posts],
      grifters: grifterMoves.size === 0 ? world.grifters : world.grifters.map((g) => {
        const moved = grifterMoves.get(g.id);
        return moved ? { ...g, x: moved.x, y: moved.y } : g;
      }),
      // Only miller/baker have a DriverRole at all (see the header's last note), so the four
      // support roles are passed through untouched rather than mapped for nothing.
      millers: moveRoleSlots(world.millers),
      bakers: moveRoleSlots(world.bakers),
    },
    actions,
  };
}

/** Counts of what the population attempted this tick, for the harness's own reporting. */
export function summarizeActions(actions: DriverTickResult['actions']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of actions) out[a.action.type] = (out[a.action.type] ?? 0) + 1;
  return out;
}
