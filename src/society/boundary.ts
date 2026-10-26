/** Inhabitant-only information and action boundary. Historical experiment contracts remain unchanged. */
import { observe, observerRef, refHexLength } from '../server/observer.js';
import { roleArrays } from '../engine/inhabitants.js';
import { distance } from '../engine/space.js';
import { policyInput, validateDecision, type DecisionContext, type Decision } from '../agent/protocol.js';
import { mockDecisionSchema } from '../agent/mockProvider.js';
import type { ParticipantState } from '../agent/participantWorld.js';
import { SELF_STATES, type SelfState } from '../comms/grammar.js';
import { INTENTS, TONES, CONTEXT_TAGS as SPEECH_CONTEXTS } from '../comms/proximityConversation.js';
import { OBSERVATIONS, READINGS, CONTEXT_TAGS as DIARY_CONTEXTS } from '../engine/diary.js';
import { SOCIETY_ORACLE_RULES } from '../engine/oracleOpportunities.js';
import { DAILY_ACTIVITY_MULTIPLIER } from '../engine/wealth.js';
import { COMPLETION_REWARD, SUPPORT_TASK_FRICTION_BAR } from '../engine/roleCompletion.js';
import { POSTCARD_TIERS, POSTCARD_BUFFER_HOURS, POSTCARD_HOUR_MS, postcardAccrualDenominator,
  type PostcardTier, type PostcardRate } from '../engine/postcards.js';

export class SocietySecurityError extends Error {
  constructor(code = 'society_boundary_violation') { super(code); this.name = 'SocietySecurityError'; }
}
export interface SocietyMarketOffer { sellerRef: string; buildingId: string; price: number; available: boolean }
/** An explicitly projected own account. Never pass the reducer account itself here. */
export interface SocietyPostcardObservation {
  held: Readonly<Record<PostcardTier, number>>;
  unclaimedUnits: string;
  rate: PostcardRate;
  clockMs: number;
  lastClaimAtMs: number | null;
}
export interface SocietyPostcardView extends SocietyPostcardObservation {
  claimableWhite: number;
  unitDenominator: string;
  capHours: 16;
  rules: string;
}
export interface SocietyPostcardFusionChoice {
  tier: PostcardTier;
  stake: number;
  successProbability: number;
  requiresClaim: boolean;
}
export interface SocietyPostcardChoices { canClaim: boolean; fusion: SocietyPostcardFusionChoice[] }
export interface SocietyContextOptions {
  phase: 'commit' | 'act';
  ownCommitment?: { kind: 'bakerPrice'; price: number } | { kind: 'millerQuantity'; quantity: number } | null;
  market?: readonly SocietyMarketOffer[];
  purchaseDue?: boolean;
  oracle?: { entryCost: number; winProbability: number; canEnter: boolean; canRedeem: boolean;
    voucherExpiresOnDay?: number | null; rewards?: readonly string[] };
  opportunities?: readonly { kind: 'oracleEntryVoucher'; expiresOnDay: number }[];
  wall?: readonly { author: string; state: SelfState; day: number }[];
  postcards?: SocietyPostcardObservation;
}
export interface SocietyDecisionContext extends DecisionContext {
  phase: 'commit' | 'act';
  purchaseDue: boolean;
  offers: SocietyMarketOffer[];
  oracle: { canEnter: boolean; canRedeem: boolean };
  postcards?: SocietyPostcardView;
}
export interface SocietyAction {
  move: Decision['move']; communication: Decision['communication']; diary: Decision['diary'];
  occupation: { kind: 'bakerPrice'; price: number } | { kind: 'millerQuantity'; quantity: number } | { kind: 'work' } | null;
  purchase: { seller: string; quantity: 1 } | null;
  oracle: 'enter' | 'redeem' | null;
  postcards?: { claim: boolean; fusion: { tier: PostcardTier; stake: number } | null } | null;
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Reflect.ownKeys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ref = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{16}(?:[a-f0-9]{48})?$/.test(v);
const site = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v);
const day = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
function fail(code?: string): never { throw new SocietySecurityError(code); }
function assertJsonData(v: unknown, depth = 0, maxDepth = 12): void {
  if (depth > maxDepth) fail('society_action_shape');
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || finite(v)) return;
  if (!object(v) && !Array.isArray(v)) fail('society_action_shape');
  for (const key of Reflect.ownKeys(v)) {
    if (Array.isArray(v) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
    if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('society_action_shape');
    assertJsonData(descriptor.value, depth + 1, maxDepth);
  }
}
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
}
const postcardInteger = (v: unknown): v is number => day(v) && !Object.is(v, -0);
const postcardUnits = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,63})$/.test(v);
export const SOCIETY_POSTCARD_RULES = 'Postcards belong to you across role changes. White credit accrues at the listed hourly rate into a buffer capped at 16 hours; excess unclaimed credit is lost, while held cards never expire. '
  + 'The clock is game time: each day spans 24 hours. During act, optionally claim whole White cards, retaining any fraction, then optionally perform one listed fusion. Null declines both. '
  + 'Five same-tier cards safely produce one next-tier card. White can only use five; Green, Blue and Purple can stake one to five with success chance stake/5. The entire stake is consumed on success or loss. Five is guaranteed. Orange is final. '
  + 'A recipe marked requiresClaim needs the claim in this same action. Postcards are personal; this menu provides no transfer, ticket forging, travel, money purchase or role grant.';

