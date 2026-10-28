/** Godot route requests are operator-only. Models choose destinations, never paths,
 * transport identifiers, worker profiles or intermediate movement commands. */
import {createHash} from 'node:crypto';
import {digest} from '../agent/replay.js';
import {assertGridPath,type GridPoint} from '../engine/navigation.js';
export const NAVIGATION_PROFILE='node-navigation-godot-v1';
export interface NavigationRequest {
  type:'navigationRequest';schema:'node-navigation-request-v1';requestId:string;worldHash:string;actorRef:string;
  from:GridPoint;to:GridPoint;district:{id:string;plots:GridPoint[]};
}
export interface NavigationRecord {
  schema:'node-navigation-record-v1';requestId:string;worldHash:string;actorRef:string;
  profile:typeof NAVIGATION_PROFILE;engine:{name:string;version:string};
  requestSha256:string;responseSha256:string;path:GridPoint[];
}
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
export function navigationRequest(worldHash:string,actorRef:string,from:GridPoint,to:GridPoint,district:{id:string;plots:readonly GridPoint[]}):NavigationRequest{
  const input={worldHash,actorRef,from:{x:from.x,y:from.y},to:{x:to.x,y:to.y},district:{id:district.id,plots:district.plots.map(p=>({x:p.x,y:p.y}))}};
  return {type:'navigationRequest',schema:'node-navigation-request-v1',requestId:digest(['navigation',input]),...input};
}
export function validateNavigation(request:NavigationRequest,response:unknown,raw:string):NavigationRecord{
  const r=response as Record<string,any>;
  if(!r||Object.keys(r).sort().join(',')!=='actorRef,engine,path,profile,requestId,schema,type,worldHash'||r.type!=='navigation'||r.schema!=='node-navigation-response-v1'||r.profile!==NAVIGATION_PROFILE||
    r.requestId!==request.requestId||r.worldHash!==request.worldHash||r.actorRef!==request.actorRef||!r.engine||Object.keys(r.engine).sort().join(',')!=='name,version'||typeof r.engine.name!=='string'||typeof r.engine.version!=='string'||!Array.isArray(r.path))throw Error('navigation_response_binding');
  assertGridPath(request.district.plots,request.from,request.to,r.path);
  return {schema:'node-navigation-record-v1',requestId:request.requestId,worldHash:request.worldHash,actorRef:request.actorRef,profile:NAVIGATION_PROFILE,
    engine:{name:r.engine.name,version:r.engine.version},requestSha256:sha(JSON.stringify(request)),responseSha256:sha(raw),path:structuredClone(r.path)};
}
export function assertNavigationRecord(request:NavigationRequest,record:NavigationRecord):NavigationRecord{
  if(!record||Object.keys(record).sort().join(',')!=='actorRef,engine,path,profile,requestId,requestSha256,responseSha256,schema,worldHash'||record.schema!=='node-navigation-record-v1'||record.requestSha256!==sha(JSON.stringify(request))||!/^[a-f0-9]{64}$/.test(record.responseSha256))throw Error('navigation_record_binding');
  validateNavigation(request,{type:'navigation',schema:'node-navigation-response-v1',requestId:record.requestId,worldHash:record.worldHash,actorRef:record.actorRef,profile:record.profile,engine:record.engine,path:record.path},'');
  return structuredClone(record);
}
