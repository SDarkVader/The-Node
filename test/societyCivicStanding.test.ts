import {expect,it} from 'vitest';
import {societyCivicEvents,societyCivicScores,CIVIC_STANDING_BASELINE} from '../src/society/civicStanding.js';
import type {DealingEvent} from '../src/engine/dealings.js';
import type {SocietyPurchaseReceipt} from '../src/engine/societyEconomy.js';

it('credits only authenticated paid service once per subject and type; never mechanical providers or failed/free purchases',()=>{
  const base:DealingEvent={tick:0,kind:'purchase',provider:'baker',providerSite:'shop',recipient:'buyer',recipientSite:'home',quantity:1,outcome:'served'};
  const receipts:SocietyPurchaseReceipt[]=[{customer:'buyer',customerSite:'home',bakerSite:'shop',quantity:1,paid:1,outcome:'served'}];
  const flour:DealingEvent={...base,kind:'flourSupply',provider:'miller',providerSite:'mill',recipient:'baker',recipientSite:'shop',outcome:'supplied'};
  const people=new Set(['baker','buyer','miller']);
  const rows=societyCivicEvents(1,[base,base,flour,{...flour,provider:null}],receipts,people);
  expect(rows).toHaveLength(3);
  expect(societyCivicScores(rows,['baker','buyer','miller','other']).get('other')).toEqual({standing:CIVIC_STANDING_BASELINE,notoriety:0});
  expect(societyCivicScores(rows,['miller']).get('miller')!.standing).toBeGreaterThan(0);
  expect(societyCivicEvents(1,[base],[{...receipts[0]!,paid:0}],people)).toHaveLength(0);
  expect(societyCivicEvents(1,[{...base,outcome:'turnedAway'}],receipts,people)).toHaveLength(0);
  expect(societyCivicEvents(1,[...rows.map(()=>base),flour],receipts,people)).toEqual(rows);
});

it('credits a real flour supplier to an anonymous bakery without inventing a recipient',()=>{
  const rows=societyCivicEvents(2,[],[],new Set(['miller']),[],[
    {provider:'miller',quantity:0.5},{provider:'miller',quantity:0.5},{provider:null,quantity:1}]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({subjectId:'miller',domain:'service',valence:'positive',weight:1});
});

it('gives each person a single positive starting score and applies explicit missed work immediately',()=>{
  const initialScore=societyCivicScores([],['citizen']).get('citizen')!;
  const initial=initialScore.standing;
  expect(initial).toBeGreaterThan(0);
  expect(initialScore.notoriety).toBe(0);
  const loss=societyCivicEvents(1,[],[],new Set(['citizen']),['citizen','citizen']);
  expect(loss).toHaveLength(1);
  expect(societyCivicScores(loss,['citizen']).get('citizen')!.standing).toBe(0);
  const sale:DealingEvent={tick:1,kind:'flourSupply',provider:'citizen',providerSite:'mill',recipient:'baker',recipientSite:'shop',quantity:1,outcome:'supplied'};
  const gain=societyCivicEvents(2,[sale],[],new Set(['citizen']));
  expect(societyCivicScores([...loss,...gain],['citizen']).get('citizen')!.standing).toBeGreaterThan(0);
});
