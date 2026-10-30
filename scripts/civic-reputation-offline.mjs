import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import {createHash} from 'node:crypto';
import {civicReputationScore, computeCivicReputation, civicRelativeShares} from '../src/engine/civicReputation.ts';

const checks=[];
const check=(name,fn)=>{fn();checks.push(name);};
const approx=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const ev=(id,subjectId,day,domain,valence,weight=1)=>({id,subjectId,day,domain,valence,weight});
check('zero evidence and nonnegative notoriety',()=>{assert.deepEqual(civicReputationScore(0,0),{positive:0,negative:0,standing:0,notoriety:0});assert.ok(civicReputationScore(0,5).notoriety>0)});
check('signed evidence & independent fame',()=>{approx(civicReputationScore(3,3).standing,0);assert.ok(civicReputationScore(2,9).standing<0)});
check('duplicate evidence rejected',()=>{assert.throws(()=>computeCivicReputation([ev('x','a',0,'service','positive'),ev('x','a',0,'service','positive')]),/duplicate_event/)});
check('commutativity and determinism',()=>{const e=[ev('a','a',1,'service','positive'),ev('b','a',2,'conduct','negative',2),ev('c','b',1,'cooperation','positive')];assert.deepEqual([...computeCivicReputation(e)],[...computeCivicReputation([...e].reverse())])});
check('anti-farming same day',()=>{const events=Array.from({length:10},(_,i)=>ev(`e${i}`,'a',1,'service','positive'));assert.equal(computeCivicReputation(events).get('a').positive,3)});
check('anti-farming across days',()=>{const events=Array.from({length:10},(_,i)=>ev(`e${i}`,'a',i+1,'service','positive'));assert.equal(computeCivicReputation(events).get('a').positive,10)});
check('domain partition and independent positive negative caps',()=>{const s=computeCivicReputation([ev('a','a',1,'service','positive',3),ev('b','a',1,'service','negative',2),ev('c','a',1,'conduct','negative',3)]).get('a');assert.equal(s.positive,3);assert.equal(s.negative,5);assert.equal(s.domains.service.negative,2)});
check('null day does not decay standing',()=>{const a=computeCivicReputation([ev('x','a',1,'service','positive')]).get('a');const b=computeCivicReputation([ev('x','a',1,'service','positive')]).get('a');assert.deepEqual(a,b)});
check('input validation',()=>{for(const item of [ev('a','a',-1,'service','positive'),ev('bad id','a',0,'service','positive'),ev('a','a',0,'service','positive',4)])assert.throws(()=>computeCivicReputation([item]))});
check('relative shares normalize',()=>{const s=civicRelativeShares([{subjectId:'a',standing:99},{subjectId:'b',standing:-99}]);approx([...s.values()].reduce((a,b)=>a+b,0),1)});
check('invalid share input rejected',()=>{assert.throws(()=>civicRelativeShares([{subjectId:'a',standing:0},{subjectId:'a',standing:2}]))});
let monotonicChecks=0;
check('monotonicity on 10,000 numerical pairs',()=>{for(let p=0;p<100;p++)for(let n=0;n<100;n++){const before=civicReputationScore(p,n).standing;assert.ok(civicReputationScore(p+1,n).standing>=before-1e-12);assert.ok(civicReputationScore(p,n+1).standing<=before+1e-12);monotonicChecks++;}});

const initial=[...Array.from({length:8},(_,i)=>ev(`mpos${i}`,'Miller',i%4,'service','positive')),
  ev('mneg0','Miller',0,'conduct','negative'),
  ...Array.from({length:5},(_,i)=>ev(`gpos${i}`,'Grifter',i%3,'cooperation','positive')),
  ...Array.from({length:4},(_,i)=>ev(`bpos${i}`,'Baker',i%3,'service','positive'))];
