/* Researcher view of recorded summaries. All fetches use the existing authenticated local API. */
'use strict';
const thinkingState = { history: null, run: null, request: 0, query: '', status: '', actor: '', from: '', to: '' };

function thinkingPath(format = 'json') {
  const params = new URLSearchParams({ format });
  for (const [key, value] of Object.entries({ summaryKeyword: thinkingState.query, status: thinkingState.status,
    actorId: thinkingState.actor, tickFrom: thinkingState.from, tickTo: thinkingState.to })) {
    if (value !== '') params.set(key, value);
  }
  return `/runs/${encodeURIComponent(state.run)}/thinking-history?${params}`;
}

function thinkingControls() {
  const input = (key, placeholder, type = 'text') => el('input', { type, id: `thinking-${key}`, placeholder, value: thinkingState[key],
    ...(type === 'number' ? { min: 0, step: 1 } : {}),
    oninput: e => { thinkingState[key] = e.target.value; } });
  const form = el('form', { class: 'search-controls', onsubmit: e => { e.preventDefault(); loadThinkingHistory().catch(thinkingError); } },
    input('query', 'Actor, request ID or summary keyword'), input('actor', 'Exact actor ID'),
    input('status', 'Exact reasoning status (optional)'), input('from', 'From tick', 'number'), input('to', 'To tick', 'number'),
    el('button', { type: 'submit' }, 'Apply filters'),
    el('button', { type: 'button', onclick: () => {
      for (const key of ['query', 'status', 'actor', 'from', 'to']) { thinkingState[key] = ''; $(`thinking-${key}`).value = ''; }
      loadThinkingHistory().catch(thinkingError);
    } }, 'Clear filters'),
    ...['json', 'csv', 'markdown'].map(format => el('button', { type: 'button', onclick: () => exportThinking(format).catch(thinkingError) }, `Export ${format.toUpperCase()}`)));
  $('thinkingViewer').replaceChildren(
    el('p', { class: 'dim small' }, 'Recorded provider-returned summaries, verbatim when present. Empty/absent summaries stay labelled. This view does not reconstruct internal thoughts, show a complete signed conversation or grade reasoning.'),
    form, el('div', { id: 'thinkingStats', 'aria-live': 'polite' }), el('div', { id: 'thinkingRecords' }),
    el('p', { class: 'dim small' }, 'Exports stay on this PC. External-model querying is not connected; selecting an evaluator, permitted inputs and accounting is further integration work.'));
}

function thinkingError(error) {
  if ($('thinkingStats')) $('thinkingStats').textContent = `History could not be loaded: ${error.message}`;
  if ($('thinkingRecords')) $('thinkingRecords').replaceChildren();
}

function thinkingObservation(decision) {
  const body = el('div', {}), run = state.run;
  let loaded = false;
  return el('details', { ontoggle: async event => {
    if (!event.currentTarget.open || loaded) return;
    loaded = true; body.textContent = 'Loading the recorded authorized view…';
    try {
      const view = await api(`/runs/${encodeURIComponent(run)}/actors/${encodeURIComponent(decision.actorId)}/observations?tick=${decision.tick}`);
      body.replaceChildren(el('div', { class: 'dim small' }, 'Current at this decision tick; decoded from the actor transcript and checked against its authorized view.'),
        el('pre', {}, JSON.stringify(view.projection, null, 2)),
        ...view.history.map(h => el('details', {}, el('summary', {}, `Remembered view: tick ${h.tick} (historical)`), el('pre', {}, JSON.stringify(h.projection, null, 2)))));
    } catch (error) { body.textContent = `Recorded view unavailable: ${error.message}`; loaded = false; }
  } }, el('summary', {}, 'Authorized observation and remembered views'), body);
}

async function loadThinkingHistory() {
  const serial = ++thinkingState.request, run = state.run;
  $('thinkingStats').textContent = 'Loading recorded history…';
  try {
    const history = await api(thinkingPath());
    if (serial !== thinkingState.request || run !== state.run) return;
    thinkingState.history = history;
    renderThinkingViewer();
  } catch (error) {
    if (serial === thinkingState.request && run === state.run) { thinkingState.history = null; thinkingError(error); }
  }
}

function renderThinkingViewer() {
  const history = thinkingState.history;
  if (!history || thinkingState.run !== state.run || !$('thinkingRecords')) return;
  const s = history.stats;
  $('thinkingStats').textContent = `${s.totalDecisions} decisions · ${s.totalTicks} ticks · admitted ${s.admitted} · rejected ${s.rejected} · admission pending ${s.pendingAdmission} · executed ${s.executed} · reasoning ${JSON.stringify(s.decisionsByStatus)}`;
  $('thinkingRecords').replaceChildren(...history.ticks.map(t => el('details', { class: 'tick-thinking', ...(state.tick === t.tick ? { open: '' } : {}) },
    el('summary', {}, `Tick ${t.tick} → ${t.committed ? t.tick + 1 : 'pending'} · ${t.decisions.length} decisions · ${short(t.worldHash)} → ${short(t.nextWorldHash)}`),
    el('div', { class: 'dim small mono' }, `${t.segmentId} · ${t.verification} · ${t.transitionCursor ?? 'transition not committed'}`),
    ...t.decisions.map(d => el('article', { class: 'decision-card' },
      el('div', { class: 'decision-header mono' }, d.actorId),
      el('div', { class: 'small mono' }, `request ${d.requestId} · evidence ${d.cursor}`),
      el('div', { class: 'small' }, `Reasoning: ${d.status} · stage: ${d.stage} · admission: ${d.admissionStatus} · executed: ${d.executed}`),
      el('div', { class: 'dim small' }, `Source: ${d.reasoning.source ?? 'not recorded'} · latency: ${d.latencyMs ?? 'unknown'} ms · stop: ${d.stopReason ?? 'not recorded'}`),
      el('details', {}, el('summary', {}, 'Proposed / admitted actions'), el('pre', {}, JSON.stringify({ proposed: d.proposed, admitted: d.admitted, actionable: d.actionable }, null, 2))),
      thinkingObservation(d),
      ...d.summaries.map(text => el('div', { class: 'summary' }, text)),
      !d.summaries.length ? el('div', { class: 'dim small' }, `No returned summary text (${d.status}).`) : null,
      el('div', { class: 'dim small' }, `${d.reasoning.redactedBlocks} opaque/redacted blocks · ${d.reasoning.signedBlocks} signed blocks (signature bytes not displayed)`))))));
}

async function exportThinking(format) {
  const run = state.run;
  const result = await api(thinkingPath(format));
  if (run !== state.run) return;
  const content = format === 'json' ? JSON.stringify(result, null, 2) : result.content;
  const extension = format === 'markdown' ? 'md' : format;
  const blob = new Blob([content], { type: format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `thinking-${run.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function initThinkingViewer() {
  if (!state.run || !$('thinkingViewer')) return;
  if (thinkingState.run !== state.run) {
    thinkingState.run = state.run; thinkingState.history = null;
    for (const key of ['query', 'status', 'actor', 'from', 'to']) thinkingState[key] = '';
    thinkingControls();
  }
  await loadThinkingHistory();
}
