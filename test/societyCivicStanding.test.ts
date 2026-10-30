import {expect,it} from 'vitest';
import {societyCivicEvents,societyCivicScores} from '../src/society/civicStanding.js';
import type {DealingEvent} from '../src/engine/dealings.js';
import type {SocietyPurchaseReceipt} from '../src/engine/societyEconomy.js';

it('credits only authenticated paid service once per subject and type; never mechanical providers or failed/free purchases',()=>{
  const base:DealingEvent={tick:0,kind:'purchase',provider:'baker',providerSite:'shop',recipient:'buyer',recipientSite:'home',quantity:1,outcome:'served'};
  const receipts:SocietyPurchaseReceipt[]=[{customer:'buyer',customerSite:'home',bakerSite:'shop',quantity:1,paid:1,outcome:'served'}];
  const flour:DealingEvent={...base,kind:'flourSupply',provider:'miller',providerSite:'mill',recipient:'baker',recipientSite:'shop',outcome:'supplied'};
  const people=new Set(['baker','buyer','miller']);
  const rows=societyCivicEvents(1,[base,base,flour,{...flour,provider:null}],receipts,people);
  expect(rows).toHaveLength(3);
  expect(societyCivicScores(rows,['baker','buyer','miller','other']).get('other')).toEqual({standing:0,notoriety:0});
  expect(societyCivicScores(rows,['miller']).get('miller')!.standing).toBeGreaterThan(0);
  expect(societyCivicEvents(1,[base],[{...receipts[0]!,paid:0}],people)).toHaveLength(0);
  expect(societyCivicEvents(1,[{...base,outcome:'turnedAway'}],receipts,people)).toHaveLength(0);
  expect(societyCivicEvents(1,[...rows.map(()=>base),flour],receipts,people)).toEqual(rows);
});