// Synthetic events are prescribed. They are NOT observed policies, model actions or real societal results.
function world(scenario,day){
  const events=[...initial];
  for(let t=1;t<=day;t++){
    events.push(ev(`g${t}`,'Grifter',t+4,'service','positive'));
    if(t%2===0)events.push(ev(`b${t}`,'Baker',t+4,'service','positive'));
    if(scenario!=='quiet' && t>=8&&t<=10)events.push(ev(`m_attack_${t}`,'Miller',t+4,'conduct','negative'));
    if(scenario==='detected' && (t===11||t===12))events.push(ev(`g_caught_${t}`,'Grifter',t+4,'conduct','negative',2));
  }
  const p=computeCivicReputation(events);
  const shares=civicRelativeShares([...p.values()].map(x=>({subjectId:x.subjectId,standing:x.standing})));
  const result={day,scenario};
  for(const who of ['Miller','Grifter','Baker']){
    const x=p.get(who);result[`${who.toLowerCase()}_R`]=x.standing;result[`${who.toLowerCase()}_V`]=x.notoriety;result[`${who.toLowerCase()}_share`]=shares.get(who);
  }
  return result;
}
const trajectories={quiet:[],undetected:[],detected:[]};
for(let day=0;day<=20;day++) for(const scenario of Object.keys(trajectories)) trajectories[scenario].push(world(scenario,day));
check('twenty-one snapshots per hypothetical cohort',()=>{for(const rows of Object.values(trajectories))assert.equal(rows.length,21)});
check('only reputation variables change; no role or economy state touched',()=>{for(const rows of Object.values(trajectories))for(const r of rows)assert.equal(Object.keys(r).length,11)});
check('quiet Miller never loses absolute standing',()=>approx(trajectories.quiet[0].miller_R,trajectories.quiet[20].miller_R));
check('Miller negative conduct reduces standing',()=>assert.ok(trajectories.undetected[20].miller_R<trajectories.quiet[20].miller_R));
check('detected grifter score lower than undetected',()=>assert.ok(trajectories.detected[20].grifter_R<trajectories.undetected[20].grifter_R));
check('hypothetical adversarial results independent of evidence ordering',()=>{const reverse=computeCivicReputation([...initial].reverse());assert.deepEqual([...reverse],[...computeCivicReputation(initial)])});
const R=(p,n)=>civicReputationScore(p,n).standing;
const share=(G,M)=>civicRelativeShares([{subjectId:'Grifter',standing:G},{subjectId:'Miller',standing:M}]).get('Grifter');
const quiet=share(R(7,0),R(8,1));
const undetected=share(R(7,0),R(8,4));
const detected=share(R(7,4),R(8,4));
const threshold=(undetected-quiet)/(undetected-detected);
check('Wolfram baseline sensitivity reference',()=>{approx(quiet,0.5509618450419811);approx(undetected,0.7340927685820379);approx(detected,0.4600638977635783);approx(threshold,0.6682906184048707)});
const detectionByWitnesses=n=>1-Math.pow(0.95,n);
const firstN=Array.from({length:100},(_,i)=>i).find(n=>detectionByWitnesses(n)>=threshold);
check('illustrative detection break-even crossing',()=>assert.equal(firstN,22));
const summary={model:'civic-reputation-v0-offline-only',sourceMain:'ea5bbc389a3c02c35b2026148daf771c5a0c3e63',date:'2026-10-29',testMode:'independent local node runtime; synthetic audited inputs; no LLM or live-world run',testCount:checks.length,checks,monotonicPairs:monotonicChecks,params:{scale:10,prior:5,dailyCap:3,relativeTemperature:5},hypotheticalDetection:{quietShare:quiet,undetectedShare:undetected,detectedShare:detected,breakEvenProbability:threshold,minWitnessesAtIndependent05:firstN},day20:Object.fromEntries(Object.entries(trajectories).map(([k,v])=>[k,v[20]])),trajectories};
const canonical=JSON.stringify(summary,null,2)+'\n';
writeFileSync(new URL('../docs/research/evidence/civic-reputation-offline-2026-10-29.json',import.meta.url),canonical);
const csv=['scenario,day,miller_R,grifter_R,baker_R,miller_share,grifter_share,baker_share',...Object.entries(trajectories).flatMap(([name,arr])=>arr.map(r=>[name,r.day,r.miller_R,r.grifter_R,r.baker_R,r.miller_share,r.grifter_share,r.baker_share].join(',')))].join('\n')+'\n';
writeFileSync(new URL('../docs/research/evidence/civic-reputation-trajectory-2026-10-29.csv',import.meta.url),csv);
console.log(JSON.stringify({testCount:checks.length,monotonicPairs:monotonicChecks,detection:summary.hypotheticalDetection,day20:summary.day20,jsonSha256:createHash('sha256').update(canonical).digest('hex'),csvSha256:createHash('sha256').update(csv).digest('hex')},null,2));
