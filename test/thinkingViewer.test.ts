/** Exercise the actual client scripts with a small DOM/event harness; no browser or network. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

function harness() {
  const ids = new Map<string, Element>();
  class Element {
    children: Element[] = []; attrs: Record<string, string> = {}; listeners: Record<string, (event: unknown) => unknown> = {};
    value = ''; private text = '';
    constructor(readonly tag: string) {}
    setAttribute(k: string, v: unknown) { this.attrs[k] = String(v); if (k === 'id') ids.set(String(v), this); if (k === 'value') this.value = String(v); }
    addEventListener(k: string, fn: (event: unknown) => unknown) { this.listeners[k] = fn; }
    append(...nodes: Element[]) { this.children.push(...nodes); }
    replaceChildren(...nodes: Element[]) { this.text = ''; this.children = nodes; }
    set textContent(text: string) { this.text = text; this.children = []; }
    get textContent(): string { return this.text + this.children.map(c => c.textContent).join(''); }
  }
  const document = { createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => { const n = new Element('#text'); n.textContent = text; return n; },
    getElementById: (id: string) => ids.get(id) };
  const root = new Element('div'); root.setAttribute('id', 'thinkingViewer');
  const requests: string[] = [];
  const row = (tick: number, text: string) => ({ tick, segmentId: 'TEST-ONLY', committed: true, verification: 'replay_verified', worldHash: 'a'.repeat(64), nextWorldHash: 'b'.repeat(64), transitionCursor: 'segment:8',
    decisions: [{ actorId: 'actor-0', requestId: 'request-' + tick, cursor: 'segment:2', tick, status: 'summary_returned', stage: 'validated', admissionStatus: 'admitted', executed: true, latencyMs: 0, stopReason: 'end_turn', actionable: true,
      proposed: { role: 'Baker', price: 7 }, admitted: { role: 'Baker', price: 7 }, summaries: [text], reasoning: { source: 'anthropic_thinking_summary', redactedBlocks: 0, signedBlocks: 1 } }] });
  const history = { stats: { totalDecisions: 2, totalTicks: 2, admitted: 2, rejected: 0, pendingAdmission: 0, executed: 2, decisionsByStatus: { summary_returned: 2 } },
    ticks: [row(0, '<img src=x onerror=bad()>'), row(1, 'previous reasoning retained')] };
  const context = createContext({ document, Node: Element, URLSearchParams, apiMock: async (path: string) => { requests.push(path); return structuredClone(history); } });
  const app = readFileSync(new URL('../src/observatory/web/app.js', import.meta.url), 'utf8');
  runInContext(app.slice(0, app.indexOf('async function loadRuns()')), context);
  runInContext(readFileSync(new URL('../src/observatory/web/thinkingViewer.js', import.meta.url), 'utf8'), context);
  runInContext("api = apiMock; state.run = 'TEST/ONLY'; state.tick = 0;", context);
  return { ids, requests, history, run: (code: string): unknown => runInContext(code, context) };
}

describe('thinking viewer client integration', () => {
  it('loads the canonical authenticated API, renders returned text literally and preserves filter inputs on tick changes', async () => {
    const h = harness(); await h.run('initThinkingViewer()');
    expect(h.requests).toEqual(['/runs/TEST%2FONLY/thinking-history?format=json']);
    expect(h.ids.get('thinkingRecords')!.textContent).toContain('<img src=x onerror=bad()>');
    expect(h.ids.get('thinkingRecords')!.textContent).toContain('previous reasoning retained');
    expect(h.ids.get('thinkingRecords')!.textContent).toContain('"price": 7');
    const input = h.ids.get('thinking-query')!; input.value = 'retained'; input.listeners.input!({ target: input });
    h.run('state.tick = 1; renderThinkingViewer()');
    expect(h.ids.get('thinking-query')).toBe(input); expect(input.value).toBe('retained');
    await h.run('loadThinkingHistory()');
    expect(h.requests.at(-1)).toContain('summaryKeyword=retained');
    expect(h.ids.get('thinkingStats')!.textContent).toContain('2 decisions');
  });
  it('ignores stale run responses and clears displayed evidence after a load failure', async () => {
    const h = harness(); await h.run('initThinkingViewer()');
    h.run('globalThis.resolveOld = null; api = () => new Promise(resolve => { resolveOld = resolve; });');
    const pending = h.run('loadThinkingHistory()');
    h.run("state.run = 'NEW-RUN'; resolveOld({stats: {totalDecisions: 999}, ticks: []})");
    await pending;
    expect(h.ids.get('thinkingStats')!.textContent).not.toContain('999');
    h.run("state.run = 'TEST/ONLY'; api = async () => { throw new Error('TEST-ONLY failure'); }");
    await h.run('loadThinkingHistory()');
    expect(h.ids.get('thinkingStats')!.textContent).toContain('TEST-ONLY failure');
    expect(h.ids.get('thinkingRecords')!.children).toHaveLength(0);
    expect(h.run('thinkingState.history')).toBeNull();
  });
  it('gets the exact original actor/tick observation only when expanded; labels prior views historical', async () => {
    const h = harness(); await h.run('initThinkingViewer()');
    h.run("globalThis.observationPath = ''; api = async path => { observationPath = path; return {projection: {tick: 1}, history:[{tick:0, projection:{tick:0}}]}; }; globalThis.observationNode = thinkingObservation({actorId:'actor/0', tick:1});");
    expect(h.run('observationPath')).toBe('');
    await h.run('observationNode.listeners.toggle({currentTarget: {open:true}})');
    expect(h.run('observationPath')).toBe('/runs/TEST%2FONLY/actors/actor%2F0/observations?tick=1');
    expect(h.run('observationNode.textContent')).toContain('Remembered view: tick 0 (historical)');
  });
});
