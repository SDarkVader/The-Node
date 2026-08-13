import type { PlayerId } from './player.js';
import { isKnown } from './player.js';
import { addEntry, createPrivateStore, getAlive, type PrivateStore } from './privateStore.js';
import { applyDistortion } from '../comms/decay.js';

/**
 * The private diary (`docs/DESIGN_ADDENDUM_2026-08-06.md`, mechanic locked, retention
 * corrected 2026-08-13). Composed, not typed — same family as `SELF_STATES`
 * (`comms/grammar.ts`) and the rumour mill's `DISTORTION_NEIGHBORS`
 * (`comms/rumourMill.ts`): an entry is assembled from curated slots, never free text.
 *
 * Storage/expiry/distortion mechanics live in `privateStore.ts`, deliberately generic;
 * this file only supplies the diary's specific slot shape and the distort function that
 * plugs into `getAlive`'s optional hook.
 */

export const OBSERVATIONS = [
  // Trade
  'undercutMyPrice',
  'matchedMyPrice',
  'overpaidWithoutNeedingTo',
  'haggledHard',
  'refusedToTrade',
  'offeredFirstUnprompted',
  'paidLate',
  'disputedAFairDeal',
  // Information
  'warnedMeAboutSomeone',
  'sharedARumourFreely',
  'keptAConfidence',
  'letAConfidenceSlip',
  'correctedAFalseRumourAboutMe',
  'letOneStand',
  'introducedMeToSomeone',
  'keptMeOutOfSomething',
  // Crisis
  'coveredAVacancyUnasked',
  'disappearedDuringOne',
  'showedUpWhenItMattered',
  'wasNowhereToBeFound',
  'keptAPromise',
  'brokeOne',
  // Presence
  'soughtMeOut',
  'avoidedMe',
  'stayedGuarded',
  'openedUpUnprompted',
  'confrontedMeDirectly',
  'deflectedWhenConfronted',
] as const;

export type Observation = (typeof OBSERVATIONS)[number];

/**
 * Plausible-adjacent drift targets, kept within the same category (§ "OBSERVATION" in the
 * addendum groups the table into Trade/Information/Crisis/Presence) — same
 * semantically-adjacent-not-pure-noise discipline as the rumour mill's neighbor table.
 * [CALIBRATED — provisional] illustrative, not tuned.
 */
export const OBSERVATION_NEIGHBORS: Record<Observation, readonly Observation[]> = {
  undercutMyPrice: ['haggledHard', 'disputedAFairDeal'],
  matchedMyPrice: ['offeredFirstUnprompted', 'overpaidWithoutNeedingTo'],
  overpaidWithoutNeedingTo: ['matchedMyPrice', 'offeredFirstUnprompted'],
  haggledHard: ['undercutMyPrice', 'disputedAFairDeal'],
  refusedToTrade: ['disputedAFairDeal', 'haggledHard'],
  offeredFirstUnprompted: ['matchedMyPrice', 'overpaidWithoutNeedingTo'],
  paidLate: ['disputedAFairDeal', 'refusedToTrade'],
  disputedAFairDeal: ['haggledHard', 'refusedToTrade'],

  warnedMeAboutSomeone: ['correctedAFalseRumourAboutMe', 'keptAConfidence'],
  sharedARumourFreely: ['letAConfidenceSlip', 'letOneStand'],
  keptAConfidence: ['warnedMeAboutSomeone', 'introducedMeToSomeone'],
  letAConfidenceSlip: ['sharedARumourFreely', 'letOneStand'],
  correctedAFalseRumourAboutMe: ['warnedMeAboutSomeone', 'keptAConfidence'],
  letOneStand: ['letAConfidenceSlip', 'keptMeOutOfSomething'],
  introducedMeToSomeone: ['keptAConfidence', 'warnedMeAboutSomeone'],
  keptMeOutOfSomething: ['letOneStand', 'letAConfidenceSlip'],

  coveredAVacancyUnasked: ['showedUpWhenItMattered', 'keptAPromise'],
  disappearedDuringOne: ['wasNowhereToBeFound', 'brokeOne'],
  showedUpWhenItMattered: ['coveredAVacancyUnasked', 'keptAPromise'],
  wasNowhereToBeFound: ['disappearedDuringOne', 'brokeOne'],
  keptAPromise: ['showedUpWhenItMattered', 'coveredAVacancyUnasked'],
  brokeOne: ['wasNowhereToBeFound', 'disappearedDuringOne'],

  soughtMeOut: ['openedUpUnprompted', 'confrontedMeDirectly'],
  avoidedMe: ['stayedGuarded', 'deflectedWhenConfronted'],
  stayedGuarded: ['avoidedMe', 'deflectedWhenConfronted'],
  openedUpUnprompted: ['soughtMeOut', 'confrontedMeDirectly'],
  confrontedMeDirectly: ['soughtMeOut', 'openedUpUnprompted'],
  deflectedWhenConfronted: ['avoidedMe', 'stayedGuarded'],
};

