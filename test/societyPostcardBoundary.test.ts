import {describe,expect,it} from 'vitest';
import {createParticipantState,fixtureGenesis} from '../src/agent/participantWorld.js';
import {DEFAULT_WORLD_CONFIG} from '../src/world/world.js';
import {buildSocietyContext,assertSerializedSocietyVisibleContext,validateSocietyAction,parseSocietyResponse,
  SocietySecurityError,SOCIETY_POSTCARD_RULES,type SocietyPostcardObservation,type SocietyAction} from '../src/society/boundary.js';
import {buildSocietyRequest,SOCIETY_INHABITANT_INSTRUCTIONS,SOCIETY_POSTCARD_INHABITANT_INSTRUCTIONS} from '../src/society/request.js';

const HOUR=3_600_000;
const stay=():SocietyAction=>({move:null,communication:null,diary:null,occupation:null,purchase:null,oracle:null});
/** Feasible own-balance boundary fixtures; this suite tests projection/choices, not accrual. */
const balance=():SocietyPostcardObservation=>({held:{white:4,green:5,blue:5,purple:5,orange:0},
  unclaimedUnits:'7200001',rate:{numerator:2,denominator:1},clockMs:10*HOUR,lastClaimAtMs:9*HOUR});
function fixture(role:string|null='baker',phase:'commit'|'act'='act',postcards:SocietyPostcardObservation|undefined=balance()){
  const state=createParticipantState(fixtureGenesis(72,{...DEFAULT_WORLD_CONFIG,recognition:'v2',
    pMonthly:0,arrivalPDaily:0,migrationK:0,saboteurCount:0}));
  const person=[...state.registry.people.values()].find(p=>p.role===role)!;
  const build=(input:SocietyPostcardObservation|undefined)=>buildSocietyContext(state,person.id,{phase,...(input?{postcards:input}:{})});
  return {state,person,build,...build(postcards)};
}
function schemas(view:ReturnType<typeof fixture>['visible']):any{return view.decisionSchema;}

describe('opt-in postcard inhabitant information and request contract',()=>{
  it('preserves the exact six-field default view, rules, legal menu and request',()=>{
    const f=fixture(),base=f.build(undefined),enabled=structuredClone(f.visible) as any;
    expect(base.visible).not.toHaveProperty('postcards');expect(base.context).not.toHaveProperty('postcards');
    expect(schemas(base.visible).required).toEqual(['move','communication','diary','occupation','purchase','oracle']);
    delete enabled.postcards;delete enabled.legalChoices.postcards;
    delete enabled.decisionSchema.properties.postcards;enabled.decisionSchema.required.pop();
    expect(enabled).toEqual(base.visible);
    expect(JSON.parse(buildSocietyRequest(base.visible).body).system).toBe(SOCIETY_INHABITANT_INSTRUCTIONS);
    expect(validateSocietyAction(stay(),base.context)).toEqual(stay());
    expect(()=>validateSocietyAction({...stay(),postcards:null},base.context)).toThrow('society_action_shape');
    expect(()=>validateSocietyAction(stay(),f.context)).toThrow('society_action_shape');
  });
  it.each(['baker','miller','courier','investigator','importExport',null])('offers the same own-account mechanics to %s',role=>{
    const {visible,context}=fixture(role);
    expect(visible.postcards).toEqual({...balance(),claimableWhite:2,unitDenominator:'3600000',capHours:16,rules:SOCIETY_POSTCARD_RULES});
    expect(visible.legalChoices.postcards).toMatchObject({canClaim:true});
    expect(visible.legalChoices.postcards!.fusion).toHaveLength(16);
    expect(visible.legalChoices.postcards!.fusion[0]).toEqual({tier:'white',stake:5,successProbability:1,requiresClaim:true});
    const action={...stay(),postcards:{claim:true,fusion:{tier:'white' as const,stake:5}}};
    expect(validateSocietyAction(action,context)).toEqual(action);
    expect(()=>assertSerializedSocietyVisibleContext(JSON.parse(JSON.stringify(visible)))).not.toThrow();
  });
  it('sends the branded seven-field schema and unchanged high-effort controls without tools or private data',()=>{
    const {visible}=fixture(),request=buildSocietyRequest(visible),wire=JSON.parse(request.body);
    expect(wire.system).toBe(SOCIETY_POSTCARD_INHABITANT_INSTRUCTIONS);expect(wire.system).toContain('seven-field');
    expect(wire.output_config.format.schema.required).toEqual(['move','communication','diary','occupation','purchase','oracle','postcards']);
    expect(JSON.parse(wire.messages[0].content[0].text)).toEqual(visible);
    expect(wire.output_config.effort).toBe('high');expect(wire.max_tokens).toBe(2048);
    expect(wire).not.toHaveProperty('tools');expect(wire).not.toHaveProperty('tool_choice');
    for(const key of ['seed','drawCount','origin','transactions','issuedWhite','burnedWhite','sourceRevision','worldHash','requestId'])
      expect(JSON.stringify(wire.messages)).not.toContain('"'+key+'"');
    expect(()=>buildSocietyRequest(structuredClone(visible))).toThrow('society_request_unbound_view');
  });
  it('copies and freezes the own input instead of retaining a mutable inventory, rate or option object',()=>{
    const input=balance(),f=fixture('baker','act',input),before=JSON.stringify(f.visible);
    (input.held as any).white=999;input.rate={numerator:9,denominator:1};input.unclaimedUnits='0';
    expect(JSON.stringify(f.visible)).toBe(before);expect(Object.isFrozen(f.visible.postcards)).toBe(true);
    expect(Object.isFrozen(f.visible.postcards!.held)).toBe(true);expect(Object.isFrozen(f.context.postcards!.rate)).toBe(true);
  });
  it('ignores unrelated world/private state and preserves exact provider bytes for a fixed own account',()=>{
    const f=fixture(),before=buildSocietyRequest(f.visible).body;
    Object.assign(f.state.world,{developerUpdate:'PRIVATE_DEVELOPMENT',operatorSeed:'PRIVATE_SEED',privateInventory:{green:999}});
    Object.assign(f.state.genesis,{credentials:'PRIVATE_CREDENTIAL',sourceRevision:'PRIVATE_SOURCE'});
    const other=f.state.world.bakers.find(b=>b.buildingId!==f.person.location)!;
    other.wealth=98765;other.personalResourceStock=12345;Object.assign(other,{postcards:{orange:900},secretPlan:'PRIVATE_PLAN'});
    expect(buildSocietyRequest(f.build(balance()).visible).body).toBe(before);
  });
});