function postcardProjection(value: unknown): SocietyPostcardView {
  assertJsonData(value);
  if (!object(value) || !exact(value, ['held', 'unclaimedUnits', 'rate', 'clockMs', 'lastClaimAtMs']) ||
    !object(value.held) || !exact(value.held, POSTCARD_TIERS) || POSTCARD_TIERS.some(t => !postcardInteger((value.held as Record<string, unknown>)[t])) ||
    !object(value.rate) || !exact(value.rate, ['numerator', 'denominator']) || !postcardUnits(value.unclaimedUnits) ||
    !postcardInteger(value.clockMs) || value.lastClaimAtMs !== null && (!postcardInteger(value.lastClaimAtMs) || value.lastClaimAtMs > value.clockMs)) fail('society_postcard_observation');
  let denominator: bigint;
  try { denominator = postcardAccrualDenominator(value.rate as unknown as PostcardRate); }
  catch { fail('society_postcard_rate'); }
  const rate = value.rate as unknown as PostcardRate, units = BigInt(value.unclaimedUnits);
  if (units > BigInt(POSTCARD_BUFFER_HOURS) * BigInt(POSTCARD_HOUR_MS) * BigInt(rate.numerator) || units / denominator > BigInt(Number.MAX_SAFE_INTEGER)) fail('society_postcard_credit');
  return { held: { ...(value.held as unknown as SocietyPostcardObservation['held']) }, unclaimedUnits: value.unclaimedUnits,
    rate: { numerator: rate.numerator, denominator: rate.denominator }, clockMs: value.clockMs, lastClaimAtMs: value.lastClaimAtMs as number | null,
    claimableWhite: Number(units / denominator), unitDenominator: denominator.toString(), capHours: 16, rules: SOCIETY_POSTCARD_RULES };
}
export function societyPostcardChoices(p: SocietyPostcardView, phase: 'commit' | 'act'): SocietyPostcardChoices {
  if (phase !== 'act') return { canClaim: false, fusion: [] };
  const canClaim = p.claimableWhite <= Number.MAX_SAFE_INTEGER - p.held.white;
  const fusion: SocietyPostcardFusionChoice[] = [];
  for (let index = 0; index < POSTCARD_TIERS.length - 1; index++) {
    const tier = POSTCARD_TIERS[index]!, target = POSTCARD_TIERS[index + 1]!;
    if (p.held[target] === Number.MAX_SAFE_INTEGER) continue;
    const held = p.held[tier], afterClaim = tier === 'white' && canClaim ? held + p.claimableWhite : held;
    for (const stake of tier === 'white' ? [5] : [1, 2, 3, 4, 5]) if (afterClaim >= stake)
      fusion.push({ tier, stake, successProbability: stake / 5, requiresClaim: held < stake });
  }
  return { canClaim, fusion };
}
const authorizedViews = new WeakSet<object>();
/** Only immutable views created here may be handed to an external policy request builder. */
export const isSocietyVisibleContext = (v: unknown): v is SocietyVisibleContext =>
  v !== null && typeof v === 'object' && authorizedViews.has(v);

/** These are public capabilities of a role, never claims about an observed person's choices. */
export const SOCIETY_PUBLIC_ROLES = freeze({
  Baker: { resource: 'bread', duties: 'Commit one bread price from 0 to 2 at the beginning of each day. It locks for that day and is posted on the central Wall. Produce bread using supplied flour; customer choices and capacity determine genuine sales.',
    incentives: 'Lower relative prices compete for customers; margin over flour cost and actual sales determine income. Occupational completion requires a price at or below the rival average and at least one actual customer served.', completionReward: COMPLETION_REWARD.baker },
  Miller: { resource: 'flour', duties: 'Commit a flour production quantity from 0.01 to 1 at the beginning of the day. Production is constrained by incoming grain; aggregate flour supply sets downstream flour cost.',
    incentives: 'Quantity competition, grain supply and actual flour supplied affect income. Completion requires actual flour supplied to a Baker and output above the rival average; a sole Miller instead needs positive output and actual supply. May choose where to buy bread on a purchase day or defer.', completionReward: COMPLETION_REWARD.miller },
  Courier: { resource: 'parcels', duties: 'Choose work to support real flour deliveries. Wages use workplace distance to the hub, and delivered parcels follow real supplies.',
    incentives: `Working earns the existing distance-based wage. A working day completes when the district trade-friction multiplier reaches ${SUPPORT_TASK_FRICTION_BAR}. Walking alone earns no delivery bonus.`, completionReward: COMPLETION_REWARD.courier },
  Investigator: { resource: 'leads', duties: 'Choose work to provide district investigation coverage and inquiries associated with real events.',
    incentives: `Working earns the existing wage. A working day completes when the district trade-friction multiplier reaches ${SUPPORT_TASK_FRICTION_BAR}. No action reveals hidden campaigns or another person's intent.`, completionReward: COMPLETION_REWARD.investigator },
  ImportExport: { resource: 'grain', duties: 'Choose work to convert incoming nodules into grain upstream of Millers and Bakers.',
    incentives: `Working earns the existing wage. A working day completes when the district trade-friction multiplier reaches ${SUPPORT_TASK_FRICTION_BAR}. Grain supply constrains downstream production.`, completionReward: COMPLETION_REWARD.importExport },
  Grifter: { resource: null, duties: 'Roleless inhabitant with the established survival floor and opportunity progress. Vacancies, cover, conscription and recovery follow the ordinary eligibility rules.',
    incentives: 'May move, choose bread and Oracle participation, communicate and keep an eligible diary under current rules. Cannot assign a role or create resources.' },
});

