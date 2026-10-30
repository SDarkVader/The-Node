import type {ParticipantState} from '../agent/participantWorld.js';
import {observerRef,refHexLength} from '../server/observer.js';

/** Observer-specific reference to a business, never a resident identity. */
export function mechanicalShopRef(state:ParticipantState, observer:string, buildingId:string):string {
  return observerRef(state.genesis.observerSecret,observer,'mechanical-bakery:'+buildingId,refHexLength(state.world));
}
