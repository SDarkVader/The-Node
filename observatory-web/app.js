/* No provider client, credentials, raw ledger or experiment clock in this browser. */
const $ = id => document.getElementById(id);
let snapshot, timeline = [], stream, selectedCall = '', planLoaded = false, planVersion = 0;
let runGeneration=0, replayTimer=null, embeddedGodot=false, godotRun='';
let agentChosen=false,historyVersion=0,historyKey='';
const base = () => `/observatory/v1/runs/${encodeURIComponent($('run').value)}`;
async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!res.ok) throw Error((await res.json()).error ?? 'Request failed');
  return res.json();
}
function showError(error) { $('connection').textContent = String(error.message ?? error); }
$('login').onsubmit = async event => {
  event.preventDefault();
  try { await api('/session', { method: 'POST', body: JSON.stringify({ token: $('token').value }) }); $('token').value = ''; await loadRuns(); }
  catch { $('login-error').textContent = 'Access denied or server unavailable.'; }
};
async function loadRuns() {
  const runs = await api('/observatory/v1/runs');
  embeddedGodot=(await api('/observatory/v1/capabilities')).godotEmbedded;
  $('login').hidden = true; $('workspace').hidden = false;
  $('run').replaceChildren(...runs.map(r => new Option(`${r.id} · ${r.status}`, r.id)));
  if (runs.length) await openRun();
}
async function openRun() {
  const generation=++runGeneration,route=base();stopReplay();
  agentChosen=false;historyKey='';historyVersion++;
  stream?.close(); planLoaded = false; planVersion++; $('validate').disabled=false; $('plan-status').textContent='';
  const nextTimeline=await api(route+'/timeline'),nextSnapshot=await api(route+'/snapshot');
  if(generation!==runGeneration)return;
  timeline=nextTimeline;render(nextSnapshot);
  if(embeddedGodot&&godotRun!==$('run').value){godotRun=$('run').value;$('godot-world').src='/godot/index.html?run='+encodeURIComponent(godotRun);}
  $('godot-world').hidden=!embeddedGodot;
  $('overview').open=!embeddedGodot;
  $('godot-status').textContent=embeddedGodot?'Godot runs here and follows this run and the shared evidence cursor.':'Godot web export is not configured. Build it with scripts/build-godot-web.ps1 before starting the unified PC test launcher.';
  stream = new EventSource(route + '/events');
  stream.addEventListener('snapshot', event => { if(generation!==runGeneration)return;$('connection').textContent = 'Connected · verified evidence'; render(JSON.parse(event.data)); });
  stream.addEventListener('source_error', () => { $('connection').textContent = 'Evidence unavailable · display frozen'; stream.close(); });
  stream.onerror = () => { $('connection').textContent = 'Disconnected · reconnecting'; };
}
$('run').onchange = () => openRun().catch(showError);
$('reload').onclick = () => loadRuns().catch(showError);
$('logout').onclick = async () => { stream?.close(); await api('/session', { method: 'DELETE' }); location.reload(); };
async function select(cursor) { await api(base() + '/selection', { method: 'PUT', body: JSON.stringify({ cursor }) }); render(await api(base() + '/snapshot')); }
$('timeline').onchange = () => select(timeline[Number($('timeline').value)].cursor).catch(showError);
$('follow').onclick = () => select(null).catch(showError);
$('call').onchange = () => { selectedCall = $('call').value; renderCall(); };
$('agent').onchange=()=>{agentChosen=true;renderCalls();};$('phase').onchange=()=>renderCalls();
$('thinking-scope').onchange=()=>renderThinkingHistory();
$('tick-select').onchange=()=>{stopReplay();select($('tick-select').value||null).catch(showError);};
function recordedTicks(){const points=timeline.filter(p=>p.cursor!=='live'&&Number.isInteger(p.sourceTick));if(points.some(p=>Number.isInteger(p.sourceTurn)))return points;
  const byTick=new Map();for(const p of points)byTick.set(p.sourceTick,p);return [...byTick.values()].sort((a,b)=>a.sourceTick-b.sourceTick);}
