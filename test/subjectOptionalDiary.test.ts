import {describe,it,expect} from 'vitest';
import {Society,societyConfig,verifySocietyTape} from '../src/society/runtime.js';
import {autonomousPolicy,emptySocietyAction} from '../src/society/policy.js';
import {buildSocietyRequest} from '../src/society/request.js';
import {assertSerializedSocietyVisibleContext,validateSocietyAction} from '../src/society/boundary.js';
import {validateSocietyWire} from '../scripts/society-request-worker.js';
import {createDiaryStore,writeDiaryEntry,readDiary} from '../src/engine/diary.js';
import {stringifySocietyEvidence,parseSocietyEvidence} from '../src/society/codec.js';
import {parseGameAction} from '../src/server/actionVocabulary.js';

const config=()=>({...societyConfig(),diarySubjectOptional:true as const,pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0});
const entry={subject:null,observation:'deflectedWhenConfronted',reading:'cantTellYet',context:null};
const start=()=>new Society({seed:42,sourceRevision:'subject-optional-test',config:config()});
function act(s:Society){while(s.phase==='commit')for(const p of s.pendingPeople())s.submit(p,autonomousPolicy(s.view(p).visible));}

describe('subject-optional constrained diary contract',()=>{
  it('admits a diversion without recognition through schema, worker, actual kernel and disk replay',()=>{
    const s=start();act(s);const p=s.pendingPeople()[0]!,v=s.view(p);
    expect(v.context.knownSubjects).toEqual([]);
    expect(v.visible.legalChoices.diarySubjectOptional).toBe(true);
    const request=buildSocietyRequest(v.visible);validateSocietyWire(Buffer.from(request.body),request.sha256);
    expect(v.visible.decisionSchema).toHaveProperty('properties.diary.anyOf');
    s.submit(p,{...emptySocietyAction(),diary:entry});
    for(const other of s.pendingPeople())s.submit(other,emptySocietyAction());
    expect(s.tick).toBe(1);
    expect(s.inspect().world.diary.get(p)?.[0]?.value.subject).toBeNull();
    expect(s.exportTape().decisions.find(d=>d.person===p&&d.phase==='act')!.action.diary).toEqual(entry);
    expect(s.exportTape().transitions[0]!.effects).toContainEqual({person:p,category:'diary'});
    const tape=parseSocietyEvidence<ReturnType<Society['exportTape']>>(stringifySocietyEvidence(s.exportTape()));
    expect(verifySocietyTape(tape)).toMatchObject({verified:true,ticks:1});
    expect(s.view(p).visible.diary[0]?.subject).toBeNull();
    assertSerializedSocietyVisibleContext(s.view(p).visible);
  });
  it.each(['baker','miller','courier','investigator','importExport',null])('gives %s the same menu without a free-text channel',role=>{
    const s=start();act(s);const p=[...s.inspect().registry.people.values()].find(p=>p.role===role)!;
    const v=s.view(p.id),a={...emptySocietyAction(),diary:entry};
    expect(validateSocietyAction(a,v.context).diary).toEqual(entry);
    for(const diary of [{...entry,subject:v.context.selfRef},{...entry,subject:'a'.repeat(16)},
      {...entry,observation:'arbitrary prose'}, {...entry,reading:'arbitrary prose'}, {...entry,text:'extra text'},
      {...entry,context:'arbitrary prose'}])expect(()=>validateSocietyAction({...a,diary},v.context)).toThrow();
  });
  it('keeps legacy no-subject admission closed and preserves identical legacy views',()=>{
    const s=new Society({seed:42,sourceRevision:'legacy',config:{...societyConfig(),pMonthly:0}});act(s);
    const v=s.view(s.pendingPeople()[0]!);
    expect(v.context).not.toHaveProperty('diarySubjectOptional');
    expect(v.visible.legalChoices).not.toHaveProperty('diarySubjectOptional');
    expect(()=>validateSocietyAction({...emptySocietyAction(),diary:entry},v.context)).toThrow();
    const tampered=structuredClone(v.visible);(tampered.legalChoices as any).diarySubjectOptional=true;
    expect(()=>assertSerializedSocietyVisibleContext(tampered)).toThrow();
    expect(parseGameAction('diaryEntry',{...entry,context:undefined})).toBeNull();
    expect(parseGameAction('diaryEntry',{...entry,context:undefined},{diarySubjectOptional:true})).not.toBeNull();
  });
  it('halts the simulation on an unrecognised named subject, without a day transition',()=>{
    const s=start();act(s);const p=s.pendingPeople()[0]!;
    expect(()=>s.submit(p,{...emptySocietyAction(),diary:{...entry,subject:'a'.repeat(16)}})).toThrow();
    expect(s.halted).toBe(true);expect(s.tick).toBe(0);
    expect(s.exportTape().transitions).toEqual([]);
  });
  it('keeps null subject stable through existing independent slot drift and two-day expiry',()=>{
    const store=createDiaryStore();
    expect(()=>writeDiaryEntry(store,'owner',null,'stayedGuarded','cantTellYet',1,new Set())).toThrow();
    writeDiaryEntry(store,'owner',null,'stayedGuarded','cantTellYet',1,new Set(),undefined,true);
    const first=readDiary(store,'owner',2,()=>0);expect(first).toHaveLength(1);expect(first[0]!.subject).toBeNull();
    expect(first[0]!.observation).not.toBe('stayedGuarded');
    expect(readDiary(store,'owner',2,()=>{throw Error('extra ageing');})).toEqual(first);
    expect(readDiary(store,'owner',3,()=>0)).toEqual([]);
  });
});