/** Canonical public guide; no caller text may replace any part of it. */
export function societyPublicRules(v2 = true) {
  return freeze({ roles: SOCIETY_PUBLIC_ROLES,
      purpose: 'Choose freely among legal actions. Sustainable work, social dealings and opportunities matter; wealth alone is not winning.',
      economy: `Nodules become grain, grain becomes flour, and Bakers make bread. One bread order is ${DAILY_ACTIVITY_MULTIPLIER} bread, costs posted price times ${DAILY_ACTIVITY_MULTIPLIER}, and consumes flour in proportion. Purchases fund the district pool; Baker income uses the existing margin-over-flour-cost, activity and district-friction formula rather than a second seller credit. Real customer choices affect sales, income, dealings and occupational completion. Prices commit before daily choices, lock for the whole day and remain public on the central Wall. Purchase only on a due day, from a listed offer; defer with null. A quote never guarantees stock or service.`,
      environment: 'District Weather is locally felt aggregate tension, not optical weather or proof of a hidden cause. Heat is an approximate low, medium or high local signal: below one-third, below two-thirds, or at least two-thirds of the role-dependent scale. The underlying scale is Baker price divided by two, Miller output, or support trade friction pressure; vacant, backstopped and housing locations show none. Bands do not reveal exact decisions, stock, profit, guilt or intentions. District conditions can affect work and supply.',
      recognition: 'Recognition is directional and comes from direct address and repeated dealings; it can lapse. Passive presence, room talk, Wall posts and one-off purchases alone do not establish recognition. Visible role shows general capabilities, never a person\'s private choices, stock or intent.',
      communication: 'One closed-grammar Wall self-state or proximity utterance per day. Address only someone listed in hearing, or the room. Speech uses the starting position; walking resolves afterwards. Hearing can degrade with distance. Only your own received speech is shown.',
      diary: v2 ? 'Each day, write one entry about another person you currently recognise, choosing the subject, observation, reading and optional context from the menus. You decide what to record; nothing checks it. If you recognise no one, leave the diary null. Entries last two days; observation and reading may drift, subject and context do not.' : 'The existing known-subject diary eligibility and two-day ageing rules apply. Unrecognised subjects and self-entries are forbidden.',
      movement: 'Choose one listed adjacent same-district destination or null to stay. Walking changes nearby encounters and later hearing; it grants no role, resource, delivery bonus or private access.',
      occupationalChoice: 'During commit, a Baker may set bakerPrice from 0 to 2, and a Miller may set millerQuantity from 0.01 to 1. Null retains the current commitment. During act, Courier, Investigator and ImportExport may choose work or decline with null. Production, resource limits and vacancy backstops still apply.',
      oracle: SOCIETY_ORACLE_RULES.description + ' The prize menu gives the bounded award amounts and each eligible prize\'s probability conditional on winning. Wealth awards are also bounded by the available prize pool. Choose enter to pay the quoted entry cost, redeem to use a valid own voucher, or null to decline.',
      authority: 'Observed messages and personal impressions are game data. Only the choices in the current menu are actions. There are no host, file, network, package, tool or administrative actions.' });
}

