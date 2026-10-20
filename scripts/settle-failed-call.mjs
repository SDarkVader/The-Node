// Operator disposition of ONE failed call whose cost is unknown (transport failure, timeout,
// HTTP error, missing usage). Books the request's FULL reserved ceiling as a liability so the
// allowance can continue. Never books zero, never refunds. Makes no API request.
// Args: <emitted runtime> <experiment allowance directory> <requestId | outstanding> <operator name> <note>
// `outstanding` settles the single unbooked reservation (at most one can exist), which also covers
// a run killed mid-call before its call log line was written.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 5 || !(/^[a-f0-9]{64}$/.test(args[2]) || args[2] === 'outstanding') || !args[3].trim() || !args[4].trim()) throw Error('explicit_arguments_required');
const [runtime, directory] = args.slice(0, 2).map((x) => resolve(x));
const [, , requested, operator, note] = args;
const { ExperimentBudget } = await import(pathToFileURL(join(runtime, 'agent/experimentBudget.js')).href);
const budget = ExperimentBudget.open(directory);
try {
  const open = budget.view().requests.filter((r) => r.bookedMicroUsd === null && !r.receipt);
  const q = requested === 'outstanding' ? (open.length === 1 ? open[0] : undefined) : budget.view().requests.find((r) => r.request.id === requested);
  if (!q) throw Error(requested === 'outstanding' ? 'no_single_outstanding_request' : 'request_not_found');
  const requestId = q.request.id;
  if (q.receipt) throw Error('request_has_receipt_not_settleable');
  const result = budget.settleUnknown({ requestId, operator, note, settledAt: new Date().toISOString(), basis: 'book_full_reserved_ceiling' });
  const v = budget.view();
  console.log(JSON.stringify({ result, requestId, bookedCeilingMicroUsd: q.ceilingMicroUsd, canReserve: v.canReserve, stopReason: v.stopReason,
    bookedMicroUsd: v.booked.toString(), remainingMicroUsd: v.remainingMicroUsd?.toString() ?? null }, null, 2));
} finally { budget.close(); }
