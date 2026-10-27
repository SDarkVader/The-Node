import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {startObservatory} from './server.js';
import {SocietyObservatorySource,type SocietyRegistration} from './societySource.js';
import {ManualTickGate} from '../society/manualTicks.js';
import type {Society} from '../society/runtime.js';
import type {SocietyRunEvent} from '../society/accounted.js';
import {stringifySocietyEvidence} from '../society/codec.js';

/** One server for actual execution, manual permits and verified historical replay. */
export async function openSocietyPanel(options:{society:Society;id:string;stop:()=>void;
  mode:'live'|'synthetic';manual:boolean;port?:number;webWorldDirectory?:string;history?:string;
  accounting?:()=>unknown}){
  const events:SocietyRunEvent[]=[],gate=options.manual?new ManualTickGate():undefined;
  let summary:{status:string}|null=null,finished=false;
  const stop=()=>{gate?.close();options.society.halt();options.stop();};
  const source=new SocietyObservatorySource({kind:'society',id:options.id,directory:'',mode:options.mode},{
    ...(gate?{gate}:{}),stop,version:()=>JSON.stringify([options.society.revision,events.length,gate?.state,summary,finished]),read:()=>({tape:options.society.exportTape(),
      eventsText:events.map(e=>JSON.stringify(JSON.parse(stringifySocietyEvidence(e)))).join('\n'),summary,
      accounting:options.accounting?.()??null,status:finished?summary?.status??'stopped':options.society.halted?'stopped':gate?.state.waitingDay?'paused':'running'})});
  let previous:SocietyObservatorySource[]=[];
  if(options.history){
    const config=JSON.parse(readFileSync(options.history,'utf8')) as {runs:SocietyRegistration[]};
    if(!Array.isArray(config.runs)||config.runs.length>100)throw Error('society_history_registration');
    previous=config.runs.filter(r=>r.id!==options.id).map(r=>new SocietyObservatorySource(r));
  }
  const researcherToken=randomBytes(32).toString('hex');
  const app=startObservatory({sources:[source,...previous],researcherToken,worldToken:randomBytes(32).toString('hex'),
    port:options.port??8090,pollMs:250,...(options.webWorldDirectory?{webWorldDirectory:options.webWorldDirectory}:{})});
  const port=await app.ready;
  return {app,gate,source,url:`http://127.0.0.1:${port}/`,researcherToken,
    event(event:SocietyRunEvent){events.push(structuredClone(event));},
    finish(value:{status:string}|null){summary=value;finished=true;gate?.close();app.refresh();},
    close:()=>app.close()};
}
