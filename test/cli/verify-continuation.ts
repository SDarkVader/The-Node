// Fresh-process offline verification from saved evidence alone; no credentials/account writes.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readContinuationLedger, verifyContinuation, continuationInspectSamples } from '../../src/eval/continuationLedger.js';
const [path, sourceRevision, out] = process.argv.slice(2);
if (!path || !/^[a-f0-9]{40}$/.test(sourceRevision ?? '')) throw Error('explicit_verification_arguments_required');
const events = readContinuationLedger(resolve(path));
const result = verifyContinuation(events, sourceRevision!);
if (out) writeFileSync(resolve(out), continuationInspectSamples(events, sourceRevision!).map(x => JSON.stringify(x)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
if (!result.complete) process.exitCode = 2;
