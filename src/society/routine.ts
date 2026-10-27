/** Versioned daily responsibilities. Private bookkeeping never becomes another person's
 * observation or a transcript. Production, prices and settlement stay in the daily kernel. */
import type {ParticipantState,ParticipantTurnResult} from '../agent/participantWorld.js';
import {applyParticipantMove} from '../agent/participantWorld.js';
import {personBody,observerRef,refHexLength} from '../server/observer.js';
import {hashUnit} from '../engine/dealings.js';
import {HOUSING_RESIDENTS_PER_FLOOR} from '../engine/space.js';
import type {ParticipantHooks} from '../engine/inhabitants.js';
import type {SocietyAction,SocietyRoutineObservation} from './boundary.js';
import type {WallPost} from '../comms/grammar.js';

export interface SocietyRoutineConfig {maxTurnsPerDay:number;information?:'inhabitant-v1'}
export function validateSocietyRoutineConfig(value:unknown):asserts value is SocietyRoutineConfig {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
    Reflect.ownKeys(value).some(k=>k!=='maxTurnsPerDay'&&k!=='information'))
    throw Error('society_routine_config');
  if(Object.hasOwn(value,'information')){
    const information=Object.getOwnPropertyDescriptor(value,'information');
    if(!information?.enumerable||!Object.hasOwn(information,'value')||information.value!=='inhabitant-v1')throw Error('society_routine_config');
  }
  const field=Object.getOwnPropertyDescriptor(value,'maxTurnsPerDay');
  if(!field||!Object.hasOwn(field,'value')||!field.enumerable||!Number.isSafeInteger(field.value)||field.value<1||field.value>128)
    throw Error('society_routine_config');
}
type Tasks=SocietyRoutineObservation['tasks'];
interface DayPerson {tasks:Tasks;closed:boolean;postcardsUsed:boolean;dailyOracleUsed:boolean;lotteryUsed:boolean;
  action:SocietyAction;foodResult:'pending'|'ordered'|'noBakery';}
type Home=SocietyRoutineObservation['home'] & {unit:number};
const emptyAction=():SocietyAction=>({move:null,communication:null,diary:null,occupation:null,purchase:null,oracle:null});
const same=(a:{x:number;y:number},b:{x:number;y:number})=>a.x===b.x&&a.y===b.y;

/** Existing texture-generated layouts can contain isolated building plots. Add only
 * missing street tiles along deterministic shortest grid links, preserving all buildings
 * and all original plots. Every trip still consists of ordinary adjacent legal moves. */
function connectRoutineStreets(state:ParticipantState):void {
  if(state.world.shard.districts.length!==1)throw Error('society_routine_single_district_required');
  const district=state.world.shard.districts[0]!,key=(p:{x:number;y:number})=>`${p.x},${p.y}`;
  const plots=[...district.plots],points=new Map(plots.map(p=>[key(p),p]));
  const hub=state.world.shard.hubPlot;
  if(!points.has(key(hub))){const p={x:hub.x,y:hub.y,districtId:district.id,kind:'plaza' as const};points.set(key(p),p);plots.push(p);}
  const component=()=>{
    const seen=new Set<string>([key(hub)]),queue=[hub];
    for(let i=0;i<queue.length;i++){const p=queue[i]!;
      for(const q of [{x:p.x-1,y:p.y},{x:p.x,y:p.y-1},{x:p.x,y:p.y+1},{x:p.x+1,y:p.y}])if(points.has(key(q))&&!seen.has(key(q))){seen.add(key(q));queue.push(q);}}
    return seen;
  };
  for(let reached=component();reached.size<points.size;reached=component()){
    const inside=[...points.values()].filter(p=>reached.has(key(p))),outside=[...points.values()].filter(p=>!reached.has(key(p)));
    const pairs=inside.flatMap(a=>outside.map(b=>({a,b,d:Math.abs(a.x-b.x)+Math.abs(a.y-b.y)}))).sort((a,b)=>a.d-b.d||a.a.x-b.a.x||a.a.y-b.a.y||a.b.x-b.b.x||a.b.y-b.b.y);
    const {a,b}=pairs[0]!;let x=a.x,y=a.y;
    while(x!==b.x||y!==b.y){if(x!==b.x)x+=Math.sign(b.x-x);else y+=Math.sign(b.y-y);
      const p={x,y,districtId:district.id,kind:'street' as const};if(!points.has(key(p))){points.set(key(p),p);plots.push(p);}}
  }
  state.world={...state.world,shard:{...state.world.shard,districts:[{...district,plots}]}};
}