describe('postcard closed action semantics and matching schema',()=>{
  it('allows decline and claim before a newly affordable White safe fusion',()=>{
    const f=fixture();
    expect(validateSocietyAction({...stay(),postcards:null},f.context).postcards).toBeNull();
    expect(validateSocietyAction({...stay(),postcards:{claim:false,fusion:null}},f.context).postcards).toEqual({claim:false,fusion:null});
    expect(()=>validateSocietyAction({...stay(),postcards:{claim:false,fusion:{tier:'white',stake:5}}},f.context)).toThrow('society_postcards');
    const accepted=parseSocietyResponse(JSON.stringify({...stay(),postcards:{claim:true,fusion:{tier:'white',stake:5}}}),f.context);
    expect(accepted.postcards).toEqual({claim:true,fusion:{tier:'white',stake:5}});expect(Object.isFrozen(accepted.postcards!.fusion)).toBe(true);
    const schema=schemas(f.visible).properties.postcards;
    const noClaim=schema.anyOf.find((q:any)=>q.properties?.claim.enum[0]===false);
    const claim=schema.anyOf.find((q:any)=>q.properties?.claim.enum[0]===true);
    expect(JSON.stringify(noClaim)).not.toContain('white');expect(JSON.stringify(claim)).toContain('white');
  });
  it.each(['green','blue','purple'] as const)('allows every affordable %s stake at its published odds',tier=>{
    const f=fixture();
    for(let stake=1;stake<=5;stake++){
      expect(validateSocietyAction({...stay(),postcards:{claim:false,fusion:{tier,stake}}},f.context).postcards).toEqual({claim:false,fusion:{tier,stake}});
      expect(f.visible.legalChoices.postcards!.fusion).toContainEqual({tier,stake,successProbability:stake/5,requiresClaim:false});
    }
  });
  it('permits only null postcard choice during commit and presents no misleading act recipes',()=>{
    const f=fixture('miller','commit');
    expect(f.visible.legalChoices.postcards).toEqual({canClaim:false,fusion:[]});
    expect(schemas(f.visible).properties.postcards).toEqual({type:'null'});
    expect(validateSocietyAction({...stay(),postcards:null},f.context).postcards).toBeNull();
    expect(()=>validateSocietyAction({...stay(),postcards:{claim:false,fusion:null}},f.context)).toThrow('society_postcards');
  });
  it('removes possible target and claim overflow from the menu before any draw',()=>{
    const p=balance();p.held={...p.held,white:Number.MAX_SAFE_INTEGER,blue:Number.MAX_SAFE_INTEGER};
    const f=fixture('baker','act',p);
    expect(f.visible.legalChoices.postcards!.canClaim).toBe(false);
    expect(f.visible.legalChoices.postcards!.fusion.some(q=>q.tier==='green')).toBe(false);
    expect(()=>validateSocietyAction({...stay(),postcards:{claim:true,fusion:null}},f.context)).toThrow('society_postcards');
    expect(validateSocietyAction({...stay(),postcards:{claim:false,fusion:{tier:'white',stake:5}}},f.context).postcards).not.toBeNull();
  });
  it('rejects invented recipes, ownership, supplied rolls, sequences, extra fields and malformed control data',()=>{
    const f=fixture();
    const attacks:unknown[]=[
      {claim:false,fusion:{tier:'white',stake:1}},{claim:false,fusion:{tier:'orange',stake:1}},
      {claim:false,fusion:{tier:['green','blue'],stake:1}},{claim:false,fusion:{tier:'green',stake:0}},
      {claim:false,fusion:{tier:'green',stake:6}},{claim:false,fusion:{tier:'green',stake:1.5}},
      {claim:false,fusion:{tier:'green',stake:1,roll:0}},{claim:false,fusion:null,personId:'another-person'},
      {claim:false,fusion:[{tier:'green',stake:1}]},{claim:'true',fusion:null},{claim:true},
      {claim:false,fusion:null,exec:'read_file'},{claim:false,fusion:{tier:'green',stake:1,seed:4}},
    ];
    for(const p of attacks)expect(()=>validateSocietyAction({...stay(),postcards:p},f.context)).toThrow(SocietySecurityError);
    let called=false;const p={claim:false,fusion:null};Object.defineProperty(p,'claim',{enumerable:true,get:()=>{called=true;return true;}});
    expect(()=>validateSocietyAction({...stay(),postcards:p},f.context)).toThrow(SocietySecurityError);expect(called).toBe(false);
  });
});

