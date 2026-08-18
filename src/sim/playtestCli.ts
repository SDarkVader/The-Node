import { createWorld, stepWorld, DEFAULT_WORLD_CONFIG, type World } from '../world/world.js';
import { renderFrame, collectEvents } from './playtestRenderer.js';
import { applyDriverTick, summarizeActions } from './playtestDrivers.js';
import { mulberry32 } from './rng.js';

/**
 * `npm run playtest` — Phase A of `docs/DESIGN_PLAYTEST_HARNESS_2026-08-18.md`. The first
 * thing in this repo you can actually watch rather than measure.
 *
 * Deliberately thin: every decision about what a frame LOOKS like lives in the pure
 * `playtestRenderer.ts`, and everything about what the inhabitants DO lives in
 * `playtestDrivers.ts`. This file owns only the terminal (raw-mode stdin, the alternate
 * screen buffer, the key handling) and the loop, which is why neither of those two needed a
 * terminal to be testable.
 *
 * Turn-based, not animated: `stepWorld` is a daily tick, so the harness repaints on state
 * change rather than on a frame clock.
 *
 *   space  advance one day        n  advance ten days
 *   d      toggle the drivers     q  quit
 */

const SEED = Number(process.argv[2] ?? 7);
const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const HOME = '\x1b[H\x1b[2J';

// Honest colour detection — NO_COLOR is the de-facto standard opt-out, and a non-TTY (piped
// output) has nobody to show colour to.
const useColour = !process.env.NO_COLOR && process.stdout.isTTY === true;

let world: World = createWorld(SEED, DEFAULT_WORLD_CONFIG);
// A driver stream separate from `world.rng`: drawing from the world's own generator would
// shift its trajectory, which is exactly the class of breakage inserting a new rng-consuming
// stage has caused here before. See `playtestDrivers.ts`.
const driverRng = mulberry32(SEED ^ 0x5eed);
const eventLog: string[] = [];
let driversOn = true;
let lastActions: Record<string, number> = {};

function advance(days: number): void {
  for (let i = 0; i < days; i++) {
    if (driversOn) {
      const result = applyDriverTick(world, driverRng);
      world = result.world;
      lastActions = summarizeActions(result.actions);
    }
    world = stepWorld(world);
    eventLog.push(...collectEvents(world));
  }
}

function paint(): void {
  const width = process.stdout.columns ?? 80;
  const frame = renderFrame(world, { color: useColour, width, eventLog });
  const driverLine = driversOn
    ? `drivers ON  ${Object.entries(lastActions).map(([k, v]) => `${k}:${v}`).join('  ') || '(no actions yet)'}`
    : 'drivers OFF — the node only churns';
  process.stdout.write(`${HOME}${frame}\n${driverLine}\n[space] day  [n] x10  [d] drivers  [q] quit\n`);
}

function shutdown(): void {
  process.stdout.write(SHOW_CURSOR + LEAVE_ALT);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.exit(0);
}

if (!process.stdin.isTTY) {
  // Piped or redirected: there is no interactive session to run, so render one frame of a
  // settled world and exit rather than hanging on input that will never arrive.
  advance(220);
  process.stdout.write(renderFrame(world, { color: useColour, width: process.stdout.columns ?? 100, eventLog }) + '\n');
  process.exit(0);
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write(ENTER_ALT + HIDE_CURSOR);
paint();

process.stdin.on('data', (buf: Buffer) => {
  const key = buf.toString();
  if (key === 'q' || key === '\x03') return shutdown(); // ^C included: raw mode swallows the usual SIGINT
  if (key === ' ') advance(1);
  else if (key === 'n') advance(10);
  else if (key === 'd') driversOn = !driversOn;
  else return;
  paint();
});

process.on('SIGTERM', shutdown);
