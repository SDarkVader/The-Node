/** Public map knowledge is separate from local sight, hearing and recognition. */
import type {ParticipantState} from '../agent/participantWorld.js';
import {observe} from '../server/observer.js';
import {roleArrays} from '../engine/inhabitants.js';
import type {FirstPersonObservation} from '../observatory/perception.js';
import {reachablePlots} from '../engine/navigation.js';

export const DUAL_NAVIGATION_RULES='Once per decision you receive one overhead map and your current first-person view together. Choose any listed reachable same-district geographical destination in move, or null to stay and interact here. A move is a travel-only decision: every other field must be null. Navigation follows existing adjacent legal plots to arrival without further model calls, perspective switches or intermediate interactions. Your next regular decision receives the arrival view and interaction menu. Map inhabitants do not grant sight, hearing, recognition, address, purchase or private access. Hearing remains independent of optical visibility.';
export function dualObservation(state:ParticipantState,person:string,firstPerson:FirstPersonObservation){
  const p=observe(state,person,state.genesis.observerSecret).projection;
  const overhead={
    districts:state.world.shard.districts.map(d=>({id:d.id,plots:d.plots.map(q=>({x:q.x,y:q.y,kind:q.kind})),
      weather:p.city.tension.find(t=>t.districtId===d.id)?.tension??0,condition:state.world.districtHealth[d.id]?.state??'ACTIVE',
      locations:d.buildings.map(b=>{const station=p.city.stations.find(s=>s.buildingId===b.id),measure=station?.heat??0;
        return {buildingId:b.id,x:b.x,y:b.y,floors:b.floors,role:roleArrays(state.world).find(([,slots])=>slots.some(s=>s.buildingId===b.id))?.[0]??null,
          state:station?.state??'housing',heat:!station||station.state!=='FILLED'?'none':measure<1/3?'low':measure<2/3?'medium':'high'};})})),
    inhabitants:p.city.people.map(q=>({ref:q.ref,x:q.x,y:q.y,role:q.role})),
    hub:{x:state.world.shard.hubPlot.x,y:state.world.shard.hubPlot.y},economicHealth:p.city.economicHealth,
  };
  const result={contract:'dual-perspective-v1' as const,rules:DUAL_NAVIGATION_RULES,overhead,firstPerson:structuredClone(firstPerson)};
  assertDualObservation(result);return result;
}
export type DualObservation=ReturnType<typeof dualObservation>;
const exact=(v:any,keys:string[])=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const list=(v:any,f:(q:any)=>boolean)=>Array.isArray(v)&&v.length<=5000&&v.every(f);
const number=(n:any)=>typeof n==='number'&&Number.isFinite(n);
const point=(p:any)=>Number.isSafeInteger(p?.x)&&Number.isSafeInteger(p?.y);
const id=(s:any)=>typeof s==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(s);
const ref=(s:any)=>typeof s==='string'&&/^(?:[a-f0-9]{16}|[a-f0-9]{64})$/.test(s);
const member=(s:any,values:any[])=>values.includes(s);
const role=(s:any)=>member(s,[null,'baker','miller','courier','investigator','importExport']);
export function assertDualObservation(v:unknown):void{
  const d=v as any,o=d?.overhead,f=d?.firstPerson;
  const measure=(q:any)=>number(q.dx)&&number(q.dy)&&number(q.distance)&&q.distance>=0&&Math.abs(Math.hypot(q.dx,q.dy)-q.distance)<0.001&&q.distance<=f.effectiveRange+0.001;
  if(!exact(d,['contract','rules','overhead','firstPerson'])||d.contract!=='dual-perspective-v1'||d.rules!==DUAL_NAVIGATION_RULES||
    !exact(o,['districts','inhabitants','hub','economicHealth'])||!exact(o.hub,['x','y'])||!point(o.hub)||!number(o.economicHealth)||o.economicHealth<0||o.economicHealth>1||
    !list(o.districts,(q:any)=>exact(q,['id','plots','weather','condition','locations'])&&id(q.id)&&number(q.weather)&&q.weather>=0&&q.weather<=1&&member(q.condition,['ACTIVE','CONSOLIDATING','MERGED'])&&
      list(q.plots,(p:any)=>exact(p,['x','y','kind'])&&point(p)&&member(p.kind,['street','plaza','building','empty']))&&
      list(q.locations,(p:any)=>exact(p,['buildingId','x','y','floors','role','state','heat'])&&id(p.buildingId)&&point(p)&&Number.isSafeInteger(p.floors)&&p.floors>=1&&role(p.role)&&member(p.state,['FILLED','VACANT','BACKSTOPPED','housing'])&&member(p.heat,['none','low','medium','high'])))||
    !list(o.inhabitants,(q:any)=>exact(q,['ref','x','y','role'])&&ref(q.ref)&&point(q)&&member(q.role,['Baker','Miller','Courier','Investigator','ImportExport','Grifter']))||
    !exact(f,['effectiveRange','bodies','locations','environment'])||!number(f.effectiveRange)||f.effectiveRange<=0||f.effectiveRange>32||
    !exact(f.environment,['localTensionBand','weather'])||!member(f.environment.localTensionBand,[null,'calm','uneasy','tense'])||!member(f.environment.weather,['clear','fog'])||
    !list(f.bodies,(q:any)=>exact(q,['ref','role','dx','dy','distance'])&&ref(q.ref)&&role(q.role)&&measure(q)&&o.inhabitants.some((p:any)=>p.ref===q.ref))||
    !list(f.locations,(q:any)=>exact(q,['buildingId','role','state','heatBand','occupied','dx','dy','distance'])&&id(q.buildingId)&&role(q.role)&&member(q.state,[null,'FILLED','VACANT','BACKSTOPPED'])&&member(q.heatBand,[null,'quiet','busy','hot'])&&typeof q.occupied==='boolean'&&measure(q)&&o.districts.some((p:any)=>p.locations.some((b:any)=>b.buildingId===q.buildingId))))throw Error('society_dual_observation');
}
export function destinationChoices(d:DualObservation,district:string,from:{x:number;y:number}){
  const plots=d.overhead.districts.find(q=>q.id===district)?.plots;
  if(!plots)throw Error('society_navigation_district');
  return reachablePlots(plots,from).map(q=>({x:q.x,y:q.y}));
}
/** Cross-check the map against the local packet at the final serialized egress gate. */
export function assertDualSpatialContext(d:DualObservation,self:{ref:string;x:number;y:number;role:string},local:{district:string;districtWeather:number;districtCondition:string;economicHealth:number;places:unknown;people:{ref:string;x:number;y:number;role:string}[]}):void{
  const o=d.overhead,region=o.districts.find(q=>q.id===local.district),same=(a:any,b:any)=>a.x===b.x&&a.y===b.y;
  const roles:Record<string,string|null>={Baker:'baker',Miller:'miller',Courier:'courier',Investigator:'investigator',ImportExport:'importExport',Grifter:null};
  const people=new Map(o.inhabitants.map(q=>[q.ref,q])),locations=new Map(o.districts.flatMap(q=>q.locations).map(q=>[q.buildingId,q]));
  const own=people.get(self.ref);
  if(!region||!own||!same(own,self)||own.role!==self.role||people.size!==o.inhabitants.length||
    new Set(o.districts.map(q=>q.id)).size!==o.districts.length||locations.size!==o.districts.reduce((n,q)=>n+q.locations.length,0)||
    JSON.stringify(region.plots)!==JSON.stringify(local.places)||region.weather!==local.districtWeather||region.condition!==local.districtCondition||o.economicHealth!==local.economicHealth||
    local.people.some(p=>{const q=people.get(p.ref);return !q||!same(p,q)||p.role!==q.role;})||
    d.firstPerson.bodies.some(b=>{const p=people.get(b.ref);return b.ref===self.ref||!p||roles[p.role]!==b.role||Math.abs(p.x-self.x-b.dx)>0.001||Math.abs(p.y-self.y-b.dy)>0.001;})||
    d.firstPerson.locations.some(b=>{const p=locations.get(b.buildingId);return !p||p.role!==b.role||(p.state==='housing'?null:p.state)!==b.state||Math.abs(p.x-self.x-b.dx)>0.001||Math.abs(p.y-self.y-b.dy)>0.001;}))throw Error('society_dual_spatial_context');
}
