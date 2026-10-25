// Separate opt-in counted-input transport. Fixed Anthropic endpoints; one POST and no retries.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAnthropicWorker } from './anthropic-request.mjs';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [keyPath, directory, limit, endpoint] = process.argv.slice(2);
  if (!keyPath || !directory || !limit || !['messages', 'count_tokens'].includes(endpoint) || process.argv.length !== 6)
    throw Error('explicit_perception_worker_arguments_required');
  await runAnthropicWorker({ keyPath: resolve(keyPath), directory: resolve(directory), maxRequestBytes: Number(limit),
    profile: 'counted_100k_input_v1', endpoint });
}
