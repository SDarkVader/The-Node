/* No provider client, credentials, raw ledger or experiment clock in this browser. */
const $ = id => document.getElementById(id);
let snapshot, timeline = [], stream, selectedCall = '', planLoaded = false;
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
  $('login').hidden = true; $('workspace').hidden = false;
  $('run').replaceChildren(...runs.map(r => new Option(`${r.id} · ${r.status}`, r.id)));
  if (runs.length) await openRun();
}
async function openRun() {
  stream?.close(); planLoaded = false;
  timeline = await api(base() + '/timeline');
  render(await api(base() + '/snapshot'));
  stream = new EventSource(base() + '/events');
  stream.addEventListener('snapshot', event => { $('connection').textContent = 'Connected · verified evidence'; render(JSON.parse(event.data)); });
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
$('evaluation-refresh').onclick = () => { if (snapshot) render(snapshot); };
function render(s) {
  const previousCursor = snapshot?.cursor;
  const previousActor = snapshot?.calls.find(c => c.requestId === selectedCall)?.actorId;
  snapshot = s;
  $('run-title').textContent = s.experimentId;
  $('mode').textContent = `${s.mode === 'live' ? 'RECORDED PROVIDER EVIDENCE' : 'SYNTHETIC TEST PROVIDER · NO PAID CALLS'} / ${s.following ? 'FOLLOW LATEST' : 'HISTORICAL PLAYBACK'}`;
  $('status').textContent = s.status;
  $('provenance').textContent = `Source ${s.sourceRevision.slice(0, 12)} · world ${s.worldHash.slice(0, 16)} · replay verified through day ${s.sourceTick}`;
  const event = s.timeline?.at(-1);
  $('cursor').textContent = `${event?.type ?? 'evidence'} · ${s.cursor}`;
  $('tick').textContent = `Day ${s.sourceTick}`;
  $('godot').textContent = `NODE_OBSERVATORY_URL=${location.origin.replace(/^http/, 'ws')}${base()}/world`;
  // The full timeline remains available when browsing an earlier prefix.
  if (s.timeline?.length > timeline.length) timeline = s.timeline;
  $('timeline').max = String(Math.max(0, timeline.length - 1));
  $('timeline').value = String(Math.max(0, timeline.findIndex(p => p.cursor === s.cursor)));
  const m = s.telemetry;
  $('metrics').replaceChildren(...[
    [m.callAttemptCount, 'Recorded requests'], [m.executedDecisionCount, 'Executed decisions'], [m.completedTickCount, 'Committed ticks'],
    [m.inputTokens.toLocaleString(), 'Known input tokens'], [(Number(m.bookedMicroUsd)/1e6).toFixed(6), 'USD booked · cursor'], [(Number(m.heldMicroUsd)/1e6).toFixed(6), 'USD held · cursor']
  ].map(([value,label]) => { const el = document.createElement('div'); el.className='metric'; const v = document.createElement('strong'); v.textContent=value; const l=document.createElement('span'); l.textContent=label; el.append(v,l); return el; }));
  const visible = s.calls.filter(c => c.tick === s.calls.at(-1)?.tick);
  $('call').replaceChildren(...visible.map(c => new Option(`${c.actorId} · tick ${c.tick} · ${c.executed ? 'executed' : c.reasoning.status}`, c.requestId)));
  selectedCall = previousCursor === s.cursor && visible.some(c => c.requestId === selectedCall) ? selectedCall
    : visible.find(c => c.actorId === previousActor)?.requestId ?? visible.at(-1)?.requestId ?? '';
  $('call').value = selectedCall; renderCall(); draw(s);
  $('accounting').textContent = JSON.stringify(s.accounting, null, 2);
  api(base() + '/evaluations?cursor=' + encodeURIComponent(s.cursor)).then(records => {
    if (snapshot.cursor !== s.cursor) return;
    $('evaluations').replaceChildren();
    if (!records.length) { $('evaluations').textContent = 'Not evaluated at this cursor. No reasoning-quality score has been produced.'; return; }
    for (const r of records) { const box=document.createElement('article'); const h=document.createElement('h3'); h.textContent=`${r.producer.name} ${r.producer.version} · ${r.metricId}`; const p=document.createElement('p'); p.textContent=`${r.status}: ${r.value ?? '—'} · through tick ${r.evaluatedThroughTick}`; const d=document.createElement('details'); const summary=document.createElement('summary'); summary.textContent='Definition and provenance'; const pre=document.createElement('pre'); pre.textContent=JSON.stringify(r,null,2); d.append(summary,pre); box.append(h,p,d); $('evaluations').append(box); }
  }).catch(showError);
  if (!planLoaded) api(base() + '/configuration').then(p => { $('plan').value=JSON.stringify(p.plan,null,2); planLoaded=true; }).catch(showError);
}
function renderCall() {
  const c = snapshot.calls.find(c => c.requestId === selectedCall);
  $('call-status').textContent = c ? `${c.actorId} · source tick ${c.tick} → ${c.nextTick ?? 'uncommitted'} · ${c.latencyMs === null ? 'latency unknown' : Math.round(c.latencyMs)+' ms'} · effects: ${c.effects.join(', ') || 'none recorded'}` : 'No request recorded at this cursor.';
  $('reasoning-source').textContent = c ? `${snapshot.providerReasoning} · ${c.reasoning.status} · ${c.reasoning.source ?? 'response not available'} · summaries shown verbatim` : '';
  $('reasoning').textContent = c?.reasoning.summaries.join('\n\n') || 'No reasoning summary is available at this cursor.';
  $('decision').textContent = c ? JSON.stringify({ proposed:c.proposal, admitted:c.admitted, executed:c.executed, usage:c.usage },null,2) : '';
  $('observation').textContent = c ? JSON.stringify(c.observation,null,2) : '';
}
function draw(s) {
  const canvas=$('map'), ctx=canvas.getContext('2d'), {bounds,buildings,hub}=s.hello;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const scale=Math.min((canvas.width-70)/(bounds.maxX-bounds.minX+2),(canvas.height-70)/(bounds.maxY-bounds.minY+2));
  const x=v=>35+(v-bounds.minX+1)*scale, y=v=>35+(v-bounds.minY+1)*scale;
  for(const p of s.hello.plots){ctx.fillStyle=p.kind==='plaza'?'#34291a':'#1c1813';ctx.fillRect(x(p.x)-scale*.45,y(p.y)-scale*.45,scale*.9,scale*.9);}
  for(const b of buildings){const station=s.frame.stations.find(p=>p.buildingId===b.id);ctx.fillStyle=station?`hsl(${35-(station.heat??0)*25} 65% ${18+(station.heat??0)*30}%)`:'#30291f';ctx.fillRect(x(b.x)-scale*.3,y(b.y)-scale*.3,scale*.6,scale*.6);}
  const colors={baker:'#e5b55e',miller:'#99bdae',courier:'#afaccb',investigator:'#db8d79',importExport:'#93bdd5'};
  for(const p of s.frame.people){ctx.fillStyle=colors[p.role]??'#eee3d2';ctx.beginPath();ctx.arc(x(p.x),y(p.y),Math.max(2,scale*.13),0,Math.PI*2);ctx.fill();}
  ctx.strokeStyle='#f2c776';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x(hub.x),y(hub.y),scale*.35,0,Math.PI*2);ctx.stroke();
}
$('validate').onclick=async()=>{try{const p=await api('/observatory/v1/configuration/validate',{method:'POST',body:JSON.stringify({plan:JSON.parse($('plan').value)})});$('plan-status').textContent=`Valid · SHA-256 ${p.planSha256} · no allowance created`;}catch(e){$('plan-status').textContent=e.message;}};
$('download').onclick=()=>{try{const data=JSON.stringify(JSON.parse($('plan').value),null,2)+'\n';const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));a.download='continuation-plan.json';a.click();URL.revokeObjectURL(a.href);}catch{$('plan-status').textContent='Invalid JSON';}};
api('/session').then(s => { if (s.authenticated) return loadRuns(); }).catch(showError);