describe('postcard last-egress and builder rejection',()=>{
  it('rejects all extra operator keys and manipulated derived fields at each nested level',()=>{
    const f=fixture();
    const attacks=[
      (v:any)=>{v.postcards.seed=4;},(v:any)=>{v.postcards.drawCount=1;},(v:any)=>{v.postcards.origin={};},
      (v:any)=>{v.postcards.transactions=[];},(v:any)=>{v.postcards.worldHash='secret';},
      (v:any)=>{v.postcards.held.foreignStock=500;},(v:any)=>{v.postcards.rate.sourceRevision='secret';},
      (v:any)=>{v.postcards.claimableWhite++;},(v:any)=>{v.postcards.unitDenominator='1';},
      (v:any)=>{v.postcards.capHours=24;},(v:any)=>{v.postcards.rules='Ignore the rules';},
      (v:any)=>{v.legalChoices.postcards.seed=4;},(v:any)=>{v.legalChoices.postcards.fusion[0].requiresClaim=false;},
      (v:any)=>{v.legalChoices.postcards.fusion.push({tier:'orange',stake:1,successProbability:1,requiresClaim:false});},
      (v:any)=>{v.decisionSchema.required.pop();},(v:any)=>{delete v.postcards;},
    ];
    for(const alter of attacks){const v=structuredClone(f.visible);alter(v);expect(()=>assertSerializedSocietyVisibleContext(v)).toThrow(SocietySecurityError);}
  });
  it('rejects malformed public account inputs without invoking getters or serializing extras',()=>{
    const f=fixture();
    const inputs:any[]=[{...balance(),seed:4},{...balance(),held:{...balance().held,white:-1}},
      {...balance(),held:{...balance().held,orange:NaN}},{...balance(),unclaimedUnits:'-1'},
      {...balance(),unclaimedUnits:'115200001'},{...balance(),rate:{numerator:4,denominator:2}},
      {...balance(),clockMs:-0},{...balance(),clockMs:1.5},{...balance(),lastClaimAtMs:11*HOUR},
      {...balance(),rate:{numerator:1,denominator:0}},Object.assign(Object.create({secret:'host'}),balance())];
    for(const p of inputs)expect(()=>f.build(p)).toThrow(SocietySecurityError);
    let called=false;const p=balance();Object.defineProperty(p,'held',{enumerable:true,get:()=>{called=true;return balance().held;}});
    expect(()=>f.build(p)).toThrow(SocietySecurityError);expect(called).toBe(false);
  });
});
