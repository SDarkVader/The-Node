import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { verifyOfflineMovementContract } from '../src/society/movementVerification.js';

const output = process.argv[2] ?? 'evals/results/ci/movement-contract.json';
const result = verifyOfflineMovementContract();
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  status: 'verified', format: result.format, seed: result.seed,
  destination: result.finalPosition, steps: result.trace.length,
  modelCalls: result.modelCalls, repeatVerified: result.repeatVerified,
  evidenceDigest: result.evidenceDigest, output,
}, null, 2));
