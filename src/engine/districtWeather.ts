/**
 * District Weather (2026-08-11, Design Addendum item 0/3 — flagged "fix first"). Wires
 * `space.ts`'s `District.weatherHistory: WeatherSample[]` field, which has existed since
 * Phase A but nothing ever wrote to: `world.ts` never touched it, and the string `tension`
 * did not appear in `world.ts` at all. The slot was already built — this is the wiring, not
 * a new mechanic, and it is a prerequisite for item 3's Wall Emissive Soul work, which is
 * blocked on the same field.
 *
 * `tension` (0 cool/calm .. 1 warm/tense) is a deterministic function of events `world.ts`
 * already produces every tick — no invented mood variable, per the addendum's explicit
 * instruction:
 *   - vacancy pressure: how understaffed the district is right now (`1 - filledFraction`,
 *     the exact same fraction `districtConsolidation.ts` already computes for the same
 *     district on the same tick — not a second measurement of the same thing).
 *   - consolidation pressure: the district's own `DistrictHealth.state`. CONSOLIDATING or
 *     MERGED is an ongoing structural condition, not a one-off event, so it contributes
 *     regardless of today's churn.
 *   - sabotage spike: 1 if a sabotage attempt targeted a building in this district on THIS
 *     tick, else 0. Same-day only — the accumulated history lives in `weatherHistory`
 *     itself; `localDistrictTension` only supplies today's raw local reading.
 *
 * Decays with distance using `space.ts`'s own `distance()` (plaza-to-plaza) and
 * `proximityCloseness()` — the general-purpose distance-to-closeness conversion that module
 * already documents as "the real number... in place of an arbitrary hardcoded number" for
 * exactly this kind of consumer. No second decay system is built here. A district's felt
 * tension is the STRONGEST signal reaching it from any source district (including itself,
 * at distance 0 → closeness 1) — a max, not a sum, so one very tense neighbour reads as
 * "trouble nearby," not an implausible shard-wide aggregate spike.
 */

import { distance, proximityCloseness, type Shard, type WeatherSample } from './space.js';
import type { DistrictConsolidationStateName } from './districtConsolidation.js';

/** Weight given to raw understaffing when composing a district's own local tension. [ILLUSTRATIVE] */
export const WEATHER_VACANCY_WEIGHT = 0.4;
/** Weight given to consolidation pressure. [ILLUSTRATIVE] */
export const WEATHER_CONSOLIDATION_WEIGHT = 0.4;
/** Weight given to a same-day sabotage spike — the single sharpest, most legible event, so
 *  it outweighs either ambient signal on its own. [ILLUSTRATIVE] */
export const WEATHER_SABOTAGE_WEIGHT = 0.6;

/** How far tension is felt beyond its source district, in space.ts's grid units. [ILLUSTRATIVE] */
export const WEATHER_DECAY_MAX_RANGE = 40;

/** Bounded history, per the addendum's explicit instruction ("keep history bounded"). */
export const WEATHER_HISTORY_MAX_SAMPLES = 90;

function consolidationPressure(state: DistrictConsolidationStateName): number {
  if (state === 'MERGED') return 1;
  if (state === 'CONSOLIDATING') return 0.7;
  return 0;
}

/**
 * A district's own local tension reading, before it spreads to its neighbours. The three
 * weighted contributions can sum past 1 (e.g. an empty, CONSOLIDATING district hit by
 * sabotage the same day) — clamped to [0,1], the range `tension` is documented to mean.
 */
export function localDistrictTension(
  filledFraction: number,
  healthState: DistrictConsolidationStateName,
  sabotagedToday: boolean,
): number {
  const vacancy = Math.max(0, Math.min(1, 1 - filledFraction));
  const raw =
    vacancy * WEATHER_VACANCY_WEIGHT +
    consolidationPressure(healthState) * WEATHER_CONSOLIDATION_WEIGHT +
    (sabotagedToday ? WEATHER_SABOTAGE_WEIGHT : 0);
  return Math.max(0, Math.min(1, raw));
}

/**
 * Spreads every district's local reading to every district in the shard by distance,
 * taking the strongest signal reaching each destination (see header for why max, not sum).
 * `localTensions` should have one entry per `shard.districts` id — a missing entry reads
 * as 0, the same as an explicit 0, so a partial map degrades safely.
 */
export function districtTensionField(
  shard: Shard,
  localTensions: Readonly<Record<string, number>>,
  maxRange: number = WEATHER_DECAY_MAX_RANGE,
): Record<string, number> {
  const field: Record<string, number> = {};
  for (const dest of shard.districts) {
    let strongest = 0;
    for (const source of shard.districts) {
      const local = localTensions[source.id] ?? 0;
      if (local <= 0) continue;
      const closeness = proximityCloseness(distance(dest.plazaPlot, source.plazaPlot), maxRange);
      if (closeness === null) continue; // beyond maxRange — no proximity-based closeness at all
      const felt = local * closeness;
      if (felt > strongest) strongest = felt;
    }
    field[dest.id] = strongest;
  }
  return field;
}

/**
 * Appends today's `WeatherSample` to every district, returning a new `Shard` — same
 * immutable-update convention every other `space.ts` function follows. Each district's
 * `weatherHistory` is bounded to the most recent `maxSamples` entries.
 */
export function stepDistrictWeather(
  shard: Shard,
  tensionField: Readonly<Record<string, number>>,
  tick: number,
  maxSamples: number = WEATHER_HISTORY_MAX_SAMPLES,
): Shard {
  return {
    ...shard,
    districts: shard.districts.map((d) => {
      const sample: WeatherSample = { tick, tension: tensionField[d.id] ?? 0 };
      const history = [...d.weatherHistory, sample];
      return {
        ...d,
        weatherHistory: history.length > maxSamples ? history.slice(history.length - maxSamples) : history,
      };
    }),
  };
}
