/** Read-only validation of an existing accounting journal. No writer or allowance creation. */
import { sha256 } from '../agent/accountingStore.js';
import { ExperimentBudget } from '../agent/experimentBudget.js';

export function inspectSocietyFunding(bytes:Buffer):ReturnType<typeof ExperimentBudget.inspect> {
  if(!Buffer.isBuffer(bytes)||bytes.length>8*1024*1024)throw Error('society_journal_bounds');
  const envelope=JSON.parse(bytes.toString('utf8'));
  if(!envelope||Object.keys(envelope).sort().join(',')!=='format,payload,sha256'||
    envelope.format!=='node-accounting-journal-v1'||typeof envelope.payload!=='string'||
    sha256(envelope.payload)!==envelope.sha256)throw Error('society_journal_checksum');
  return ExperimentBudget.inspect(JSON.parse(envelope.payload));
}