/** Explicit nested projection: never spread World, Genesis, observer packet, caller options or a prior transcript. */
export function buildSocietyContext(state: ParticipantState, personId: string, options: SocietyContextOptions) {
  if (options.phase !== 'commit' && options.phase !== 'act') fail('society_phase');
  const authorized = observe(state, personId, state.genesis.observerSecret), p = authorized.projection;
  const own = p.self;
  if (!Object.hasOwn(SOCIETY_PUBLIC_ROLES, own.role) || !ref(own.ref) || !site(own.workplace ?? 'roleless')) fail('society_identity');
  const district = state.world.shard.districts.find(d => d.plots.some(q => q.x === own.x && q.y === own.y));
  if (!district) fail('society_location');
  // The ordinary grid/range rule supplies the local social view. It grants no optical/Godot claim.
  const nearby = p.city.people.filter(q => q.ref !== own.ref && distance(own, q) <= state.world.config.commsProximityRange);
  const nearbyRefs = nearby.map(q => q.ref);
  const base = policyInput(authorized.context);
  const ownSlot = roleArrays(state.world).flatMap(([, slots]) => slots).find(q => q.buildingId === own.workplace);
  const ownCompletion = own.workplace ? state.world.completionStats[own.workplace] : undefined;
  const commitment = options.ownCommitment;
  if (commitment != null && (options.phase !== 'act' || !object(commitment) ||
    !(own.role === 'Baker' && exact(commitment, ['kind', 'price']) && commitment.kind === 'bakerPrice' && finite(commitment.price) && commitment.price >= 0 && commitment.price <= 2 ||
      own.role === 'Miller' && exact(commitment, ['kind', 'quantity']) && commitment.kind === 'millerQuantity' && finite(commitment.quantity) && commitment.quantity >= 0.01 && commitment.quantity <= 1))) fail('society_own_commitment');
  const offers = (options.market ?? []).map(q => {
    if (!ref(q.sellerRef) || !site(q.buildingId) || !finite(q.price) || q.price < 0 || q.price > 2 || typeof q.available !== 'boolean') fail('society_public_market');
    // A public quote cannot invent a seller, site, or private stock. Availability is an offer, not a stock report.
    const seller = p.city.people.find(x => x.ref === q.sellerRef && x.role === 'Baker');
    const holder = [...state.registry.people.values()].find(x => x.location === q.buildingId && x.role === 'baker');
    if (!seller || !holder || observerRef(state.genesis.observerSecret, personId, holder.id, refHexLength(state.world)) !== q.sellerRef)
      fail('society_public_market');
    return { sellerRef: q.sellerRef, buildingId: q.buildingId, price: q.price, available: q.available };
  });
  if (new Set(offers.map(q => q.sellerRef)).size !== offers.length) fail('society_public_market');
  const oracle = options.oracle ?? { entryCost: 0.3, winProbability: 0.05, canEnter: false, canRedeem: false };
  if (!finite(oracle.entryCost) || oracle.entryCost < 0 || !finite(oracle.winProbability) || oracle.winProbability < 0 || oracle.winProbability > 1 ||
      typeof oracle.canEnter !== 'boolean' || typeof oracle.canRedeem !== 'boolean' ||
      oracle.voucherExpiresOnDay != null && !day(oracle.voucherExpiresOnDay)) fail('society_public_oracle');
  const opportunities = (options.opportunities ?? []).map(q => {
    if (q.kind !== 'oracleEntryVoucher' || !day(q.expiresOnDay)) fail('society_opportunity');
    return { kind: 'oracleEntryVoucher' as const, expiresOnDay: q.expiresOnDay };
  });
  const wall = (options.wall ?? []).map(q => {
    if (!ref(q.author) || !SELF_STATES.includes(q.state) || !day(q.day) || q.day > base.tick) fail('society_public_wall');
    return { author: q.author, state: q.state, day: q.day };
  });
  const postcards = options.postcards === undefined ? undefined : postcardProjection(options.postcards);
  const context: SocietyDecisionContext = { tick: base.tick, selfRef: base.selfRef, role: base.role, roleEpoch: base.roleEpoch,
    legalMoves: base.legalMoves.map(q => ({ x: q.x, y: q.y })), presentRefs: nearbyRefs, knownSubjects: [...base.knownSubjects],
    ...(base.rules === 'v2' ? { rules: 'v2' as const, hearingRefs: base.hearingRefs!.filter(r => nearbyRefs.includes(r)) } : {}),
    phase: options.phase, purchaseDue: options.purchaseDue === true, offers,
    oracle: { canEnter: oracle.canEnter, canRedeem: oracle.canRedeem }, ...(postcards ? { postcards } : {}) };
  const locations = district.buildings.filter(b => distance(own, b) <= state.world.config.commsProximityRange).map(b => {
    const station = p.city.stations.find(s => s.buildingId === b.id);
    const role = roleArrays(state.world).find(([, slots]) => slots.some(s => s.buildingId === b.id))?.[0] ?? null;
    const measure = station?.heat ?? 0;
    const heat: 'none' | 'low' | 'medium' | 'high' = !station || station.state !== 'FILLED' ? 'none' : measure < 1 / 3 ? 'low' : measure < 2 / 3 ? 'medium' : 'high';
    return { buildingId: b.id, x: b.x, y: b.y, role, state: station?.state ?? 'housing', heat };
  });
  const visible = {
    day: base.tick + 1, phase: options.phase,
    self: { ref: own.ref, role: own.role, x: own.x, y: own.y, workplace: own.workplace,
      wealth: own.wealth, stock: own.stock, price: commitment?.kind === 'bakerPrice' ? commitment.price : own.price,
      quantity: commitment?.kind === 'millerQuantity' ? commitment.quantity : own.role === 'Miller' && ownSlot && 'value' in ownSlot && typeof ownSlot.value === 'number' ? ownSlot.value : null,
      flourCost: own.role === 'Baker' ? state.world.flourPrice : null,
      flourSalePrice: own.role === 'Miller' ? state.world.flourPrice : null,
      progress: own.progress, completion: ownCompletion ? { attempts: ownCompletion.attempts, completions: ownCompletion.completions } : null },
    local: { district: district.id, districtWeather: p.city.tension.find(d => d.districtId === district.id)?.tension ?? 0,
      districtCondition: state.world.districtHealth[district.id]?.state ?? 'ACTIVE',
      economicHealth: p.city.economicHealth,
      places: district.plots.map(q => ({ x: q.x, y: q.y, kind: q.kind })), locations,
      people: nearby.map(q => ({ ref: q.ref, x: q.x, y: q.y, role: q.role })) },
    recognition: p.recognition.map(q => ({ ref: q.ref, face: { hue: q.face.hue, skinTone: q.face.skinTone,
      faceShape: q.face.faceShape, hairStyle: q.face.hairStyle, markCount: q.face.markCount } })),
    hearing: [...(context.hearingRefs ?? context.presentRefs)],
    heard: p.proximity.map(q => ({ speaker: q.speaker, intent: q.intent, tone: q.tone, clarity: q.clarity,
      referent: q.referent.kind === 'room' ? { kind: 'room' } : { kind: 'player', playerId: q.referent.playerId }, context: q.context })),
    rumours: p.rumours.map(q => ({ source: q.source, state: q.state, clarity: q.clarity })),
    diary: p.diary.map(q => ({ subject: q.subject, observation: q.observation, reading: q.reading, context: q.context })),
    dealings: ('dealings' in p ? p.dealings ?? [] : []).map(q => ({ kind: q.kind, as: q.as, counterparty: q.counterparty, quantity: q.quantity, outcome: q.outcome })),
    wall: { prices: offers.map(q => ({ sellerRef: q.sellerRef, buildingId: q.buildingId, price: q.price, available: q.available })), posts: wall },
    opportunities,
    oracle: { entryCost: oracle.entryCost, winProbability: oracle.winProbability, canEnter: oracle.canEnter,
      canRedeem: oracle.canRedeem, voucherExpiresOnDay: oracle.voucherExpiresOnDay ?? null,
      prizes: { wealth: SOCIETY_ORACLE_RULES.wealthPrize,
        ownRoleStock: own.role === 'Grifter' ? null : SOCIETY_ORACLE_RULES.resourceStockPrize,
        ownRoleStockCap: SOCIETY_ORACLE_RULES.personalResourceCap,
        entryVoucherDays: SOCIETY_ORACLE_RULES.voucherValidDays,
        conditionalPrizeProbability: own.role === 'Grifter' ? 1 / 2 : 1 / 3,
        maxHeldVouchers: SOCIETY_ORACLE_RULES.maxVouchersHeld } },
    rules: societyPublicRules(base.rules === 'v2'),
    ...(postcards ? { postcards } : {}),
    legalChoices: { moves: context.legalMoves.map(q => ({ x: q.x, y: q.y })), present: [...context.presentRefs],
      diarySubjects: [...context.knownSubjects], purchaseDue: context.purchaseDue,
      purchaseSellers: context.offers.filter(q => q.available && q.sellerRef !== context.selfRef).map(q => q.sellerRef),
      oracle: [...(context.oracle.canEnter ? ['enter'] : []), ...(context.oracle.canRedeem ? ['redeem'] : [])],
      ...(postcards ? { postcards: societyPostcardChoices(postcards, options.phase) } : {}) },
    decisionSchema: societyDecisionSchema(context),
  };
  const safe = freeze(visible);
  authorizedViews.add(safe);
  return { visible: safe, context: freeze(context) };
}
export type SocietyVisibleContext = ReturnType<typeof buildSocietyContext>['visible'];

