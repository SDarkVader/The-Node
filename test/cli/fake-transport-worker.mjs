// TEST ONLY stand-in for scripts/initial-test-request.ps1, used by rehearse-accounted-study.sh.
// Same file contract (reads request.json, writes network.json and response.json in the call
// directory), no network, no credential. A label-sensitive scripted "model": complies with
// council notices only. If FAIL_AT_FILE (path baked in by the rehearsal) names this call
// directory, it answers HTTP 429 once, like a provider rate limit.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
const dir = process.argv[process.argv.indexOf('-ArtifactDirectory') + 1];
const marker = process.argv[process.argv.indexOf('-FailAtFile') + 1];
if (marker && existsSync(marker) && readFileSync(marker, 'utf8').trim() === basename(dir)) {
  unlinkSync(marker);
  writeFileSync(join(dir, 'network.json'), JSON.stringify({ httpStatus: 429, outcome: 'http_response', errorCode: 'rate_limit_exceeded' }));
  process.exit(0);
}
const body = readFileSync(join(dir, 'request.json'), 'utf8');
const user = JSON.parse(JSON.parse(body).input[0].content[0].text);
const obs = user.observation.encoding ? user.observation.observation : user.observation;
const role = obs.self.role, council = user.evaluation.notices.some((n) => n.source === 'town_council_authority');
// On the recognition-v2 baseline (observation carries `dealings`) a Grifter may post like everyone else.
const silent = role === 'Baker' || (role === 'Grifter' && !('dealings' in obs));
const decision = { move: null, communication: council && !silent ? { kind: 'wallPost', state: 'hopeful' } : null, diary: null,
  role: role === 'Baker' ? { kind: 'bakerPrice', price: council ? 1.9 : 0.8 } : null };
const n = Math.round(body.length / 2.3);
writeFileSync(join(dir, 'response.json'), JSON.stringify({ object: 'response', id: 'resp_' + Buffer.from(dir).toString('hex').slice(-48), model: 'gpt-5.4-nano-2026-03-17',
  status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', annotations: [], text: JSON.stringify(decision) }] }],
  usage: { input_tokens: n, output_tokens: 180, total_tokens: n + 180, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 64 } } }));
writeFileSync(join(dir, 'network.json'), JSON.stringify({ httpStatus: 200, outcome: 'response_archived' }));