function stopReplay(){if(replayTimer)clearInterval(replayTimer);replayTimer=null;$('replay-play').textContent='Play recorded ticks';}
$('replay-play').onclick=()=>{
  if(replayTimer){stopReplay();return;}
  const points=recordedTicks(),generation=runGeneration;let index=Math.max(0,points.findIndex(p=>p.cursor===snapshot.cursor));
  $('replay-play').textContent='Pause replay';let busy=false;
  replayTimer=setInterval(async()=>{if(busy)return;if(generation!==runGeneration||index>=points.length){stopReplay();return;}busy=true;
    try{await select(points[index++].cursor);}catch(error){stopReplay();showError(error);}finally{busy=false;}},700);
};
$('advance').onclick=async()=>{
  const route=base(),current=snapshot;if(!current?.control?.canAdvance)return;$('advance').disabled=true;
  try{await api(route+'/advance',{method:'POST',body:JSON.stringify({cursor:current.cursor,day:current.control.waitingDay,version:current.control.version})});
    if(route===base())render(await api(route+'/snapshot'));
  }catch(error){showError(error);if(route===base())render(await api(route+'/snapshot'));}
};
$('stop').onclick=async()=>{if(!snapshot?.control?.canStop)return;$('stop').disabled=true;try{await api(base()+'/stop',{method:'POST',body:'{}'});}catch(error){showError(error);}};
$('evaluation-refresh').onclick = () => { if (snapshot) render(snapshot); };
function render(s) {
  const previousCursor = snapshot?.cursor;
  const previousActor = snapshot?.calls.find(c => c.requestId === selectedCall)?.actorId;
  snapshot = s;
  $('run-title').textContent = s.experimentId;
  $('mode').textContent = `${s.mode === 'live' ? 'RECORDED PROVIDER EVIDENCE' : s.schema==='node-observatory-society-v1'?'DETERMINISTIC PREVIEW · NO MODEL CALLS':'SYNTHETIC TEST PROVIDER · NO PAID CALLS'} / ${s.following ? 'FOLLOW LATEST' : 'HISTORICAL PLAYBACK'}`;
  $('status').textContent = s.status;
  $('provenance').textContent = `Source ${s.sourceRevision.slice(0, 12)} · world ${s.worldHash.slice(0, 16)} · replay verified through day ${s.sourceTick}`;
  const event = s.timeline?.at(-1);
  $('cursor').textContent = `${event?.type ?? 'evidence'} · ${s.cursor}`;
  $('tick').textContent = Number.isInteger(s.sourceTurn)&&s.sourceTurn>0?`Day ${s.sourceTick+1} · turn ${s.sourceTurn}`:`Day ${s.sourceTick}`;
  $('godot').textContent = `NODE_OBSERVATORY_URL=${location.origin.replace(/^http/, 'ws')}${base()}/world`;
  // The full timeline remains available when browsing an earlier prefix.
  if (s.timeline?.length > timeline.length) timeline = s.timeline;
  $('timeline').max = String(Math.max(0, timeline.length - 1));
  $('timeline').value = String(Math.max(0, timeline.findIndex(p => p.cursor === s.cursor)));
  const m = s.telemetry;
  $('metrics').replaceChildren(...[
    [m.callAttemptCount, 'Recorded requests'], [m.executedDecisionCount, 'Executed decisions'], [m.completedTickCount, 'Committed ticks'],
    [m.inputTokens.toLocaleString(), 'Known input tokens'], [m.bookedMicroUsd===null?'See accounting':(Number(m.bookedMicroUsd)/1e6).toFixed(6), 'USD booked · cursor'], [m.heldMicroUsd===null?'See accounting':(Number(m.heldMicroUsd)/1e6).toFixed(6), 'USD held · cursor']
  ].map(([value,label]) => { const el = document.createElement('div'); el.className='metric'; const v = document.createElement('strong'); v.textContent=value; const l=document.createElement('span'); l.textContent=label; el.append(v,l); return el; }));
  const agents=[...new Set([...(s.society?.controlled??[]),...(s.society?.people??[]).map(p=>p.person),...s.calls.map(c=>c.actorId)])],selectedAgent=$('agent').value;
  $('agent').replaceChildren(new Option('All agents',''),...agents.map(id=>{
    const person=s.society?.people?.find(p=>p.person===id);return new Option(`${id}${person?' · '+(person.role??'roleless'):''}${s.society?.controlled?.includes(id)?' · model':''}`,id);
  }));
  if(agents.includes(selectedAgent))$('agent').value=selectedAgent;
  if(!agentChosen&&s.society?.controlled?.length)$('agent').value=s.society.controlled[0];
  const ticks=recordedTicks();$('tick-select').replaceChildren(new Option('Live / latest',''),...ticks.map(p=>new Option(p.sourceTurn>0?`Day ${p.sourceTick+1} · turn ${p.sourceTurn}`:`World tick ${p.sourceTick}`,p.cursor)));
  $('tick-select').value=s.following?'':s.cursor;
  $('advance').disabled=!s.control?.canAdvance;
  $('stop').disabled=!s.control?.canStop;
  $('control-status').textContent=(!s.following||s.control?.replayOnly)?'Recorded tick · replay is read-only and makes no model calls.':s.control?.waitingDay?`Paused before day ${s.control.waitingDay}. Advance runs one complete day within the approved bounds.`:s.control?.manual?'Day running or run stopped. Further clicks cannot queue extra days.':'Read-only evidence viewer.';
  $('world-data').textContent=JSON.stringify(s.society??s.frame,null,2);
  renderCalls(previousCursor,previousActor);draw(s);
  $('accounting').textContent = JSON.stringify(s.accounting, null, 2);
  renderEvaluationAndPlan(s);
}
function renderCalls(previousCursor=snapshot?.cursor,previousActor){
  const s=snapshot;if(!s)return;
  const visible = s.calls.filter(c => c.tick === s.calls.at(-1)?.tick&&(!$('agent').value||c.actorId===$('agent').value)&&(!$('phase').value||c.phase===$('phase').value));
  $('call').replaceChildren(...visible.map(c => new Option(`${c.actorId} · day ${c.tick} · ${c.phase??'decision'}${Number.isInteger(c.turn)?' · turn '+c.turn:''} · ${c.executed ? 'executed' : c.reasoning.status}`, c.requestId)));
  selectedCall = previousCursor === s.cursor && visible.some(c => c.requestId === selectedCall) ? selectedCall
    : visible.find(c => c.actorId === previousActor)?.requestId ?? visible.at(-1)?.requestId ?? '';
  $('call').value = selectedCall; renderCall();
}
function renderEvaluationAndPlan(s){
  api(base() + '/evaluations?cursor=' + encodeURIComponent(s.cursor)).then(records => {
    if (snapshot.cursor !== s.cursor) return;
    $('evaluations').replaceChildren();
    if (!records.length) { $('evaluations').textContent = 'Not evaluated at this cursor. No reasoning-quality score has been produced.'; return; }
    for (const r of records) { const box=document.createElement('article'); const h=document.createElement('h3'); h.textContent=`${r.producer.name} ${r.producer.version} · ${r.metricId}`; const p=document.createElement('p'); p.textContent=`${r.status}: ${r.value ?? '—'} · through tick ${r.evaluatedThroughTick}`; const d=document.createElement('details'); const summary=document.createElement('summary'); summary.textContent='Definition and provenance'; const pre=document.createElement('pre'); pre.textContent=JSON.stringify(r,null,2); d.append(summary,pre); box.append(h,p,d); $('evaluations').append(box); }
  }).catch(showError);
  if (!planLoaded) {
    planLoaded=true; const version=++planVersion;
    api(base() + '/configuration').then(p => { if(version===planVersion){$('plan').value=JSON.stringify(p.plan,null,2);$('plan-status').textContent='';} }).catch(e=>{if(version===planVersion)showError(e);});
  }
}
function renderCall() {
  const c = snapshot.calls.find(c => c.requestId === selectedCall);
  $('call-status').textContent = c ? `${c.actorId} · source tick ${c.tick} → ${c.nextTick ?? 'uncommitted'} · ${c.latencyMs === null ? 'latency unknown' : Math.round(c.latencyMs)+' ms'} · effects: ${c.effects.join(', ') || 'none recorded'}` : 'No request recorded at this cursor.';
  $('reasoning-source').textContent = c ? `${snapshot.providerReasoning} · ${c.reasoning.status} · ${c.reasoning.source ?? 'response not available'} · summaries shown verbatim` : '';
  $('reasoning').textContent = c?.reasoning.status==='not_a_model'?'Deterministic autonomous policy. No model reasoning exists.':c?.reasoning.summaries.join('\n\n') || 'No reasoning summary is available at this cursor.';
  $('decision').textContent = c ? JSON.stringify({ proposed:c.proposal, admitted:c.admitted, executed:c.executed, usage:c.usage },null,2) : '';
  $('observation').textContent = c ? JSON.stringify(c.observation,null,2) : '';
  $('legal-choices').textContent=c?JSON.stringify(c.legalChoices??null,null,2):'';
  $('raw-record').textContent=c?JSON.stringify(c.rawRecord??{transition:c.transition??null},null,2):'';
  renderThinkingHistory();
}
async function renderThinkingHistory(){
  if(!snapshot)return;
  const scope=$('thinking-scope').value,agent=$('agent').value,phase=$('phase').value,s=snapshot;
  $('reasoning').hidden=scope!=='decision';$('thinking-history').hidden=scope==='decision';
  if(scope==='decision'){historyVersion++;historyKey='';$('thinking-history-status').textContent='Complete thinking text returned for the selected decision; absent/redacted blocks stay marked.';return;}
  const key=[base(),s.cursor,s.evidenceRevision??'',agent,phase,scope].join('|');if(key===historyKey)return;
  historyKey=key;const version=++historyVersion,route=base();
  $('thinking-history-status').textContent='Loading recorded thinking and decisions…';
  try{
    const history=await api(route+'/history?cursor='+encodeURIComponent(s.cursor)+(agent?'&agent='+encodeURIComponent(agent):''));
    if(version!==historyVersion||route!==base())return;
    const latestDay=s.calls.at(-1)?.tick??s.sourceTick;
    const records=history.records.filter(r=>(scope==='full'||r.day===latestDay)&&(!phase||r.phase===phase));
    $('thinking-history').replaceChildren();
    for(const r of records){
      const box=document.createElement('article'),heading=document.createElement('h3'),status=document.createElement('p'),thinking=document.createElement('pre');
      heading.textContent=`${r.agentId} · day ${r.day} · ${r.phase??'decision'}${Number.isInteger(r.turn)?' · turn '+r.turn:''}`;
      status.className='caption';status.textContent=`${r.thinking.source??history.reasoningSource} · ${r.thinking.status} · ${r.executed?'action executed':'not executed'} · ${r.nextTick===null?'day not committed':'world tick '+r.nextTick}`;
      thinking.textContent=r.thinking.status==='not_a_model'?'Deterministic policy; no model thinking.':r.thinking.summaries.join('\n\n')||'No thinking text was returned. Missing or redacted content has not been reconstructed.';
      const details=document.createElement('details'),summary=document.createElement('summary'),facts=document.createElement('pre');
      summary.textContent='Observation, decision and resulting transition';facts.textContent=JSON.stringify({observation:r.observation,legalChoices:r.legalChoices,
        proposed:r.proposed,admitted:r.admitted,executed:r.executed,transition:r.transition,usage:r.usage},null,2);
      details.append(summary,facts);box.append(heading,status,thinking,details);$('thinking-history').append(box);
    }
    $('thinking-history-status').textContent=`${records.length} recorded decisions · ${scope==='full'?'complete history through the selected cursor':'selected tick'} · returned thinking reproduced verbatim, without interpretation.`;
  }catch(error){if(version===historyVersion){historyKey='';$('thinking-history-status').textContent=error.message;}}
}
function draw(s) {
  const canvas=$('map'), ctx=canvas.getContext('2d'), {bounds,buildings,hub}=s.hello;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#0d0a08';ctx.fillRect(0,0,canvas.width,canvas.height);
  const scale=Math.min((canvas.width-70)/(bounds.maxX-bounds.minX+2),(canvas.height-70)/(bounds.maxY-bounds.minY+2));
  const x=v=>35+(v-bounds.minX+1)*scale, y=v=>35+(v-bounds.minY+1)*scale;
  const clamp=v=>Math.max(0,Math.min(1,v)),mix=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*clamp(t)));
  const rgba=(c,a=1)=>`rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const weather=t=>t<=.06?mix([36,91,153],[150,93,40],(t-.03)/.03):mix([150,93,40],[202,53,39],(t-.06)/.04);
  const tensions=new Map((s.frame.districtTension??[]).map(d=>[d.districtId,d.tension]));
  const stations=new Map(s.frame.stations.map(p=>[p.buildingId,p]));
  const colors={baker:'#ff8b51',miller:'#ffd25e',courier:'#50d2bc',investigator:'#f26f9b',importExport:'#b5d96e'};
  for(const p of s.hello.plots){
    const colour=p.kind==='plaza'?[176,144,86]:weather(tensions.get(p.districtId)??.06);
    const gradient=ctx.createLinearGradient(x(p.x)-scale*.5,y(p.y)-scale*.5,x(p.x)+scale*.5,y(p.y)+scale*.5);
    gradient.addColorStop(0,rgba(colour.map(c=>Math.round(c*.83))));gradient.addColorStop(1,rgba(colour.map(c=>Math.round(c*.43))));
    ctx.fillStyle=gradient;ctx.fillRect(x(p.x)-scale*.46,y(p.y)-scale*.46,scale*.92,scale*.92);
  }
  // Same measured heat range and additive falloff as the original 2D visual contract.
  // Neighbouring real heat sources blend across streets instead of colouring isolated boxes.
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(const b of buildings){
    const st=stations.get(b.id);if(!st)continue;const heat=clamp((st.heat??0)/.5);if(heat<=0)continue;
    const brightness={FILLED:1,BACKSTOPPED:.5,VACANT:.28}[st.state]??1,colour=mix([74,107,122],[255,171,62],heat);
    const radius=scale*(1.1+heat*2.1),gradient=ctx.createRadialGradient(x(b.x),y(b.y),0,x(b.x),y(b.y),radius);
    gradient.addColorStop(0,rgba(colour,.52*Math.pow(heat,.95)*brightness));
    gradient.addColorStop(.45,rgba(colour,.22*heat*brightness));gradient.addColorStop(1,rgba(colour,0));
    ctx.fillStyle=gradient;ctx.fillRect(x(b.x)-radius,y(b.y)-radius,radius*2,radius*2);
  }
  const health=s.frame.economicHealth??.909,soul=health>=.909?mix([232,150,74],[255,214,138],(health-.909)/.039):mix([232,150,74],[206,58,40],(.909-health)/.052);
  const wall=ctx.createRadialGradient(x(hub.x),y(hub.y),0,x(hub.x),y(hub.y),scale*2.2);
  wall.addColorStop(0,rgba(soul,.25));wall.addColorStop(1,rgba(soul,0));ctx.fillStyle=wall;
  ctx.fillRect(x(hub.x)-scale*2.2,y(hub.y)-scale*2.2,scale*4.4,scale*4.4);ctx.restore();
  for(const b of buildings){
    const st=stations.get(b.id),heat=clamp((st?.heat??0)/.5),brightness={FILLED:1,BACKSTOPPED:.5,VACANT:.28}[st?.state]??.6;
    ctx.fillStyle=st?rgba(mix([55,76,91],[255,171,62],heat),.65+.35*brightness):'#30291f';
    ctx.fillRect(x(b.x)-scale*.29,y(b.y)-scale*.29,scale*.58,scale*.58);
    ctx.strokeStyle=colors[b.role]??'#77654f';ctx.lineWidth=1.6;ctx.setLineDash(st?.state==='BACKSTOPPED'?[3,3]:[]);
    ctx.strokeRect(x(b.x)-scale*.29,y(b.y)-scale*.29,scale*.58,scale*.58);
  }
  ctx.setLineDash([]);
  for(const p of s.frame.people){
    const colour=colors[p.role]??'#eee3d2',radius=Math.max(3.5,scale*.155);
    ctx.save();ctx.shadowColor=colour;ctx.shadowBlur=scale*.30;ctx.fillStyle=colour;
    ctx.beginPath();ctx.arc(x(p.x),y(p.y),radius,0,Math.PI*2);ctx.fill();ctx.restore();
    ctx.strokeStyle='#100d0b';ctx.lineWidth=1.5;ctx.stroke();
  }
  ctx.strokeStyle='#efdcae';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x(hub.x),y(hub.y),scale*.35,0,Math.PI*2);ctx.stroke();
}
$('plan').oninput=()=>{planVersion++;planLoaded=true;$('validate').disabled=false;$('plan-status').textContent='Edited plan · validate before review';};
$('validate').onclick=async()=>{const version=planVersion,draft=$('plan').value;$('validate').disabled=true;$('plan-status').textContent='Validating…';try{const p=await api('/observatory/v1/configuration/validate',{method:'POST',body:JSON.stringify({plan:JSON.parse(draft)})});if(version===planVersion&&draft===$('plan').value)$('plan-status').textContent=`Valid · SHA-256 ${p.planSha256} · no allowance created`;}catch(e){if(version===planVersion)$('plan-status').textContent=e.message;}finally{if(version===planVersion)$('validate').disabled=false;}};
$('fresh-first-person').onclick=async()=>{const version=++planVersion;planLoaded=true;$('fresh-first-person').disabled=true;$('validate').disabled=true;$('plan-status').textContent='Loading fresh first-person plan…';try{const p=await api('/observatory/v1/configuration/fresh-first-person');if(version===planVersion){$('plan').value=JSON.stringify(p.plan,null,2);$('plan-status').textContent='Fresh first-person plan loaded · pending readiness and approval';}}catch(e){if(version===planVersion)$('plan-status').textContent=e.message;}finally{$('fresh-first-person').disabled=false;if(version===planVersion)$('validate').disabled=false;}};
$('download').onclick=()=>{try{const plan=JSON.parse($('plan').value),data=JSON.stringify(plan,null,2)+'\n';const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));a.download=plan.schema==='node-accounted-perception-fresh-v1'?'first-person-plan.json':'continuation-plan.json';a.click();URL.revokeObjectURL(a.href);}catch{$('plan-status').textContent='Invalid JSON';}};
api('/session').then(s => { if (s.authenticated) return loadRuns(); }).catch(showError);
