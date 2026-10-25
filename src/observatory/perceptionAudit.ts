/**
 * Independent-worker re-derivation of one immutable perception request. This compares
 * deterministic observations from two separately launched workers before agent delivery.
 * Agreement detects neither a shared implementation bug nor a dishonest declaration of
 * worker identity. The launcher/caller must actually provide separate worker processes.
 * It never re-derives world state, changes actions, or calls a model provider.
 */
import { digest } from '../agent/replay.js';
import { assertPerceptionRecord, type PerceptionRecord, type PerceptionRequest } from './perception.js';

export const PERCEPTION_AUDIT_SCHEMA = 'node-perception-independent-audit-v1' as const;

export interface PerceptionAuditWorker {
  /** Unique process/worker instance identity, declared by the caller, not a model identity. */
  workerId: string;
  perceive(request: PerceptionRequest): Promise<PerceptionRecord>;
}

export interface PerceptionAuditRecord {
  schema: typeof PERCEPTION_AUDIT_SCHEMA;
  status: 'agreement' | 'divergence';
  requestId: string;
  agentId: string;
  tick: number;
  worldHash: string;
  perspective: PerceptionRequest['perspective'];
  requestSha256: string;
  workers: {
    workerId: string;
    engine: PerceptionRecord['engine'];
    responseSha256: string;
    observationSha256: string;
  }[];
}

export class PerceptionAuditMismatch extends Error {
  constructor(readonly audit: PerceptionAuditRecord) {
    super('perception_audit_divergence');
    this.name = 'PerceptionAuditMismatch';
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * A primary subset observation is insufficient: the independent worker must report the
 * exact same canonical observation. A missing visible item therefore fails this gate when
 * the second worker reports it. Neither worker receives the other's request object/output.
 * Input and returned evidence are detached; caller/policy mutation cannot change the audit.
 */
export async function auditPerception(request: PerceptionRequest, primary: PerceptionAuditWorker,
    independent: PerceptionAuditWorker): Promise<{ record: PerceptionRecord; audit: PerceptionAuditRecord }> {
  const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
  if (!primary || !independent || !id(primary.workerId) || !id(independent.workerId) ||
      primary.workerId === independent.workerId || typeof primary.perceive !== 'function' ||
      typeof independent.perceive !== 'function' || primary.perceive === independent.perceive) {
    throw Error('perception_audit_workers_not_independent');
  }
  const snapshot = freeze(structuredClone(request));
  // Capture identities/functions before either callback runs; callbacks cannot rewrite the
  // attribution of the other result by retaining a reference to their descriptor object.
  const workers = [primary, independent].map(worker => ({ workerId: worker.workerId, perceive: worker.perceive }));
  const records = await Promise.all(workers.map(async worker => {
    const result = structuredClone(await worker.perceive(freeze(structuredClone(snapshot))));
    assertPerceptionRecord(snapshot, result);
    return result;
  }));
  const [record, comparison] = records as [PerceptionRecord, PerceptionRecord];
  const observations = records.map(result => digest(result.observation));
  const audit: PerceptionAuditRecord = {
    schema: PERCEPTION_AUDIT_SCHEMA,
    status: observations[0] === observations[1] ? 'agreement' : 'divergence',
    requestId: snapshot.requestId, agentId: snapshot.agentId, tick: snapshot.tick,
    worldHash: snapshot.worldHash, perspective: snapshot.perspective,
    requestSha256: record.requestSha256,
    workers: records.map((result, index) => ({ workerId: workers[index]!.workerId,
      engine: { ...result.engine }, responseSha256: result.responseSha256,
      observationSha256: observations[index]! })),
  };
  // Explicit request comparison also prevents accepting differently serialized input records
  // should the record assertion ever be relaxed independently of this gate.
  if (record.requestSha256 !== comparison.requestSha256) throw Error('perception_audit_request_mismatch');
  if (audit.status === 'divergence') throw new PerceptionAuditMismatch(structuredClone(audit));
  return { record: structuredClone(record), audit: structuredClone(audit) };
}
