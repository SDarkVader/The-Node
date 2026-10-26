/** Trusted, deterministic fallback residents. The same policy is used as a simulated model
 * in offline demonstrations; it sees exactly the inhabitant view and no world/operator data.
 * This is ordinary resident behavior, never a negotiating surrogate for an absent human.
 */
import type { SocietyAction, SocietyVisibleContext } from './boundary.js';

const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const rounded=(n:number)=>Math.round(n*1000)/1000;
export const emptySocietyAction=():SocietyAction=>({move:null,communication:null,diary:null,occupation:null,purchase:null,oracle:null});

export function autonomousPolicy(v:SocietyVisibleContext):SocietyAction {
  const a=emptySocietyAction(), preference=parseInt(v.self.ref.slice(0,4),16)/65535;
  if(v.postcards)a.postcards=null;
  if(v.dailyOracle)a.dailyOracle=null;
  if(v.phase==='commit'){
    if(v.self.role==='Baker'){
      // Sustainable cost estimate comes only from one's own observed input market.
      const cost='flourCost' in v.self&&typeof v.self.flourCost==='number'?v.self.flourCost:1.05;
      const rivals=v.wall.prices.filter(p=>p.sellerRef!==v.self.ref);
      const rival=rivals.length?rivals.reduce((s,x)=>s+x.price,0)/rivals.length:cost+0.2;
      const ownSales=v.dealings.filter(d=>d.kind==='purchase'&&d.as==='provider'&&d.outcome==='served').length;
      const margin=0.08+preference*0.23;
      a.occupation={kind:'bakerPrice',price:rounded(clamp(Math.max(cost+margin,(rival+cost+margin)/2)+(ownSales?0.015:-0.01)+v.local.districtWeather*0.03,0,2))};
    }else if(v.self.role==='Miller'){
      const sold=v.dealings.filter(d=>d.kind==='flourSupply'&&d.as==='provider').reduce((s,d)=>s+(d.quantity??0),0);
      const current=v.self.quantity??0.5;
      const change=sold>current*0.5?0.08:sold>0?0.02:-0.04;
      a.occupation={kind:'millerQuantity',quantity:rounded(clamp(current+change-v.local.districtWeather*0.02,0.2,1))};
    }
    return a;
  }
  if(v.routine)return routinePolicy(v,a,preference);
  if(['Courier','Investigator','ImportExport'].includes(v.self.role))a.occupation={kind:'work'};
  if(v.legalChoices.purchaseDue){
    const options=v.wall.prices.filter(p=>p.available&&p.sellerRef!==v.self.ref&&p.price<=v.self.wealth);
    // A modest familiarity preference can outweigh a tiny price difference, while a large
    // price gap changes the decision. Neither choice reads another resident's inventory.
    const regular=v.dealings.find(d=>d.kind==='purchase'&&d.as==='recipient'&&d.outcome==='served')?.counterparty;
    options.sort((x,y)=>(x.price-(x.sellerRef===regular?0.03:0))-(y.price-(y.sellerRef===regular?0.03:0))||x.sellerRef.localeCompare(y.sellerRef));
    if(options[0])a.purchase={seller:options[0].sellerRef,quantity:1};
  }
  const partner=v.hearing.find(r=>v.dealings.some(d=>d.counterparty===r))??v.hearing[0];
  if(partner&&preference>0.2){
    a.communication={kind:'proximityUtterance',intent:v.heard.some(h=>h.speaker===partner)?'affirm':'ask',
      tone:v.local.districtWeather>0.3?'guarded':'warm',referent:{kind:'player',playerId:partner},context:v.self.role==='Baker'?'myPrice':null};
  }else a.communication={kind:'wallPost',state:v.local.districtWeather>0.3?'uneasy':v.self.wealth<0.3?'isolated':'hopeful'};
  const subject=v.legalChoices.diarySubjects.find(r=>v.heard.some(h=>h.speaker===r));
  if(subject){
    const heard=v.heard.find(h=>h.speaker===subject)!;
    a.diary={subject,observation:heard.tone==='guarded'?'stayedGuarded':'openedUpUnprompted',reading:'cantTellYet',context:null};
  }else if(v.legalChoices.diarySubjectOptional){
    // Deterministic resident choice under the same menu, not a claim about another person.
    a.diary={subject:null,observation:'stayedGuarded',reading:'cantTellYet',context:null};
  }
  // Walk toward a nearby interaction partner. At the same plot, stay; no artificial wage
  // or stock benefit is attached to walking. Every move comes from the actual legal menu.
  const target=v.local.people.find(p=>p.ref===partner)??v.local.locations.find(p=>p.state==='FILLED');
  if(target){
    const dist=(p:{x:number;y:number})=>Math.abs(p.x-target.x)+Math.abs(p.y-target.y);
    const best=[...v.legalChoices.moves].sort((x,y)=>dist(x)-dist(y)||x.x-y.x||x.y-y.y)[0];
    if(best&&dist(best)<dist(v.self))a.move={x:best.x,y:best.y};
  }
  if(v.oracle.canRedeem)a.oracle='redeem';
  else if(v.oracle.canEnter&&v.self.wealth>=v.oracle.entryCost+0.7&&v.oracle.winProbability>=0.1)a.oracle='enter';
  if(v.dailyOracle?.canEnter)a.dailyOracle='enter';
  if(v.postcards&&v.legalChoices.postcards){
    const claim=v.legalChoices.postcards.canClaim;
    const recipes=v.legalChoices.postcards.fusion.filter(r=>!r.requiresClaim||claim);
    // Personal deterministic patience preference, based only on public own options.
    // Humans/models may instead bank, abstain or select any other listed recipe.
    const tiers=['white','green','blue','purple'];
    const safe=recipes.filter(r=>r.stake===5).sort((x,y)=>tiers.indexOf(y.tier)-tiers.indexOf(x.tier))[0];
    const risky=preference>0.75?recipes.filter(r=>r.stake<5).sort((x,y)=>tiers.indexOf(y.tier)-tiers.indexOf(x.tier)||y.stake-x.stake)[0]:undefined;
    const fusion=risky??safe;
    if(claim||fusion)a.postcards={claim,fusion:fusion?{tier:fusion.tier,stake:fusion.stake}:null};
  }
  return a;
}