/** Deliberately small and blunt, by contrast with OBSERVATION — the biased slot, allowed to age badly. */
export const READINGS = [
  'seemsTrustworthy',
  'seemsOpportunistic',
  'seemsScared',
  'seemsCalculating',
  'cantTellYet',
] as const;

export type Reading = (typeof READINGS)[number];

/** [CALIBRATED — provisional] illustrative, not tuned. */
export const READING_NEIGHBORS: Record<Reading, readonly Reading[]> = {
  seemsTrustworthy: ['cantTellYet'],
  seemsOpportunistic: ['seemsCalculating', 'cantTellYet'],
  seemsScared: ['cantTellYet', 'seemsOpportunistic'],
  seemsCalculating: ['seemsOpportunistic', 'cantTellYet'],
  cantTellYet: ['seemsTrustworthy', 'seemsScared'],
};

/** Illustrative starting set, grouped with proximity conversation's own CONTEXT tag — not final. */
export const CONTEXT_TAGS = ['trade', 'wallPost', 'rumourHeard', 'crisisCover'] as const;

export type ContextTag = (typeof CONTEXT_TAGS)[number];

export interface DiaryEntry {
  /** A specific *known* player — never distorts; identity resolution stays reliable (constraint 4). */
  subject: PlayerId;
  observation: Observation;
  reading: Reading;
  /** Optional; a pointer to a real event, never distorts for the same reason SUBJECT doesn't. */
  context?: ContextTag;
}

/** [CALIBRATED — provisional] chance per surviving server day-tick that OBSERVATION or READING drifts. */
export const DIARY_DISTORTION_RATE_PER_DAY = 0.2;

/** [CALIBRATED — provisional, corrected 2026-08-13, was ~30] "yesterday's" worth of memory. */
export const DIARY_RETENTION_DAYS = 2;

/**
 * The distort hook `privateStore.ts`'s `getAlive` expects: SUBJECT and CONTEXT pass through
 * untouched, OBSERVATION and READING each get one independent `applyDistortion` roll.
 */
export function distortDiaryEntry(entry: DiaryEntry, rng: () => number): DiaryEntry {
  const { value: observation } = applyDistortion(
    entry.observation,
    { distortionRate: DIARY_DISTORTION_RATE_PER_DAY, neighbors: OBSERVATION_NEIGHBORS },
    rng,
  );
  const { value: reading } = applyDistortion(
    entry.reading,
    { distortionRate: DIARY_DISTORTION_RATE_PER_DAY, neighbors: READING_NEIGHBORS },
    rng,
  );
  return { ...entry, observation, reading };
}

export function createDiaryStore(): PrivateStore<DiaryEntry> {
  return createPrivateStore<DiaryEntry>();
}

/**
 * Writing is always unprompted (the game never nudges a player to write) and always honest
 * (no write-time distortion — the player always knows what they meant when they wrote it).
 * Throws if SUBJECT isn't resolved for the author, matching fog-of-recognition (§4.2): a
 * diary entry about a stranger's silhouette is not a thing that can exist. Also throws on a
 * self-entry — the diary is explicitly "a private space to process a feeling about ANOTHER
 * player," matching `sendEnvelope`'s existing no-self-target check.
 */
export function writeDiaryEntry(
  store: PrivateStore<DiaryEntry>,
  authorId: PlayerId,
  subject: PlayerId,
  observation: Observation,
  reading: Reading,
  day: number,
  knownByAuthor: ReadonlySet<PlayerId>,
  context?: ContextTag,
): void {
  if (subject === authorId) {
    throw new Error('cannot write a diary entry about yourself');
  }
  if (isKnown(subject, knownByAuthor) !== 'known') {
    throw new Error('cannot write a diary entry about an unresolved subject');
  }
  addEntry(store, authorId, { subject, observation, reading, context }, day);
}

/** Still-alive entries for the owner, oldest first, each nudged toward drift per elapsed day. */
export function readDiary(
  store: PrivateStore<DiaryEntry>,
  ownerId: PlayerId,
  day: number,
  rng: () => number,
): DiaryEntry[] {
  return getAlive(store, ownerId, day, DIARY_RETENTION_DAYS, distortDiaryEntry, rng);
}
