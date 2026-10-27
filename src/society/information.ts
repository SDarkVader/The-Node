/** Versioned, explicit inhabitant information. No world/config spread crosses this boundary. */
import type {ParticipantState} from '../agent/participantWorld.js';
import {roleArrays} from '../engine/inhabitants.js';
import {observerRef,refHexLength} from '../server/observer.js';
import {BAKER_MAX_DAILY_CUSTOMERS,DAILY_ACTIVITY_MULTIPLIER,SUPPORT_ROLE_DAILY_WAGE,GRIFTER_DAILY_INCOME} from '../engine/wealth.js';
import {FLOUR_PER_BREAD} from '../engine/resources.js';
import type {SocietyOracleEntryResult} from '../engine/oracleOpportunities.js';

export const INHABITANT_ACTION_ORDER='All inhabitants choose from the same starting-turn world. Choices remain private until the turn resolves. Speech, Wall posts and diary use the starting position and current eligibility; movement follows. Work, food orders and optional draws are recorded for day-end settlement. Several turns make one day. Income, supply, food outcomes, Oracle outcomes, role changes, recognition credit and diary ageing settle once at the day boundary. Null declines a field for this turn; it does not complete an unfinished duty. An order and a work visit do not guarantee service, profit or occupational completion.';
export const INHABITANT_WEALTH_RULES='Wealth is a scoreboard and pays for bread orders and the optional paid lottery. Personal role stock is capped, role-locked and non-fungible; it is not money or shop inventory. Base wages and completion rewards are settlement claims, subject to the activity multiplier, actual work, district conditions and available funding. Ordinary income tax and wealth caps, when configured, apply to Miller and Baker settlement only. A configured cap also bounds their free Oracle wealth awards; their paid lottery awards share this cap when the free daily Oracle is enabled. Other roles currently have no wealth cap. Legacy opportunity progress belongs to roleless eligibility; it is not signed civic reputation. Vacancies, churn, backstops and conscription can change roles at day end; none is an action you can grant yourself. No ticket, migration, trespass or private diary access is available in this action menu.';
export type OwnLotteryFeedback={day:number;status:SocietyOracleEntryResult['status'];won:boolean;prize:SocietyOracleEntryResult['prize'];prizeAmount:number;fundedBy:SocietyOracleEntryResult['fundedBy']};
export function inhabitantInformation(state:ParticipantState,person:string,lastLottery:OwnLotteryFeedback|null){
  const resident=state.registry.people.get(person)!;
  const slot=roleArrays(state.world).flatMap(([,slots])=>slots).find(s=>s.buildingId===resident.location&&s.slot.state==='FILLED');
  const grifter=state.world.grifters.find(g=>g.id===resident.location);
  const receipt=state.world.societyEconomy?.receipts.find(r=>r.customer===person);
  // The current shop occupant may have changed since settlement. Attribute only a
  // witnessed counterparty from this person's own recorded dealing.
  const seller=receipt?.bakerSite?state.world.lastDealings?.find(e=>e.kind==='purchase'&&e.recipient===person&&e.providerSite===receipt.bakerSite)?.provider:undefined;
  return {
    contract:'inhabitant-v1' as const,
    actionOrder:INHABITANT_ACTION_ORDER,wealthRules:INHABITANT_WEALTH_RULES,
    mechanics:{hearingRange:state.world.config.commsProximityRange,breadPerOrder:DAILY_ACTIVITY_MULTIPLIER,
      flourPerBread:FLOUR_PER_BREAD,bakeryDailyCustomerLimit:BAKER_MAX_DAILY_CUSTOMERS,
      purchaseCycleDays:state.world.config.purchaseCycleDays,activityMultiplier:DAILY_ACTIVITY_MULTIPLIER,
      supportBaseDailyWage:SUPPORT_ROLE_DAILY_WAGE,rolelessBaseDailyIncome:GRIFTER_DAILY_INCOME,
      incomeTaxRate:state.world.config.wealthTaxRate,wealthCap:(state.world.config.wealthCap??0)>0?state.world.config.wealthCap!:null,
      oracleEconomicHealth:state.world.economicHealthWithExperience},
    personal:{daysInRole:slot?.daysInRole??null,daysRoleless:grifter?.daysAsGrifter??null},
    feedback:{lastFood:receipt?{day:state.world.societyEconomy!.day,outcome:receipt.outcome,quantity:receipt.quantity,paid:receipt.paid,
      seller:seller?observerRef(state.genesis.observerSecret,person,seller,refHexLength(state.world)):null}:null,
      lastLottery:lastLottery===null?null:{day:lastLottery.day,status:lastLottery.status,won:lastLottery.won,
        prize:lastLottery.prize,prizeAmount:lastLottery.prizeAmount,fundedBy:lastLottery.fundedBy}},
  };
}
export type InhabitantInformation=ReturnType<typeof inhabitantInformation>;