/** Shortest legal route over the resident's public district map. No private positions or
 * researcher state are consulted. Equal routes use stable coordinates, not hidden RNG. */
function toward(v:SocietyVisibleContext,target:{x:number;y:number}):SocietyAction['move']{
  const key=(p:{x:number;y:number})=>`${p.x},${p.y}`;
  const sites=v.routine?[v.routine.sites.wall,v.routine.sites.oracle]:[];
  const points=new Map([...v.local.places,...sites].map(p=>[key(p),{x:p.x,y:p.y}]));
  const targetKey=key(target),start=key(v.self);
  if(start===targetKey)return null;
  const queue=[target],steps=new Map<string,number>([[targetKey,0]]);
  for(let i=0;i<queue.length;i++){
    const p=queue[i]!,depth=steps.get(key(p))!;
    for(const q of [{x:p.x-1,y:p.y},{x:p.x,y:p.y-1},{x:p.x,y:p.y+1},{x:p.x+1,y:p.y}]){
      const k=key(q);if(!points.has(k)||steps.has(k))continue;steps.set(k,depth+1);queue.push(q);
    }
  }
  return [...v.legalChoices.moves].filter(p=>steps.has(key(p))).sort((a,b)=>steps.get(key(a))!-steps.get(key(b))!||a.x-b.x||a.y-b.y)[0]??null;
}

/** Ordinary autonomous daily policy. The model-controlled residents may choose any other
 * admitted route, wording, diary impression, purchase, production or participation. */
