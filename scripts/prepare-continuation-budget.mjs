// PAID AUTHORIZATION BOUNDARY. Run only after a separate explicit owner pilot approval.
// Existing closed accounting history is carried unchanged. No calls/credentials here.
// Args: <runtime> <closed prior> <NEW allowance dir> <plan.json> <owner instruction.txt>
//       --authorize-paid-pilot [--from-experiment]
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2);
if (![6, 7].includes(args.length) || args[5] !== '--authorize-paid-pilot' ||
    (args.length === 7 && args[6] !== '--from-experiment')) throw Error('separate_paid_pilot_authorization_required');
const [runtime, prior, directory, planPath, instructionPath] = args.slice(0, 5).map(resolvePath => resolve(resolvePath));
if (existsSync(directory)) throw Error('new_allowance_directory_required');
const load = file => import(pathToFileURL(join(runtime, file)).href);
const { ExperimentBudget } = await load('agent/experimentBudget.js');
const { validateContinuationPlan, continuationPlanHash } = await load('eval/continuationRunner.js');
const { authorizedPrices } = await load('agent/modelPricing.js');
const plan = JSON.parse(readFileSync(planPath, 'utf8')); validateContinuationPlan(plan);
const instruction = readFileSync(instructionPath, 'utf8').trim();
if (!instruction || instruction.length > 8192) throw Error('explicit_owner_instruction_required');
const budget = args[6] === '--from-experiment' ? ExperimentBudget.carryFromExperiment(directory, prior) : ExperimentBudget.carryFromInitial(directory, prior);
try {
  const prices = authorizedPrices(plan.model, budget.carriedPrices());
  if (!prices) throw Error('reviewed_prices_required');
  const now = Date.now(), authorizedAt = new Date(now).toISOString(), expiresAt = new Date(now + plan.allowance.windowHours * 3600000).toISOString();
  const runId = plan.id + '-' + createHash('sha256').update(authorizedAt + directory).digest('hex').slice(0, 12);
  budget.authorize({ runId, authorizedAt, expiresAt, expectedCarriedFingerprint: budget.carriedFingerprint(), instruction,
    scope: 'accounted_experiment_spending_only', manifestSha256: continuationPlanHash(plan), model: plan.model,
    maxRequests: plan.allowance.maxRequests, limitMicroUsd: plan.allowance.limitMicroUsd, perRequestMicroUsd: plan.allowance.perRequestMicroUsd, prices });
  console.log(JSON.stringify({ runId, authorizedAt, expiresAt, planSha256: continuationPlanHash(plan), canReserve: budget.view().canReserve }, null, 2));
} finally { budget.close(); }