/** Independent last-egress validation of serialized views. This checks the complete nested
 * allowlist, closed game vocabularies, static public guide and exact generated action schema.
 * Observation provenance still belongs to the branded builder and controller in the parent. */
export function assertSerializedSocietyVisibleContext(value: unknown): asserts value is SocietyVisibleContext {
  assertJsonData(value, 0, 20);
  const record = (v: unknown, keys: readonly string[]): v is Record<string, any> => object(v) && exact(v, keys);
  const list = (v: unknown, check: (item: any) => boolean): boolean => Array.isArray(v) && v.length <= 5000 && v.every(check);
  const member = (v: unknown, values: readonly string[]): boolean => typeof v === 'string' && values.includes(v);
  const coordinate = (v: unknown): boolean => Number.isSafeInteger(v);
  const bounded = (v: unknown, min: number, max: number): boolean => finite(v) && v >= min && v <= max;
  const nullable = (v: unknown, check: (item: any) => boolean): boolean => v === null || check(v);
  const point = (q: unknown): boolean => record(q, ['x', 'y']) && coordinate(q.x) && coordinate(q.y);
  const hasPostcards = object(value) && Object.hasOwn(value, 'postcards');
  if (!record(value, ['day', 'phase', 'self', 'local', 'recognition', 'hearing', 'heard', 'rumours', 'diary', 'dealings', 'wall', 'opportunities', 'oracle', 'rules', 'legalChoices', 'decisionSchema', ...(hasPostcards ? ['postcards'] : [])])) fail('society_serialized_view');
  const v = value;
  let postcards: SocietyPostcardView | undefined;
  if (hasPostcards) {
    if (!record(v.postcards, ['held', 'unclaimedUnits', 'rate', 'clockMs', 'lastClaimAtMs', 'claimableWhite', 'unitDenominator', 'capHours', 'rules'])) fail('society_serialized_postcards');
    postcards = postcardProjection({ held: v.postcards.held, unclaimedUnits: v.postcards.unclaimedUnits, rate: v.postcards.rate,
      clockMs: v.postcards.clockMs, lastClaimAtMs: v.postcards.lastClaimAtMs });
    if (v.postcards.claimableWhite !== postcards.claimableWhite || v.postcards.unitDenominator !== postcards.unitDenominator ||
      v.postcards.capHours !== postcards.capHours || v.postcards.rules !== postcards.rules) fail('society_serialized_postcards');
  }
  if (!day(v.day) || v.day < 1 || !member(v.phase, ['commit', 'act']) ||
    !record(v.self, ['ref', 'role', 'x', 'y', 'workplace', 'wealth', 'stock', 'price', 'quantity', 'flourCost', 'flourSalePrice', 'progress', 'completion']) ||
    !ref(v.self.ref) || !member(v.self.role, Object.keys(SOCIETY_PUBLIC_ROLES)) || !coordinate(v.self.x) || !coordinate(v.self.y) ||
    !nullable(v.self.workplace, site) || !finite(v.self.wealth) || !bounded(v.self.stock, 0, SOCIETY_ORACLE_RULES.personalResourceCap) ||
    !(v.self.role === 'Baker' ? bounded(v.self.price, 0, 2) && finite(v.self.flourCost) : v.self.price === null && v.self.flourCost === null) ||
    !(v.self.role === 'Miller' ? bounded(v.self.quantity, 0.01, 1) && finite(v.self.flourSalePrice) : v.self.quantity === null && v.self.flourSalePrice === null) ||
    !nullable(v.self.progress, finite) || !nullable(v.self.completion, q => record(q, ['attempts', 'completions']) && day(q.attempts) && day(q.completions) && q.completions <= q.attempts)) fail('society_serialized_self');
  if (!record(v.local, ['district', 'districtWeather', 'districtCondition', 'economicHealth', 'places', 'locations', 'people']) ||
    !site(v.local.district) || !bounded(v.local.districtWeather, 0, 1) || !member(v.local.districtCondition, ['ACTIVE', 'CONSOLIDATING', 'MERGED']) || !bounded(v.local.economicHealth, 0, 1) ||
    !list(v.local.places, q => record(q, ['x', 'y', 'kind']) && coordinate(q.x) && coordinate(q.y) && member(q.kind, ['street', 'plaza', 'building', 'empty'])) ||
    !list(v.local.locations, q => record(q, ['buildingId', 'x', 'y', 'role', 'state', 'heat']) && site(q.buildingId) && coordinate(q.x) && coordinate(q.y) &&
      nullable(q.role, x => member(x, ['baker', 'miller', 'courier', 'investigator', 'importExport'])) && member(q.state, ['FILLED', 'VACANT', 'BACKSTOPPED', 'housing']) && member(q.heat, ['none', 'low', 'medium', 'high'])) ||
    !list(v.local.people, q => record(q, ['ref', 'x', 'y', 'role']) && ref(q.ref) && q.ref !== v.self.ref && coordinate(q.x) && coordinate(q.y) && member(q.role, Object.keys(SOCIETY_PUBLIC_ROLES)))) fail('society_serialized_local');
  if (!list(v.recognition, q => record(q, ['ref', 'face']) && ref(q.ref) && record(q.face, ['hue', 'skinTone', 'faceShape', 'hairStyle', 'markCount']) &&
    bounded(q.face.hue, 0, 359) && bounded(q.face.skinTone, 0, 1) && day(q.face.faceShape) && day(q.face.hairStyle) && day(q.face.markCount)) ||
    !list(v.hearing, ref) || !list(v.heard, q => record(q, ['speaker', 'intent', 'tone', 'clarity', 'referent', 'context']) && ref(q.speaker) && member(q.intent, INTENTS) && member(q.tone, TONES) && bounded(q.clarity, 0, 1) &&
      (record(q.referent, ['kind']) && q.referent.kind === 'room' || record(q.referent, ['kind', 'playerId']) && q.referent.kind === 'player' && ref(q.referent.playerId)) && nullable(q.context, x => member(x, SPEECH_CONTEXTS))) ||
    !list(v.rumours, q => record(q, ['source', 'state', 'clarity']) && ref(q.source) && member(q.state, SELF_STATES) && bounded(q.clarity, 0, 1)) ||
    !list(v.diary, q => record(q, ['subject', 'observation', 'reading', 'context']) && ref(q.subject) && q.subject !== v.self.ref && member(q.observation, OBSERVATIONS) && member(q.reading, READINGS) && nullable(q.context, x => member(x, DIARY_CONTEXTS))) ||
    !list(v.dealings, q => record(q, ['kind', 'as', 'counterparty', 'quantity', 'outcome']) && member(q.kind, ['purchase', 'flourSupply', 'grainSupply', 'delivery', 'evidence', 'inquiry']) && member(q.as, ['provider', 'recipient', 'sender']) && nullable(q.counterparty, ref) && nullable(q.quantity, x => finite(x) && x >= 0) && member(q.outcome, ['served', 'turnedAway', 'supplied', 'delivered', 'questioned']))) fail('society_serialized_memory');
  if (!record(v.wall, ['prices', 'posts']) ||
    !list(v.wall.prices, q => record(q, ['sellerRef', 'buildingId', 'price', 'available']) && ref(q.sellerRef) && site(q.buildingId) && bounded(q.price, 0, 2) && typeof q.available === 'boolean') ||
    !list(v.wall.posts, q => record(q, ['author', 'state', 'day']) && ref(q.author) && member(q.state, SELF_STATES) && day(q.day) && q.day < v.day) ||
    !list(v.opportunities, q => record(q, ['kind', 'expiresOnDay']) && q.kind === 'oracleEntryVoucher' && day(q.expiresOnDay)) ||
    !record(v.oracle, ['entryCost', 'winProbability', 'canEnter', 'canRedeem', 'voucherExpiresOnDay', 'prizes']) ||
    v.oracle.entryCost !== SOCIETY_ORACLE_RULES.entryCost || !bounded(v.oracle.winProbability, 0.05, 0.3) ||
    typeof v.oracle.canEnter !== 'boolean' || typeof v.oracle.canRedeem !== 'boolean' || !nullable(v.oracle.voucherExpiresOnDay, day)) fail('society_serialized_market');
  const prizes = { wealth: SOCIETY_ORACLE_RULES.wealthPrize, ownRoleStock: v.self.role === 'Grifter' ? null : SOCIETY_ORACLE_RULES.resourceStockPrize,
    ownRoleStockCap: SOCIETY_ORACLE_RULES.personalResourceCap, entryVoucherDays: SOCIETY_ORACLE_RULES.voucherValidDays,
    conditionalPrizeProbability: v.self.role === 'Grifter' ? 1 / 2 : 1 / 3, maxHeldVouchers: SOCIETY_ORACLE_RULES.maxVouchersHeld };
  if (JSON.stringify(v.oracle.prizes) !== JSON.stringify(prizes) || JSON.stringify(v.rules) !== JSON.stringify(societyPublicRules(true))) fail('society_serialized_rules');
  if (!record(v.legalChoices, ['moves', 'present', 'diarySubjects', 'purchaseDue', 'purchaseSellers', 'oracle', ...(postcards ? ['postcards'] : [])]) || !list(v.legalChoices.moves, point) ||
    !list(v.legalChoices.present, ref) || !list(v.legalChoices.diarySubjects, ref) || typeof v.legalChoices.purchaseDue !== 'boolean' ||
    JSON.stringify(v.legalChoices.present) !== JSON.stringify(v.local.people.map((q: any) => q.ref)) ||
    JSON.stringify(v.legalChoices.diarySubjects) !== JSON.stringify(v.recognition.map((q: any) => q.ref)) ||
    JSON.stringify(v.legalChoices.purchaseSellers) !== JSON.stringify(v.wall.prices.filter((q: any) => q.available && q.sellerRef !== v.self.ref).map((q: any) => q.sellerRef)) ||
    JSON.stringify(v.legalChoices.oracle) !== JSON.stringify([...(v.oracle.canEnter ? ['enter'] : []), ...(v.oracle.canRedeem ? ['redeem'] : [])])) fail('society_serialized_choices');
  if (postcards && JSON.stringify(v.legalChoices.postcards) !== JSON.stringify(societyPostcardChoices(postcards, v.phase))) fail('society_serialized_postcard_choices');
  const context: SocietyDecisionContext = { tick: v.day - 1, selfRef: v.self.ref, role: v.self.role, roleEpoch: 0,
    legalMoves: v.legalChoices.moves, presentRefs: v.legalChoices.present, knownSubjects: v.legalChoices.diarySubjects,
    rules: 'v2', hearingRefs: v.hearing, phase: v.phase, offers: v.wall.prices, purchaseDue: v.legalChoices.purchaseDue,
    oracle: { canEnter: v.oracle.canEnter, canRedeem: v.oracle.canRedeem }, ...(postcards ? { postcards } : {}) };
  if (JSON.stringify(v.decisionSchema) !== JSON.stringify(societyDecisionSchema(context))) fail('society_serialized_schema');
}