function routinePolicy(v:SocietyVisibleContext,a:SocietyAction,preference:number):SocietyAction{
  const r=v.routine!,at=(p:{x:number;y:number})=>p.x===v.self.x&&p.y===v.self.y;
  const say=(partner:string)=>{a.communication={kind:'proximityUtterance',intent:v.heard.some(h=>h.speaker===partner)?'affirm':'inform',
    tone:v.local.districtWeather>0.3?'guarded':'warm',referent:{kind:'player',playerId:partner},context:v.self.role==='Baker'?'myPrice':null};};
  const customer=r.customers.find(p=>v.hearing.includes(p));
  if(customer)say(customer);
  const otherBaker=v.self.role==='Baker'?v.local.people.find(p=>p.role==='Baker'&&v.hearing.includes(p.ref)):undefined;
  if(!a.communication&&otherBaker&&!r.can.wallPost)say(otherBaker.ref);
  if(!a.communication&&!r.tasks.conversation){const p=v.hearing[0];if(p)say(p);}
  if(r.can.wallPost&&!a.communication)a.communication={kind:'wallPost',state:v.local.districtWeather>0.3?'uneasy':v.self.wealth<0.3?'isolated':'hopeful'};
  if(r.can.work)a.occupation={kind:'work'};
  if(r.can.diary&&(preference<0.3||r.tasks.wall&&r.tasks.food&&r.tasks.oracle&&r.tasks.work)){
    const subject=v.legalChoices.diarySubjects.find(p=>v.heard.some(h=>h.speaker===p));
    const heard=subject?v.heard.find(h=>h.speaker===subject):undefined;
    a.diary={subject:subject??null,observation:heard?.tone==='guarded'?'stayedGuarded':heard?'openedUpUnprompted':'stayedGuarded',reading:'cantTellYet',context:null};
  }
  if(r.can.oracle){
    if(v.dailyOracle?.canEnter)a.dailyOracle='enter';
    if(v.oracle.canRedeem)a.oracle='redeem';
    else if(v.oracle.canEnter&&v.self.wealth>=v.oracle.entryCost+0.7&&v.oracle.winProbability>=0.1)a.oracle='enter';
  }
  if(v.postcards&&!r.postcardsUsed&&v.legalChoices.postcards){
    const claim=v.legalChoices.postcards.canClaim,recipes=v.legalChoices.postcards.fusion.filter(q=>!q.requiresClaim||claim);
    const tiers=['white','green','blue','purple'];
    const safe=recipes.filter(q=>q.stake===5).sort((x,y)=>tiers.indexOf(y.tier)-tiers.indexOf(x.tier))[0];
    const risky=preference>0.75?recipes.filter(q=>q.stake<5).sort((x,y)=>tiers.indexOf(y.tier)-tiers.indexOf(x.tier)||y.stake-x.stake)[0]:undefined;
    const fusion=risky??safe;
    if(claim||fusion)a.postcards={claim,fusion:fusion?{tier:fusion.tier,stake:fusion.stake}:null};
  }
  const regular=v.dealings.find(d=>d.kind==='purchase'&&d.as==='recipient'&&d.outcome==='served')?.counterparty;
  const offers=v.wall.prices.filter(p=>p.available&&p.sellerRef!==v.self.ref).sort((x,y)=>
    (x.price-(x.sellerRef===regular?0.03:0))-(y.price-(y.sellerRef===regular?0.03:0))||x.sellerRef.localeCompare(y.sellerRef));
  const chosen=offers[0],bakery=chosen?r.sites.bakeries.find(b=>b.sellerRef===chosen.sellerRef):undefined;
  if(!r.tasks.food){
    if(chosen&&v.legalChoices.purchaseSellers.includes(chosen.sellerRef)){
      a.purchase={seller:chosen.sellerRef,quantity:1};
      if(!a.communication&&v.hearing.includes(chosen.sellerRef))say(chosen.sellerRef);
    }else if(r.can.foodFailure)a.purchase={kind:'seekFood'};
  }
  if(r.can.finishDay){
    a.occupation={kind:'finishDay'};a.move=null;return a;
  }
  let target:{x:number;y:number}|undefined;
  // A seller answers waiting customers at the shop before seeking its own next service.
  if(r.customers.length&&!customer)target=r.sites.workplace??undefined;
  else if(r.awaitingSeller)target=r.sites.bakeries.find(b=>b.sellerRef===r.awaitingSeller);
  else if(!r.tasks.work)target=r.sites.workplace??undefined;
  else if(!r.tasks.wall)target=r.sites.wall;
  else if(!r.tasks.food)target=bakery??r.sites.bakeries.find(b=>b.sellerRef!==v.self.ref);
  else if(!r.tasks.oracle)target=r.sites.oracle;
  else if(!r.tasks.conversation)target=v.local.people.find(p=>v.hearing.includes(p.ref))??r.sites.wall;
  else if(!r.tasks.diary)target=r.home;
  else if(v.self.role!=='Grifter')target=r.sites.workplace??r.sites.wall;
  if(!r.tasks.leftHome&&(!target||at(target))){
    a.move=[...v.legalChoices.moves].sort((x,y)=>x.x-y.x||x.y-y.y)[0]??null;
  }else if(target&&!at(target))a.move=toward(v,target);
  return a;
}
