import {expect,it} from 'vitest';
import {createParticipantState,fixtureGenesis} from '../src/agent/participantWorld.js';
import {societyConfig} from '../src/society/runtime.js';
import {evictBackstoppedOccupant} from '../src/society/reputationBackstop.js';
import {buildSocietyContext,validateSocietyAction} from '../src/society/boundary.js';
import {mechanicalShopRef} from '../src/society/mechanicalShop.js';
import {buildSocietyRequest} from '../src/society/request.js';
import {validateSocietyWire} from '../scripts/society-request-worker.js';

it('offers an anonymous backstopped bakery through the existing purchase action',()=>{
  let state=createParticipantState(fixtureGenesis(42,societyConfig()));
  const baker=[...state.registry.people.values()].find(p=>p.role==='baker')!;
  const site=baker.location!;
  state=evictBackstoppedOccupant(state,{person:baker.id,role:'baker',roleEpoch:baker.roleEpoch,businessId:site},1);
  const buyer=[...state.registry.people.values()].find(p=>p.role===null)!;
  const token=mechanicalShopRef(state,buyer.id,site);
  const context=buildSocietyContext(state,buyer.id,{phase:'act',objective:'competitive-society-v1',purchaseDue:true,
    civicStanding:{own:{standing:1,notoriety:0},others:[],assistance:[]},
    market:[{sellerRef:token,buildingId:site,price:2,available:true,mechanical:true}]});
  expect(context.visible.wall.prices[0]).toMatchObject({sellerRef:token,mechanical:true});
  expect(validateSocietyAction({move:null,communication:null,diary:null,occupation:null,purchase:{seller:token,quantity:1},oracle:null},context.context).purchase)
    .toEqual({seller:token,quantity:1});
  const wire=buildSocietyRequest(context.visible);
  expect(()=>validateSocietyWire(Buffer.from(wire.body),wire.sha256)).not.toThrow();
  expect(()=>buildSocietyContext(state,buyer.id,{phase:'act',objective:'competitive-society-v1',
    market:[{sellerRef:'1234567890abcdef',buildingId:site,price:2,available:true,mechanical:true}]})).toThrow();
});
