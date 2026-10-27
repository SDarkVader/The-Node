/** Offline destination planning adapter for the existing Society v4 walking contract.
 * This module DOES NOT widen the v4 action schema or execute a long-range/teleport move.
 * It consumes only the agent's explicitly authorised visible district map, and
 * each emitted step must still belong to the current one-step legal move menu.
 * The controller may later queue these steps without purchasing a new model decision.
 */
import type { SocietyVisibleContext } from './boundary.js';

export interface MovementPoint { x: number; y: number }
export interface DestinationMovementPlan {
  observerRef: string;
  role: string;
  district: string;
  start: MovementPoint;
  destination: MovementPoint;
  /** Adjacent coordinates to traverse, excluding start, including destination. */
  steps: readonly MovementPoint[];
}

export class MovementContractError extends Error {
  constructor(code: string) { super(code); this.name = 'MovementContractError'; }
}
const key = (p: MovementPoint) => `${p.x},${p.y}`;
const valid = (p: unknown): p is MovementPoint => {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return false;
  const o = p as Record<string, unknown>;
  return Object.keys(o).length === 2 && Object.hasOwn(o, 'x') && Object.hasOwn(o, 'y') &&
    Number.isSafeInteger(o.x) && Number.isSafeInteger(o.y);
};
const same = (a: MovementPoint, b: MovementPoint) => a.x === b.x && a.y === b.y;
const adjacent = (a: MovementPoint, b: MovementPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
const copy = (p: MovementPoint): MovementPoint => ({ x: p.x, y: p.y });
function seal(plan: DestinationMovementPlan): DestinationMovementPlan {
  Object.freeze(plan.start); Object.freeze(plan.destination);
  for (const p of plan.steps) Object.freeze(p);
  Object.freeze(plan.steps);
  return Object.freeze(plan);
}

/** Stable BFS in (x,y) lexicographic neighbour order. No World, private occupancy,
 * undisclosed building identities, hidden state, or RNG is consulted. The mapped
 * plot kinds are all traversable because the existing v4 kernel treats them equally.
 * Interdistrict routing is NOT enabled by this slice. */
export function planVisibleDestination(view: SocietyVisibleContext, destination: unknown): DestinationMovementPlan {
  if (view.phase !== 'act') throw new MovementContractError('movement_wrong_phase');
  if (!valid(destination)) throw new MovementContractError('movement_invalid_destination');
  const start = { x: view.self.x, y: view.self.y };
  if (!valid(start)) throw new MovementContractError('movement_invalid_origin');
  const plots = new Set(view.local.places.map(key));
  if (!plots.has(key(start))) throw new MovementContractError('movement_origin_not_mapped');
  if (!plots.has(key(destination))) throw new MovementContractError('movement_destination_not_visible');

  const queue: MovementPoint[] = [start];
  const parents = new Map<string, string | null>([[key(start), null]]);
  const coordinates = new Map<string, MovementPoint>([[key(start), start]]);
  for (let n = 0; n < queue.length && !parents.has(key(destination)); n++) {
    const p = queue[n]!;
    const neighbors = [
      { x: p.x - 1, y: p.y }, { x: p.x, y: p.y - 1 },
      { x: p.x, y: p.y + 1 }, { x: p.x + 1, y: p.y },
    ];
    for (const q of neighbors) {
      const k = key(q);
      if (!plots.has(k) || parents.has(k)) continue;
      parents.set(k, key(p));
      coordinates.set(k, q);
      queue.push(q);
    }
  }
  if (!parents.has(key(destination))) throw new MovementContractError('movement_destination_unreachable');
  const steps: MovementPoint[] = [];
  for (let k: string | null = key(destination); k !== key(start); k = parents.get(k) ?? null) {
    if (k === null) throw new MovementContractError('movement_route_corrupt');
    steps.push(copy(coordinates.get(k)!));
  }
  steps.reverse();
  if (steps.length && !view.legalChoices.moves.some(q => same(q, steps[0]!))) {
    throw new MovementContractError('movement_initial_step_not_legal');
  }
  return seal({ observerRef: view.self.ref, role: view.self.role, district: view.local.district,
    start, destination: copy(destination), steps });
}

/** Each mechanical move re-checks CURRENT authorized context. No skipping path
 * coordinates, no continuing after displacement/role change, no crossing a new
 * forbidden edge and no movement during the commitment phase. */
export function nextAuthorizedMovementStep(
  plan: DestinationMovementPlan, index: number, view: SocietyVisibleContext,
): MovementPoint | null {
  if (!Number.isSafeInteger(index) || index < 0 || index > plan.steps.length) {
    throw new MovementContractError('movement_invalid_cursor');
  }
  if (view.phase !== 'act' || view.self.ref !== plan.observerRef || view.self.role !== plan.role ||
      view.local.district !== plan.district) throw new MovementContractError('movement_context_changed');
  const expected = index === 0 ? plan.start : plan.steps[index - 1]!;
  if (!same(view.self, expected)) throw new MovementContractError('movement_position_diverged');
  if (index === plan.steps.length) return null;
  const next = plan.steps[index]!;
  if (!adjacent(expected, next) || !view.legalChoices.moves.some(q => same(q, next))) {
    throw new MovementContractError('movement_step_no_longer_legal');
  }
  return copy(next);
}
