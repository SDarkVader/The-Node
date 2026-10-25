import { createHmac } from 'node:crypto';
import type { ParticipantState } from '../agent/participantWorld.js';
import { personBody } from '../server/observer.js';
import { helloMessage, tickMessage, type WireRole } from '../server/worldProtocol.js';

const roles: Record<string, WireRole> = { Miller: 'miller', Baker: 'baker', Courier: 'courier', Investigator: 'investigator', ImportExport: 'importExport' };
/** Preserve the PERSON across role/body changes. Slot-based worldProtocol handles are
 * appropriate for its standalone world, but would swap identities in a participant world. */
export function projectWorld(state: ParticipantState, connectionSecret: string) {
  const frame = tickMessage(state.world, connectionSecret);
  frame.people = [...state.registry.people.values()].filter(p => p.location !== null).map(p => {
    const body = personBody(state, p);
    return { handle: 'p' + createHmac('sha256', connectionSecret).update(p.id).digest('hex').slice(0, 24),
      x: body.x, y: body.y, role: roles[body.role] ?? null };
  });
  return { hello: helloMessage(state.world), frame };
}