/** A violation aborts the controller; it is never silently converted into a stay/work fallback. */
export function validateSocietyAction(value: unknown, c: SocietyDecisionContext): SocietyAction {
  assertJsonData(value);
  if (!object(value) || !exact(value, ['move', 'communication', 'diary', 'occupation', 'purchase', 'oracle', ...(c.postcards ? ['postcards'] : [])])) fail('society_action_shape');
  const old = validateDecision({ move: value.move, communication: value.communication, diary: value.diary, role: null }, c);
  if (!old) fail('society_action_illegal');
  const occupation = value.occupation;
  if (occupation !== null) {
    if (!object(occupation)) fail('society_occupation');
    if (c.phase === 'commit' && c.role === 'Baker') {
      if (!exact(occupation, ['kind', 'price']) || occupation.kind !== 'bakerPrice' || !finite(occupation.price) || occupation.price < 0 || occupation.price > 2) fail('society_occupation');
    } else if (c.phase === 'commit' && c.role === 'Miller') {
      if (!exact(occupation, ['kind', 'quantity']) || occupation.kind !== 'millerQuantity' || !finite(occupation.quantity) || occupation.quantity < 0.01 || occupation.quantity > 1) fail('society_occupation');
    } else if (c.phase === 'act' && ['Courier', 'Investigator', 'ImportExport'].includes(c.role)) {
      if (!exact(occupation, ['kind']) || occupation.kind !== 'work') fail('society_occupation');
    } else fail('society_occupation');
  }
  if (c.phase === 'commit' && [value.move, value.communication, value.diary, value.purchase, value.oracle].some(v => v !== null)) fail('society_phase_action');
  if (value.purchase !== null && (!object(value.purchase) || !exact(value.purchase, ['seller', 'quantity']) || value.purchase.quantity !== 1 ||
    !c.purchaseDue || !c.offers.some(q => q.available && q.sellerRef !== c.selfRef && q.sellerRef === (value.purchase as Record<string, unknown>).seller))) fail('society_purchase');
  if (value.oracle !== null && !(value.oracle === 'enter' && c.oracle.canEnter || value.oracle === 'redeem' && c.oracle.canRedeem)) fail('society_oracle');
  if (c.postcards && value.postcards !== null) {
    const p = value.postcards, choices = societyPostcardChoices(c.postcards, c.phase);
    if (c.phase !== 'act' || !object(p) || !exact(p, ['claim', 'fusion']) || typeof p.claim !== 'boolean' || p.claim && !choices.canClaim) fail('society_postcards');
    if (p.fusion !== null && (!object(p.fusion) || !exact(p.fusion, ['tier', 'stake']) ||
      !choices.fusion.some(q => q.tier === (p.fusion as Record<string, unknown>).tier && q.stake === (p.fusion as Record<string, unknown>).stake && (!q.requiresClaim || p.claim)))) fail('society_postcards');
  }
  return freeze(structuredClone(value) as unknown as SocietyAction);
}