export class SocietyRoutineBook {
  readonly config:SocietyRoutineConfig;
  #homes=new Map<string,Home>();
  #people=new Map<string,DayPerson>();
  #contacts=new Set<string>();
  #customers=new Map<string,Set<string>>();
  #turn=1;
  #effects:ParticipantTurnResult['effects']=[];
  #posts:WallPost[]=[];
  #social:NonNullable<ParticipantHooks['resolvedSocial']>={rumours:[],conversations:[],interactions:[],diaryWrites:[]};
  constructor(config:SocietyRoutineConfig,state:ParticipantState){
    validateSocietyRoutineConfig(config);this.config=Object.freeze(structuredClone(config));
    connectRoutineStreets(state);
    this.registerHomes(state,true);this.beginDay(state);
  }
  get turn(){return this.#turn;}
  get limitReached(){return this.#turn>this.config.maxTurnsPerDay;}
  get allClosed(){return this.#people.size>0&&[...this.#people.values()].every(p=>p.closed);}
  closed(person:string){return this.#people.get(person)?.closed??false;}
  #ref(state:ParticipantState,observer:string,person:string){return observerRef(state.genesis.observerSecret,observer,person,refHexLength(state.world));}
  registerHomes(state:ParticipantState,moveNew=false):void {
    const active=[...state.registry.people.values()].filter(p=>p.location!==null);
    const occupied=new Set(active.flatMap(p=>{const h=this.#homes.get(p.id);return h?[`${h.buildingId}:${h.floor}:${h.unit}`]:[];}));
    for(const person of [...active].sort((a,b)=>hashUnit(state.genesis.seed,'home-person',a.id)-hashUnit(state.genesis.seed,'home-person',b.id)||a.id.localeCompare(b.id))){
      if(this.#homes.has(person.id))continue;
      const body=personBody(state,person),district=state.world.shard.districts.find(d=>d.plots.some(p=>same(p,body)));
      if(!district)throw Error('society_home_district');
      const buildings=[...district.buildings].sort((a,b)=>hashUnit(state.genesis.seed,'home-building',person.id,a.id)-hashUnit(state.genesis.seed,'home-building',person.id,b.id)||a.id.localeCompare(b.id));
      let found:Home|undefined;
      for(const b of buildings){
        for(let floor=1;floor<=b.floors&&!found;floor++)for(let unit=1;unit<=HOUSING_RESIDENTS_PER_FLOOR&&!found;unit++){
          if(!occupied.has(`${b.id}:${floor}:${unit}`))found={buildingId:b.id,x:b.x,y:b.y,floor,unit};
        }
        if(found)break;
      }
      if(!found)throw Error('society_housing_capacity');
      this.#homes.set(person.id,found);occupied.add(`${found.buildingId}:${found.floor}:${found.unit}`);
      if(moveNew)state.world=applyParticipantMove(state.world,person.role,person.location!,{x:found.x,y:found.y});
    }
  }
  beginDay(state:ParticipantState):void {
    this.registerHomes(state,true);
    this.#turn=1;this.#people.clear();this.#contacts.clear();this.#customers.clear();this.#effects=[];this.#posts=[];
    this.#social={rumours:[],conversations:[],interactions:[],diaryWrites:[]};
    for(const p of state.registry.people.values())if(p.location!==null){
      const own=personBody(state,p),home=this.#homes.get(p.id)!;
      this.#people.set(p.id,{tasks:{leftHome:!same(own,home),work:p.role===null,wall:false,food:false,diary:false,conversation:p.role===null,oracle:false},
        closed:false,postcardsUsed:false,dailyOracleUsed:false,lotteryUsed:false,action:emptyAction(),foodResult:'pending'});
    }
  }
  observation(state:ParticipantState,person:string,phase:'commit'|'act'):SocietyRoutineObservation {
    const row=this.#people.get(person);if(!row)throw Error('society_routine_person');
    const p=state.registry.people.get(person)!,own=personBody(state,p),home=this.#homes.get(person)!;
    const buildings=state.world.shard.districts.flatMap(d=>d.buildings),workplace=buildings.find(b=>b.id===own.workplace);
    const hub=state.world.shard.hubPlot;
    const bakeries=state.world.bakers.map(b=>{
      const place=buildings.find(q=>q.id===b.buildingId)!;
      const inhabitant=b.slot.state==='FILLED'?state.registry.locations.get(b.buildingId):undefined;
      return {buildingId:b.buildingId,x:place.x,y:place.y,sellerRef:inhabitant?this.#ref(state,person,inhabitant):null};
    });
    const customers=[...(this.#customers.get(person)??[])].filter(customer=>!this.#contacts.has(`${person}>${customer}`)).map(id=>this.#ref(state,person,id));
    const order=row.action.purchase,sellerRef=order&&'seller' in order?order.seller:null;
    const seller=sellerRef?[...state.registry.people.values()].find(p=>p.location!==null&&this.#ref(state,person,p.id)===sellerRef):undefined;
    const awaitingSeller=seller&&!this.#contacts.has(`${seller.id}>${person}`)?sellerRef:null;
    const allFood=[...this.#people.values()].every(p=>p.tasks.food);
    const finish=Object.values(row.tasks).every(Boolean)&&customers.length===0&&awaitingSeller===null&&(p.role===null||allFood);
    const active=phase==='act'&&!row.closed;
    return {turn:phase==='commit'?0:this.#turn,maxTurnsPerDay:this.config.maxTurnsPerDay,
      home:{buildingId:home.buildingId,x:home.x,y:home.y,floor:home.floor},
      sites:{wall:{x:hub.x,y:hub.y},oracle:{x:hub.x,y:hub.y},workplace:workplace?{buildingId:workplace.id,x:workplace.x,y:workplace.y}:null,bakeries},
      tasks:{...row.tasks},customers,awaitingSeller,
      can:{wallPost:active&&!row.tasks.wall&&same(own,hub),diary:active&&!row.tasks.diary&&same(own,home),
        work:active&&!row.tasks.work&&!!workplace&&same(own,workplace),
        foodFailure:active&&!row.tasks.food&&bakeries.some(b=>same(own,b))&&!bakeries.some(b=>b.sellerRef!==null&&b.sellerRef!==this.#ref(state,person,person)),
        finishDay:active&&finish,oracle:active&&same(own,hub)},
      postcardsUsed:row.postcardsUsed,dailyOracleUsed:row.dailyOracleUsed,lotteryUsed:row.lotteryUsed};
  }
  /** Update only proven effects and admitted attempts; no substitute action or content. */
  acceptTurn(previous:ParticipantState,next:ParticipantState,actions:ReadonlyMap<string,SocietyAction>,result:ParticipantTurnResult):void {
    const dutyEffects:ParticipantTurnResult['effects']=[];
    for(const address of result.addresses){
      this.#contacts.add(`${address.speaker}>${address.listener}`);
      const speaker=this.#people.get(address.speaker);if(speaker)speaker.tasks.conversation=true;
    }
    for(const [person,a] of actions){
      const row=this.#people.get(person)!;
      if(a.communication?.kind==='wallPost')row.tasks.wall=true;
      if(result.social.diaryWrites.includes(person))row.tasks.diary=true;
      if(a.occupation?.kind==='work'){row.tasks.work=true;dutyEffects.push({person,category:'workScheduled'});if(previous.registry.people.get(person)!.role!==null&&['courier','investigator','importExport'].includes(previous.registry.people.get(person)!.role!))row.action.occupation={kind:'work'};}
      if(a.purchase){
        row.tasks.food=true;row.action.purchase=structuredClone(a.purchase);dutyEffects.push({person,category:'seller' in a.purchase?'foodOrder':'failedFoodAttempt'});
        if('seller' in a.purchase){
          row.foodResult='ordered';
          const sellerRef=a.purchase.seller;
          const seller=[...previous.registry.people.values()].find(p=>p.location!==null&&this.#ref(previous,person,p.id)===sellerRef);
          if(!seller)throw Error('society_routine_seller');
          const customers=this.#customers.get(seller.id)??new Set<string>();customers.add(person);this.#customers.set(seller.id,customers);
        }else row.foodResult='noBakery';
      }
      if(a.postcards){row.postcardsUsed=true;row.action.postcards=structuredClone(a.postcards);}
      if(a.dailyOracle){row.dailyOracleUsed=true;row.action.dailyOracle=a.dailyOracle;}
      if(a.oracle){row.lotteryUsed=true;row.action.oracle=a.oracle;}
      if(a.occupation?.kind==='finishDay'){row.closed=true;dutyEffects.push({person,category:'finishDay'});}
      const own=personBody(next,next.registry.people.get(person)!);
      if(!same(own,this.#homes.get(person)!))row.tasks.leftHome=true;
      if(same(personBody(previous,previous.registry.people.get(person)!),previous.world.shard.hubPlot)||same(own,next.world.shard.hubPlot)){
        if(!row.tasks.oracle)dutyEffects.push({person,category:'oracleVisit'});row.tasks.oracle=true;
      }
    }
    result.effects.push(...dutyEffects);this.#effects.push(...result.effects);this.#posts.push(...result.posts);
    this.#social.rumours.push(...result.social.rumours);this.#social.interactions.push(...result.social.interactions);
    this.#social.diaryWrites.push(...result.social.diaryWrites);this.#social.conversations=structuredClone(result.social.conversations);
    this.#turn++;
  }
  dailyActions(){return new Map([...this.#people].map(([person,p])=>[person,structuredClone(p.action)]));}
  social(){return structuredClone(this.#social);}
  posts(){return structuredClone(this.#posts);}
  effects(){return structuredClone(this.#effects);}
  noBakery(){return [...this.#people].filter(([,p])=>p.foodResult==='noBakery').map(([person])=>person);}
  summary(){return [...this.#people].map(([person,p])=>({person,tasks:{...p.tasks},closed:p.closed,foodResult:p.foodResult}));}
  snapshot(){return structuredClone({config:this.config,turn:this.#turn,homes:[...this.#homes],people:[...this.#people],contacts:[...this.#contacts],customers:[...this.#customers].map(([p,s])=>[p,[...s]]),posts:this.#posts,social:this.#social,effects:this.#effects});}
}
