/** Operator evidence codec. Optional undefined configuration fields and negative zero are
 * hash-significant; plain JSON silently loses them. Inhabitant request JSON never uses this
 * envelope. Raw observations/actions remain readable under value in the saved artifact. */
import { digest } from '../agent/replay.js';

type Special = {path:(string|number)[];kind:'undefined'|'negativeZero'};
export function stringifySocietyEvidence(value:unknown):string {
  const specialValues:Special[]=[],active=new Set<object>();let nodes=0;
  const visit=(v:unknown,path:(string|number)[],depth:number):unknown=>{
    if(++nodes>5_000_000||depth>60)throw Error('society_evidence_bounds');
    if(v===undefined){specialValues.push({path,kind:'undefined'});return null;}
    if(typeof v==='number'){
      if(!Number.isFinite(v))throw Error('society_evidence_number');
      if(Object.is(v,-0)){specialValues.push({path,kind:'negativeZero'});return 0;}return v;
    }
    if(v===null||typeof v==='string'||typeof v==='boolean')return v;
    if(typeof v!=='object'||active.has(v)||v instanceof Map||v instanceof Set||
      !Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw Error('society_evidence_shape');
    active.add(v);
    const result=Array.isArray(v)?Array.from(v,(item,i)=>visit(item,[...path,i],depth+1)):
      Object.fromEntries(Object.entries(v).map(([key,item])=>[key,visit(item,[...path,key],depth+1)]));
    active.delete(v);return result;
  };
  const plain=visit(value,[],0);
  return JSON.stringify({format:'node-society-evidence-v1',digest:digest(value),specialValues,value:plain},null,2)+'\n';
}

export function parseSocietyEvidence<T>(text:string):T {
  if(typeof text!=='string'||Buffer.byteLength(text)>128*1024*1024)throw Error('society_evidence_bounds');
  const envelope=JSON.parse(text);
  if(!envelope||typeof envelope!=='object'||Object.keys(envelope).sort().join(',')!=='digest,format,specialValues,value'||
    envelope.format!=='node-society-evidence-v1'||!/^[a-f0-9]{64}$/.test(envelope.digest)||!Array.isArray(envelope.specialValues)||envelope.specialValues.length>10000)throw Error('society_evidence_format');
  let value:unknown=envelope.value;const seen=new Set<string>();
  for(const item of envelope.specialValues){
    if(!item||typeof item!=='object'||Object.keys(item).sort().join(',')!=='kind,path'||!Array.isArray(item.path)||item.path.length>60||
      !['undefined','negativeZero'].includes(item.kind)||!item.path.every((k:unknown)=>typeof k==='string'||typeof k==='number'&&Number.isSafeInteger(k)&&k>=0))throw Error('society_evidence_special');
    const key=JSON.stringify(item.path);if(seen.has(key))throw Error('society_evidence_special');seen.add(key);
    let parent:any=null,current:any=value,last:string|number|undefined;
    for(const segment of item.path){
      if(current===null||typeof current!=='object'||!Object.hasOwn(current,segment))throw Error('society_evidence_path');
      parent=current;last=segment;current=current[segment];
    }
    if(item.kind==='undefined'?current!==null:current!==0)throw Error('society_evidence_special');
    const restored=item.kind==='undefined'?undefined:-0;
    if(parent===null)value=restored;
    else Object.defineProperty(parent,last!,{value:restored,writable:true,enumerable:true,configurable:true});
  }
  if(digest(value)!==envelope.digest)throw Error('society_evidence_digest');
  return value as T;
}
