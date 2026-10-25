// Args: <actual private ledger> <NEW private audit output.json>. No network or budget writes.
import { writeFileSync } from 'node:fs';
import { readContinuationLedger } from '../src/eval/continuationLedger.js';
import { auditContinuationReasoning } from '../src/eval/reasoningAudit.js';
const [ledger,output]=process.argv.slice(2);
if(!ledger||!output||process.argv.length!==4)throw Error('explicit_reasoning_audit_arguments_required');
const report=auditContinuationReasoning(readContinuationLedger(ledger));
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({verified:report.verified,finalTick:report.finalTick,actors:report.actors,
  allTicksHaveUniformReasoningConditions:report.ticks.every(t=>t.uniformReasoningConditions),providerCalls:0},null,2));
