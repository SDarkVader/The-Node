/**
 * Observatory access scopes. A local, bearer-token scheme for a loopback listener:
 *   - researcher: every read route, the display cursor and annotation writes;
 *   - renderer: public world frames and the Godot stream only.
 * This is not a deployment auth system. Exposing the observatory beyond loopback needs its own
 * reviewed transport and authentication (handover: "Researcher access and any remote deployment
 * need their own tested authentication/transport choices").
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type Scope = 'researcher' | 'renderer';
export interface Tokens { researcher: string; renderer: string }

export function newTokens(): Tokens {
  return { researcher: randomBytes(24).toString('base64url'), renderer: randomBytes(24).toString('base64url') };
}
const h = (s: string) => createHash('sha256').update(s).digest();
export function scopeOf(tokens: Tokens, presented: string | null | undefined): Scope | null {
  if (!presented) return null;
  const p = h(presented);
  if (timingSafeEqual(p, h(tokens.researcher))) return 'researcher';
  if (timingSafeEqual(p, h(tokens.renderer))) return 'renderer';
  return null;
}
