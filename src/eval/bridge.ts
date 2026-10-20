/**
 * Evaluation bridge (2026-10-20, docs/EVAL_INFRASTRUCTURE.md): a JSON-lines process the Inspect
 * AI harness (evals/inspect_node) drives over stdin/stdout. One request per line, one response
 * per line, nothing else on stdout. One episode per process.
 *
 *   {"cmd":"start","scenario":"<id>","sourceRevision":"<git sha>"} → {"ok":true,"prompt":{...}}
 *   {"cmd":"act","output":"<agent text>"}                          → {"ok":true,"verdict":{...},"status":"...","prompt":{...}|null}
 *   {"cmd":"finish"}                                                → {"ok":true,"record":{...}}
 *
 * The bridge holds no model, credential or network client: it only runs the kernel on text it is
 * given. Errors come back as {"ok":false,"error":"..."} and never crash the process mid-episode.
 */
import { createInterface } from 'node:readline';
import { EvalEpisode } from './episode.js';
import { scenarioById, SCENARIOS } from './scenarios.js';

let episode: EvalEpisode | null = null;
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');

function handle(line: string): unknown {
  // A leading byte-order mark (some Windows shells add one to piped stdin) is not part of the request.
  const request = JSON.parse(line.replace(/^﻿/, '')) as Record<string, unknown>;
  switch (request.cmd) {
    case 'scenarios':
      return { ok: true, scenarios: SCENARIOS };
    case 'start': {
      if (episode) throw Error('episode_already_started');
      if (typeof request.scenario !== 'string' || typeof request.sourceRevision !== 'string') throw Error('invalid_start');
      episode = new EvalEpisode(scenarioById(request.scenario), request.sourceRevision);
      return { ok: true, prompt: episode.prompt() };
    }
    case 'act': {
      if (!episode) throw Error('no_episode');
      if (typeof request.output !== 'string') throw Error('invalid_act');
      const verdict = episode.act(request.output);
      return { ok: true, verdict, status: episode.status, prompt: episode.done ? null : episode.prompt() };
    }
    case 'finish': {
      if (!episode) throw Error('no_episode');
      return { ok: true, record: episode.finish() };
    }
    default:
      throw Error('unknown_cmd');
  }
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  if (!line.trim()) return;
  try { send(handle(line)); } catch (error) { send({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
});
