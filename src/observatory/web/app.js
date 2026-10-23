// Node Observatory web client (2026-10-23). Read-only: it fetches evidence views, follows the
// shared display cursor and posts only display changes and attributed annotations. Every value
// it shows comes from the observatory API; it computes no score and invents no text.
'use strict';

const API = '/observatory/v1';
const state = { token: null, runs: [], run: null, tick: 0, latest: 0, mode: 'live_following', timeline: [], hello: null,
  frame: null, snapshot: null, telemetry: null, evals: null, notes: [], actor: null, selected: null, stream: null };

function readToken() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('token');
  if (fromHash) { try { sessionStorage.setItem('observatoryToken', fromHash); } catch { /* storage unavailable */ } history.replaceState(null, '', location.pathname); return fromHash; }
  try { return sessionStorage.getItem('observatoryToken'); } catch { return null; }
}
async function api(path, options = {}) {
  const res = await fetch(API + path, { ...options, headers: { authorization: `Bearer ${state.token}`, 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
const $ = id => document.getElementById(id);
const short = h => (h ? String(h).slice(0, 12) : '—');
const fmt = v => (v === null || v === undefined ? 'unknown' : typeof v === 'object' ? JSON.stringify(v) : String(v));
function banner(text) { const b = $('banner'); b.textContent = text; b.hidden = !text; }

async function loadRuns() {
  state.runs = (await api('/runs')).runs;
  const select = $('run');
  select.replaceChildren(...state.runs.map(r => el('option', { value: r.experimentId }, `${r.label}${r.synthetic ? ' (SYNTHETIC)' : ''}`)));
  if (!state.runs.length) { banner('No experiment is registered with this observatory.'); return; }
  await selectRun(state.run && state.runs.some(r => r.experimentId === state.run) ? state.run : state.runs[0].experimentId);
}

async function selectRun(id) {
  state.run = id; $('run').value = id;
  state.hello = await api(`/runs/${encodeURIComponent(id)}/hello`);
  await refreshRun();
  follow();
}

async function refreshRun() {
  const id = encodeURIComponent(state.run);
  const [summary, tl, tel, evals, notes] = await Promise.all([api(`/runs/${id}`), api(`/runs/${id}/timeline`), api(`/runs/${id}/telemetry`), api(`/runs/${id}/evaluations`), api(`/runs/${id}/annotations`)]);
  state.summary = summary; state.timeline = tl.ticks; state.telemetry = tel; state.evals = evals; state.notes = notes.annotations;
  state.latest = summary.verifiedThroughTick; state.mode = summary.display.mode;
  $('tick').max = String(state.latest);
  await showTick(summary.display.tick, false);
  renderChips(); renderMetrics(); renderEvals(); renderNotes(); renderEvidence();
  if (summary.error) banner(`Evidence stopped verifying: ${summary.error}. Showing what had been verified.`); else banner('');
}

async function showTick(tick, publish) {
  const id = encodeURIComponent(state.run);
  if (publish) await api(`/runs/${id}/display`, { method: 'POST', body: JSON.stringify({ mode: 'replay', tick }) });
  state.tick = tick;
  state.snapshot = await api(`/runs/${id}/snapshot?tick=${tick}`);
  state.frame = state.snapshot.frame;
  $('tick').value = String(tick);
  $('tickLabel').textContent = `tick ${tick} of ${state.latest}`;
  $('frameHash').textContent = `world ${short(state.frame.worldHash)} · ${state.frame.segmentId} · ${state.frame.verification}`;
  renderTimeline(); renderShard(); renderActors(); renderEvals(); renderChips();
}

function renderChips() {
  const s = state.summary; if (!s) return;
  const chips = [];
  if (s.synthetic) chips.push(el('span', { class: 'chip synthetic' }, 'SYNTHETIC — TEST-ONLY data'));
  chips.push(el('span', { class: 'chip' + (s.status === 'live_prefix' ? ' live' : '') }, s.status === 'live_prefix' ? 'live prefix' : s.status));
  chips.push(el('span', { class: 'chip' }, state.mode === 'replay' ? `replay · tick ${state.tick}` : 'following latest'));
  chips.push(el('span', { class: 'chip' }, `verified through tick ${s.verifiedThroughTick}`));
  const t = state.telemetry;
  if (t) chips.push(el('span', { class: 'chip' }, `booked ${t.booked_micro_usd_total === null ? 'unknown until stop' : (Number(t.booked_micro_usd_total) / 1e6).toFixed(6) + ' USD'} · held ${t.held_micro_usd_total === null ? 'unknown' : (Number(t.held_micro_usd_total) / 1e6).toFixed(6) + ' USD'}`));
  const rev = [...new Set(s.segments.map(x => x.sourceRevision).filter(Boolean))];
  chips.push(el('span', { class: 'chip mono' }, `runner ${rev.map(short).join(', ')}`));
  $('chips').replaceChildren(...chips);
}

function renderTimeline() {
  const items = state.timeline.map(t => {
    const calls = t.calls.map(c => el('div', { class: 'call' },
      el('div', { class: 'mono' }, c.actorId),
      el('div', {},
        el('span', { class: 'status' }, c.stage), ' ', el('span', { class: 'status' }, `reasoning: ${c.reasoningStatus}`),
        c.executed ? el('span', { class: 'status' }, 'executed') : null,
        c.summaries.length ? c.summaries.map(s => el('div', { class: 'summary' }, el('div', { class: 'label' }, 'provider-returned summary'), s)) : null,
        c.redactedBlocks ? el('div', { class: 'dim small' }, `${c.redactedBlocks} redacted block(s) withheld`) : null,
        el('div', { class: 'dim small mono' }, `proposed ${fmt(c.proposed && c.proposed.role)} · admitted ${c.admitted ? 'yes' : c.stage === 'rejected' ? 'no' : '—'} · ${c.latencyMs === null ? '' : Math.round(c.latencyMs) + ' ms'}`))));
    return el('article', { class: 'tick' + (t.tick === state.tick ? ' selected' : '') + (t.committed ? '' : ' pending'), onclick: () => showTick(Math.min(t.tick, state.latest), true) },
      el('header', {}, el('span', {}, `tick ${t.tick} → ${t.committed ? t.tick + 1 : 'pending'}`),
        el('span', { class: 'mono' }, `${short(t.worldHashBefore)} → ${t.committed ? short(t.worldHashAfter) : 'not committed'}`)),
      calls, t.effects.length ? el('div', { class: 'dim small' }, 'kernel effects: ' + t.effects.map(e => `${e.actorId}:${e.category}`).join(', ')) : null);
  });
  $('timeline').replaceChildren(...(items.length ? items : [el('div', { class: 'dim' }, 'No requests recorded yet.')]));
  $('timeline').querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function renderShard() {
  const c = $('shard'), g = c.getContext('2d'), h = state.hello, f = state.snapshot && state.snapshot.public;
  g.fillStyle = '#0a0806'; g.fillRect(0, 0, c.width, c.height);
  if (!h || !f) return;
  const b = h.bounds, pad = 16, sx = (c.width - 2 * pad) / Math.max(1, b.maxX - b.minX), sy = (c.height - 2 * pad) / Math.max(1, b.maxY - b.minY), s = Math.min(sx, sy);
  const px = (x, y) => [pad + (x - b.minX) * s, pad + (y - b.minY) * s];
  const tension = new Map(f.districtTension.map(d => [d.districtId, d.tension]));
  for (const p of h.plots) { const [x, y] = px(p.x, p.y); g.fillStyle = p.kind === 'plaza' ? '#3a2e1f' : `rgba(${40 + Math.min(1, (tension.get(p.districtId) || 0) / 0.1) * 60},30,20,1)`; g.fillRect(x - s / 2, y - s / 2, s, s); }
  const stations = new Map(f.stations.map(st => [st.buildingId, st]));
  for (const bd of h.buildings) {
    const [x, y] = px(bd.x, bd.y), st = stations.get(bd.id), heat = st ? Math.min(1, st.heat / 0.5) : 0;
    g.fillStyle = st ? `rgb(${74 + heat * 181},${107 + heat * 64},${122 - heat * 60})` : '#2f2822';
    g.globalAlpha = st && st.state !== 'FILLED' ? 0.5 : 1; g.fillRect(x - s * 0.35, y - s * 0.35, s * 0.7, s * 0.7); g.globalAlpha = 1;
  }
  g.fillStyle = '#d9c9b0';
  for (const p of f.people) { const [x, y] = px(p.x, p.y); g.beginPath(); g.arc(x, y, Math.max(1.5, s * 0.12), 0, Math.PI * 2); g.fill(); }
  // Researcher overlay: the controlled actors, from the privileged snapshot.
  g.strokeStyle = '#8fb3c4'; g.lineWidth = 2; g.font = '11px ui-monospace, monospace'; g.fillStyle = '#8fb3c4';
  for (const a of state.snapshot.researcher.actors.filter(a => a.present)) { const [x, y] = px(a.x, a.y); g.beginPath(); g.arc(x, y, Math.max(5, s * 0.4), 0, Math.PI * 2); g.stroke(); g.fillText(a.actorId, x + 7, y - 7); }
  const w = state.snapshot.researcher.world;
  $('shardMeta').textContent = `day ${f.day} · economic health ${Number(f.economicHealth).toFixed(3)} · population ${w.population} · Gini ${Number(w.wealthGini).toFixed(3)} (kernel descriptive statistic) · ${state.frame.cursor}`;
}

async function renderActors() {
  const actors = state.snapshot ? state.snapshot.researcher.actors : [];
  const select = $('actor');
  if (!state.actor || !actors.some(a => a.actorId === state.actor)) state.actor = actors[0] && actors[0].actorId;
  select.replaceChildren(...actors.map(a => el('option', { value: a.actorId }, a.actorId)));
  if (state.actor) select.value = state.actor;
  const a = actors.find(x => x.actorId === state.actor);
  if (!a) { $('actorBody').replaceChildren(el('div', { class: 'dim' }, 'No controlled actor.')); return; }
  const call = (state.timeline.find(t => t.tick === state.tick) || { calls: [] }).calls.find(c => c.actorId === a.actorId);
  const parts = [el('table', {}, el('tbody', {},
    el('tr', {}, el('th', {}, 'present'), el('td', {}, a.present ? 'yes' : 'departed')),
    a.present ? [el('tr', {}, el('th', {}, 'role'), el('td', {}, `${a.role} (epoch ${a.roleEpoch})`)),
      el('tr', {}, el('th', {}, 'position'), el('td', { class: 'mono' }, `${a.x}, ${a.y} · ${a.workplace || 'no workplace'}`)),
      el('tr', {}, el('th', {}, 'wealth · price'), el('td', { class: 'mono' }, `${fmt(a.wealth)} · ${fmt(a.price)}`))] : null))];
  state.selected = null;
  if (call) {
    const d = await api(`/runs/${encodeURIComponent(state.run)}/decisions/${encodeURIComponent(call.requestId)}`);
    state.selected = d;
    parts.push(el('div', { class: 'label' }, `decision at tick ${d.tick} · reasoning ${d.reasoning.status}${d.reasoning.source ? ' · ' + d.reasoning.source : ''}`),
      ...(d.reasoning.summaries.length ? d.reasoning.summaries.map(s => el('div', { class: 'summary' }, s)) : [el('div', { class: 'dim small' }, d.reasoning.status === 'pending' ? 'Response not yet recorded.' : 'No summary text was returned for this call.')]),
      d.reasoning.redactedBlocks ? el('div', { class: 'dim small' }, `${d.reasoning.redactedBlocks} redacted block(s) withheld; signatures are never shown.`) : null,
      el('pre', {}, JSON.stringify({ proposed: d.proposed, admitted: d.admitted, executed: d.executed, stopReason: d.stopReason }, null, 2)));
    try {
      const o = await api(`/runs/${encodeURIComponent(state.run)}/actors/${encodeURIComponent(a.actorId)}/observations?tick=${d.tick}`);
      parts.push(el('details', {}, el('summary', {}, `authorized view at tick ${o.tick} (current at that tick; decoded from the conversation and checked)`), el('pre', {}, JSON.stringify(o.projection, null, 2))),
        el('details', {}, el('summary', {}, `${o.history.length} earlier view(s) in this actor's own transcript (historical, not current)`),
          ...o.history.map(h => el('details', {}, el('summary', {}, `tick ${h.tick} · historical`), el('pre', {}, JSON.stringify(h.projection, null, 2))))));
    } catch (error) { parts.push(el('div', { class: 'dim small' }, `View unavailable: ${error.message}`)); }
  } else parts.push(el('div', { class: 'dim small' }, 'No request from this actor at the selected tick.'));
  $('actorBody').replaceChildren(...parts);
}

function renderMetrics() {
  const t = state.telemetry; if (!t) return;
  const rows = [['calls attempted', t.call_attempt_count], ['known same-model usage', t.known_usage_count], ['other receipts', t.other_receipt_count],
    ['responses without receipt', t.response_without_receipt_count], ['transport failures', t.transport_failure_count], ['pending requests', t.pending_request_count],
    ['validator admissions', t.validator_admission_count], ['validator rejections', t.validator_rejection_count], ['executed decisions', t.executed_decision_count],
    ['completed ticks', t.completed_tick_count], ['final tick', t.final_tick], ['segments', t.segment_count],
    ['latency ms (min / median / max)', `${fmt(t.response_latency_ms.min && Math.round(t.response_latency_ms.min))} / ${fmt(t.response_latency_ms.median && Math.round(t.response_latency_ms.median))} / ${fmt(t.response_latency_ms.max && Math.round(t.response_latency_ms.max))}`],
    ['input / output tokens', `${t.input_tokens} / ${t.output_tokens}`],
    ['booked (runner stop snapshots)', t.booked_micro_usd_total === null ? 'unknown until each grant stops' : `${t.booked_micro_usd_total} µUSD`],
    ['held', t.held_micro_usd_total === null ? 'unknown' : `${t.held_micro_usd_total} µUSD`],
    ['estimated list cost', t.estimated_list_usd.value === null ? 'unknown' : `${t.estimated_list_usd.value} USD (${t.estimated_list_usd.label})`]];
  $('metrics').replaceChildren(...[el('table', {}, el('tbody', {}, rows.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', { class: 'mono' }, fmt(v)))))),
    t.unknown.length ? el('div', { class: 'dim small' }, 'unknown: ' + t.unknown.join(', ')) : null].filter(Boolean));
}

function renderEvals() {
  const e = state.evals; if (!e) return;
  const rows = e.records.map(r => el('tr', { class: r.evaluatedThroughTick < state.tick ? 'stale' : '' },
    el('td', {}, `${r.producer.name} ${r.producer.version}`), el('td', { class: 'mono' }, r.metricId || '—'), el('td', {}, r.scope.actorId || 'all'),
    el('td', { class: 'mono' }, r.status), el('td', { class: 'mono' }, r.value === null ? '—' : String(r.value)),
    el('td', { class: 'mono' }, r.denominator === undefined ? '—' : `${r.numerator}/${r.denominator}`),
    el('td', { class: 'mono' }, `tick ${r.evaluatedThroughTick}`), el('td', { class: 'small' }, r.reason || r.definition || '')));
  $('evals').replaceChildren(
    rows.length ? el('table', { class: 'evalTable' }, el('thead', {}, el('tr', {}, ['producer', 'metric', 'scope', 'status', 'value', 'n / d', 'through', 'definition or reason'].map(h => el('th', {}, h)))), el('tbody', {}, rows))
      : el('div', { class: 'dim' }, 'No framework evaluation has been produced for this run.'),
    el('div', { class: 'dim small' }, 'Rows dimmed: evaluated through an earlier tick than the one selected. ' + (e.rejected ? `${e.rejected} malformed record(s) refused. ` : '')),
    el('div', { class: 'dim small' }, 'not_evaluated: ' + e.notEvaluated.map(m => m.metricId).join(', ') + ' — no declared metric or framework result.'));
}

function renderNotes() {
  $('notes').replaceChildren(...(state.notes.length ? state.notes.map(n => el('div', { class: 'summary' },
    el('div', { class: 'label' }, `${n.author} · ${n.createdAt} · ${n.label}${n.refersTo ? ' · re ' + n.refersTo : ''}`), n.text,
    el('div', { class: 'dim small mono' }, n.evidence.map(r => `${r.segmentId}:${r.seq}${r.actorId ? ' ' + r.actorId : ''}`).join(', ')))) : [el('div', { class: 'dim' }, 'No annotations.')]));
}

function renderEvidence() {
  const s = state.summary; if (!s) return;
  $('evidence').replaceChildren(el('table', {}, el('thead', {}, el('tr', {}, ['segment', 'source', 'events', 'ticks', 'sealed', 'verification', 'root', 'runner revision', 'pinned', 'stop', 'error'].map(h => el('th', {}, h)))),
    el('tbody', {}, s.segments.map(x => el('tr', {}, el('td', { class: 'mono' }, x.segmentId), el('td', {}, x.source), el('td', {}, x.events), el('td', {}, `${fmt(x.startTick)} → ${fmt(x.endTick)}`),
      el('td', {}, x.sealed ? 'yes' : 'no'), el('td', { class: 'mono' }, x.verification), el('td', { class: 'mono' }, x.segmentRoot ? short(x.segmentRoot) : 'none until sealed'),
      el('td', { class: 'mono' }, short(x.sourceRevision)), el('td', {}, x.revisionPinned ? 'yes' : 'no (start event claim)'), el('td', {}, fmt(x.stopStatus)), el('td', {}, x.error || ''))))));
}

async function stream() {
  if (state.stream) state.stream.abort();
  const controller = new AbortController(); state.stream = controller;
  const after = state.summary && state.summary.latestCursor;
  try {
    const res = await fetch(`${API}/runs/${encodeURIComponent(state.run)}/events?stream=1${after ? '&after=' + encodeURIComponent(after) : ''}`, { headers: { authorization: `Bearer ${state.token}` }, signal: controller.signal });
    const reader = res.body.getReader(), decoder = new TextDecoder(); let buffer = '', pending = null;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n'); buffer = blocks.pop();
      for (const block of blocks) {
        if (block.includes('event: slow_client')) { setTimeout(stream, 1000); return; }
        if (block.includes('event: observatory') || block.includes('event: display')) { clearTimeout(pending); pending = setTimeout(() => refreshRun().catch(e => banner(e.message)), 150); }
      }
    }
  } catch (error) { if (error.name === 'AbortError') return; }
  setTimeout(stream, 2000); // reconnect from the latest cursor; nothing is re-requested from any provider
}

async function follow() {
  await api(`/runs/${encodeURIComponent(state.run)}/display`, { method: 'POST', body: JSON.stringify({ mode: 'live_following' }) });
  await refreshRun(); stream();
}

async function main() {
  state.token = readToken();
  if (!state.token) { banner('Open the link the observatory printed (it carries a local access token).'); return; }
  $('run').addEventListener('change', e => selectRun(e.target.value).catch(err => banner(err.message)));
  $('actor').addEventListener('change', e => { state.actor = e.target.value; renderActors(); });
  $('tick').addEventListener('change', e => showTick(Number(e.target.value), true).catch(err => banner(err.message)));
  $('follow').addEventListener('click', () => follow().catch(err => banner(err.message)));
  $('noteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const d = state.selected;
    if (!d) { $('noteStatus').textContent = 'Select an actor with a decision at this tick first.'; return; }
    const ev = (await api(`/runs/${encodeURIComponent(state.run)}/events`)).events.find(x => x.type === 'receipt' && x.requestId === d.requestId) ||
      (await api(`/runs/${encodeURIComponent(state.run)}/events`)).events.find(x => x.type === 'request' && x.requestId === d.requestId);
    try {
      await api(`/runs/${encodeURIComponent(state.run)}/annotations`, { method: 'POST', body: JSON.stringify({ author: $('noteAuthor').value, text: $('noteText').value,
        evidence: [{ segmentId: ev.segmentId, segmentRoot: ev.segmentRoot, seq: ev.seq, eventHash: ev.eventHash }] }) });
      $('noteText').value = ''; $('noteStatus').textContent = 'Saved (append-only).';
      state.notes = (await api(`/runs/${encodeURIComponent(state.run)}/annotations`)).annotations; renderNotes();
    } catch (error) { $('noteStatus').textContent = error.message; }
  });
  try { await loadRuns(); } catch (error) { banner(error.message); }
}
main();
