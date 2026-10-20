/**
 * Evaluation bridge (2026-10-20, docs/EVAL_INFRASTRUCTURE.md): a JSON-lines process the Inspect
 * AI harness (evals/inspect_node) drives over stdin/stdout. One request per line, one response
 * per line, nothing else on stdout. One episode per process.
 *
 *   {"cmd":"start","scenario":"<id>","sourceRevision":"<git sha>"} → {"ok":true,"prompt":{...}}
 *   {"cmd":"act","output":"<agent text>"}                          → {"ok":true,"verdict":{...},"status":"...","prompt":{...}|null}
 *   {"cmd":"finish"}                                                → {"ok":true,"record":{...}}
 *
 * Multi-actor episodes (owner decision D3; src/eval/multiActorEpisode.ts) use their own commands:
 *
 *   {"cmd":"start_multi","scenario":"<id>","sourceRevision":"<sha>"} → {"ok":true,"prompts":[{actorId,prompt}]}
 *   {"cmd":"act_multi","outputs":{"<actorId>":"<agent text>",...}}  → {"ok":true,"verdicts":{...},"status":"...","prompts":[...]|null}
 *   {"cmd":"classify","record":{...}}                                → {"ok":true,"construct":{...}}  (re-derived from an export)
 *   {"cmd":"contracts"}                                              → {"ok":true,"contracts":[{contract,hash}]}
 *
 * The bridge holds no model, credential or network client: it only runs the kernel on text it is
 * given. Errors come back as {"ok":false,"error":"..."} and never crash the process mid-episode.
 */
import { createInterface } from 'node:readline';
import { EvalEpisode, type EpisodeRecord } from './episode.js';
import { replay, evidenceHash, digest } from '../agent/replay.js';
import { scenarioById, SCENARIOS } from './scenarios.js';
import { MultiActorEpisode, multiScenarioById, MULTI_SCENARIOS } from './multiActorEpisode.js';
import { classifyAuthorityAttribution, contractHash, AUTHORITY_ATTRIBUTION_CONTRACT, type ClassifiableRecord } from './constructs/authorityAttribution.js';

let episode: EvalEpisode | MultiActorEpisode | null = null;
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');

function handle(line: string): unknown {
  // A leading byte-order mark (some Windows shells add one to piped stdin) is not part of the request.
  const request = JSON.parse(line.replace(/^﻿/, '')) as Record<string, unknown>;
  switch (request.cmd) {
    case 'replay': {
      const record = request.record as EpisodeRecord;
      const state = replay(record.tape, record.tape.genesis.sourceRevision);
      return { ok: true, finalStateHash: evidenceHash(state), eventsDigest: digest(record.events) };
    }
    case 'scenarios':
      return { ok: true, scenarios: SCENARIOS, multiScenarios: MULTI_SCENARIOS };
    case 'contracts':
      return { ok: true, contracts: [{ contract: AUTHORITY_ATTRIBUTION_CONTRACT, hash: contractHash() }] };
    case 'classify':
      return { ok: true, construct: classifyAuthorityAttribution(request.record as ClassifiableRecord) };
    case 'start_multi': {
      if (episode) throw Error('episode_already_started');
      if (typeof request.scenario !== 'string' || typeof request.sourceRevision !== 'string') throw Error('invalid_start');
      const multi = new MultiActorEpisode(multiScenarioById(request.scenario), request.sourceRevision);
      episode = multi;
      return { ok: true, prompts: multi.prompts() };
    }
    case 'act_multi': {
      if (!(episode instanceof MultiActorEpisode)) throw Error('no_multi_episode');
      const outputs = request.outputs;
      if (outputs === null || typeof outputs !== 'object' || Array.isArray(outputs)) throw Error('invalid_act');
      const verdicts = episode.act(outputs as Record<string, string>);
      return { ok: true, verdicts, status: episode.status, prompts: episode.done ? null : episode.prompts() };
    }
    case 'start': {
      if (episode) throw Error('episode_already_started');
      if (typeof request.scenario !== 'string' || typeof request.sourceRevision !== 'string') throw Error('invalid_start');
      episode = new EvalEpisode(scenarioById(request.scenario), request.sourceRevision);
      return { ok: true, prompt: episode.prompt() };
    }
    case 'act': {
      if (!(episode instanceof EvalEpisode)) throw Error('no_episode');
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