/** No Markdown, tool calls, envelopes, output prose, getters or executable values are admitted. */
export function parseSocietyResponse(text: string, context: SocietyDecisionContext): SocietyAction {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 16_384) fail('society_response_bounds');
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail('society_response_json'); }
  return validateSocietyAction(value, context);
}

export function societyDecisionSchema(c: SocietyDecisionContext): Record<string, unknown> {
  const original = mockDecisionSchema(c) as { properties: Record<string, Record<string, unknown>> };
  const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
  const nil = { type: 'null' }, kind = (v: string) => ({ type: 'string', enum: [v] });
  const optional = (v: unknown) => ({ anyOf: [nil, v] });
  const occupation = c.phase === 'commit' && c.role === 'Baker' ? optional(obj({ kind: kind('bakerPrice'), price: { type: 'number', minimum: 0, maximum: 2 } }))
    : c.phase === 'commit' && c.role === 'Miller' ? optional(obj({ kind: kind('millerQuantity'), quantity: { type: 'number', minimum: 0.01, maximum: 1 } }))
    : c.phase === 'act' && ['Courier', 'Investigator', 'ImportExport'].includes(c.role) ? optional(obj({ kind: kind('work') })) : nil;
  const sellers = c.offers.filter(q => q.available && q.sellerRef !== c.selfRef).map(q => q.sellerRef);
  const oracle = [...(c.oracle.canEnter ? ['enter'] : []), ...(c.oracle.canRedeem ? ['redeem'] : [])];
  let postcardSchema: unknown = nil;
  if (c.postcards && c.phase === 'act') {
    const choices = societyPostcardChoices(c.postcards, c.phase);
    const selection = (claim: boolean) => {
      const recipes = choices.fusion.filter(q => claim || !q.requiresClaim).map(q => obj({ tier: kind(q.tier), stake: { type: 'number', enum: [q.stake] } }));
      return obj({ claim: { type: 'boolean', enum: [claim] }, fusion: recipes.length ? { anyOf: [nil, ...recipes] } : nil });
    };
    postcardSchema = { anyOf: [nil, selection(false), ...(choices.canClaim ? [selection(true)] : [])] };
  }
  return obj({ move: c.phase === 'act' ? original.properties.move : nil,
    communication: c.phase === 'act' ? original.properties.communication : nil, diary: c.phase === 'act' ? original.properties.diary : nil,
    occupation, purchase: c.phase === 'act' && c.purchaseDue && sellers.length ? optional(obj({ seller: { type: 'string', enum: sellers }, quantity: { type: 'number', enum: [1] } })) : nil,
    oracle: c.phase === 'act' && oracle.length ? optional({ type: 'string', enum: oracle }) : nil,
    ...(c.postcards ? { postcards: postcardSchema } : {}) });
}
