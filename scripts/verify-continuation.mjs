// Offline, fresh-process verification from a committed emitted runtime. No key or account writes.
// Args: <runtime> <private continuation.ledger.jsonl> [NEW Inspect sample JSONL]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [runtime, path, out] = process.argv.slice(2).map(x => resolve(x));
if (!runtime || !path) throw Error('explicit_verification_arguments_required');
const { readContinuationLedger, verifyContinuation, continuationInspectSamples } = await import(pathToFileURL(join(runtime, 'eval/continuationLedger.js')).href);
const sourceRevision = readFileSync(join(runtime, 'REVISION'), 'utf8').trim(), events = readContinuationLedger(path);
const result = verifyContinuation(events, sourceRevision);
if (out) writeFileSync(out, continuationInspectSamples(events, sourceRevision).map(x => JSON.stringify(x)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
if (!result.complete) process.exitCode = 2;
