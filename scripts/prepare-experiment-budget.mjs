// Create and authorise a NEW experiment allowance that carries a closed prior allowance forward.
// Explicit, one-shot. Makes no API request and reads no credential.
// Args: <emitted runtime> <closed prior allowance directory> <NEW allowance directory> <study manifest .json> <instruction .txt>
//   [--from-experiment]   the prior directory is an experiment allowance rather than the initial test allowance
// The instruction file holds the owner's own authorisation words; it is stored inside the allowance.
// Rates: the carried allowance's own when the manifest names the same model, otherwise only the
// reviewed entry in src/agent/modelPricing.ts (owner decision D11: claude-haiku-5-5). Never typed in.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const fromExperiment = args[5] === '--from-experiment';
if (![5, 6].includes(args.length) || (args.length === 6 && !fromExperiment)) throw Error('explicit_arguments_required');
const [runtime, priorDirectory, directory, manifestPath, instructionPath] = args.slice(0, 5).map((x) => resolve(x));
if (existsSync(directory)) throw Error('new_allowance_directory_must_not_exist');
const load = (file) => import(pathToFileURL(join(runtime, file)).href);
const { ExperimentBudget } = await load('agent/experimentBudget.js');
const { validateManifest, manifestSha256 } = await load('eval/accountedRunner.js');
const { authorizedPrices } = await load('agent/modelPricing.js');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
validateManifest(manifest);
const instruction = readFileSync(instructionPath, 'utf8').trim();
if (!instruction) throw Error('instruction_required');

const budget = fromExperiment ? ExperimentBudget.carryFromExperiment(directory, priorDirectory) : ExperimentBudget.carryFromInitial(directory, priorDirectory);
try {
  const carriedPrices = budget.carriedPrices();
  if (!carriedPrices) throw Error('carried_allowance_has_no_rate_evidence');
  const prices = authorizedPrices(manifest.model, carriedPrices);
  if (!prices) throw Error('no_reviewed_price_for_manifest_model');
  const now = new Date();
  const authorizedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + manifest.allowance.windowHours * 3_600_000).toISOString();
  const runId = `${manifest.id}-${createHash('sha256').update(authorizedAt + directory).digest('hex').slice(0, 12)}`;
  budget.authorize({ runId, authorizedAt, expiresAt, expectedCarriedFingerprint: budget.carriedFingerprint(), instruction,
    scope: 'accounted_experiment_spending_only', manifestSha256: manifestSha256(manifest), model: manifest.model,
    maxRequests: manifest.allowance.maxRequests, limitMicroUsd: manifest.allowance.limitMicroUsd, perRequestMicroUsd: manifest.allowance.perRequestMicroUsd, prices });
  const v = budget.view();
  console.log(JSON.stringify({ directory, runId, authorizedAt, expiresAt, model: manifest.model, manifestSha256: manifestSha256(manifest),
    maxRequests: manifest.allowance.maxRequests, limitUsd: manifest.allowance.limitMicroUsd / 1e6, prices, carried: v.carried, canReserve: v.canReserve }, null, 2));
} finally { budget.close(); }
