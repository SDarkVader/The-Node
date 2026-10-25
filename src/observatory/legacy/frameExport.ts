/**
 * A9 — frame export for a browser replay (observatory handover, 2026-10-23).
 *
 * Writes the verified public frame sequence (the Godot hello plus one tick per committed frame,
 * with observatory metadata) as a static file. It is labelled `replay`: an exported file is a
 * capture of evidence that existed when it was written, never a live view, and it contains no
 * movement between committed frames.
 */
import { randomBytes } from 'node:crypto';
import type { WorldProjection } from './worldProjection.js';
import { frameMetadata } from './worldProjection.js';

export const FRAMES_SCHEMA = 'node-observatory-frames-v1' as const;

export function exportFrames(projection: WorldProjection, exportedAt = new Date()) {
  const secret = randomBytes(16).toString('hex'); // pseudonyms are per export, as per connection
  const last = projection.latestTick();
  return {
    schema: FRAMES_SCHEMA, mode: 'replay' as const, exportedAt: exportedAt.toISOString(),
    experimentId: projection.experiment.registration.experimentId, synthetic: projection.experiment.registration.synthetic === true,
    note: 'Captured from verified evidence at export time. Not live. Frames are committed ticks only; nothing between them is interpolated as fact.',
    hello: { ...projection.publicHello(), ...frameMetadata(projection, 0, 'replay') },
    frames: Array.from({ length: last + 1 }, (_, tick) => ({ ...projection.publicTick(tick, secret), ...frameMetadata(projection, tick, 'replay') })),
  };
}
