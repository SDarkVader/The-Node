import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acceptArchive, type ArchiveExpectations } from '../src/observatory/legacy/archiveAcceptance.js';
import { cleanup, root } from './fixtures/accountingFixture.js';
import { registration, stagedRun } from './fixtures/observatoryFixture.js';

const handles: { close(): void }[] = [];
afterEach(() => { for (const h of handles.splice(0)) h.close(); cleanup(); });
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const { stages, budgetDirectory } = await stagedRun(handles), last = stages.at(-1)!;
  const expected: ArchiveExpectations = { uniqueRequests: 8, executedDecisions: 8, completedTicks: 4, finalTick: 4,
    finalWorldHash: last.summary.finalStateHash, bookedMicroUsd: last.summary.bookedMicroUsd,
    heldMicroUsd: last.summary.heldMicroUsd, requestsPerSegment: { 'stage-0': 2, 'stage-1': 4, 'stage-2': 2 },
    segmentRoots: Object.fromEntries(stages.map((s, i) => ['stage-' + i, s.events.at(-1)!.hash])) };
  return { stages, budgetDirectory, reg: registration(stages), journal: join(budgetDirectory, 'accounting.journal.json'), expected };
}

it('accepts the archive, scopes HTTP, binds Godot frames and resumes SSE without touching a live-held accounting lock', async () => {
  const f = await fixture(), files = [f.journal, ...f.stages.map(s => s.path)];
  const before = files.map(p => sha(readFileSync(p))), directory = readdirSync(f.budgetDirectory);
  const result = await acceptArchive(f.reg, f.journal, f.expected);
  expect(result).toMatchObject({ passed: true, modelCalls: 0, evaluationPerformed: false, counts: { requests: 8, ticks: 4, frames: 5 } });
  expect(result.checks).toContain('sse_and_cursor_resume_without_duplicates');
  expect(result.checks).toContain('web_and_godot_same_frame_on_scrub_and_reconnect');
  expect(files.map(p => sha(readFileSync(p)))).toEqual(before);
  expect(readdirSync(f.budgetDirectory)).toEqual(directory); // no lock acquisition or release
  const report = JSON.stringify(result);
  for (const value of [f.journal, f.expected.finalWorldHash, 'TEST-ONLY-signature-', 'observerSecret']) expect(report).not.toContain(value);
});

it.each(['counts', 'deduplication', 'world hash', 'accounting', 'source pin'] as const)('refuses incorrect %s expectations', async kind => {
  const f = await fixture();
  if (kind === 'counts') f.expected.uniqueRequests++;
  if (kind === 'deduplication') f.expected.requestsPerSegment['stage-0'] = 4;
  if (kind === 'world hash') f.expected.finalWorldHash = '0'.repeat(64);
  if (kind === 'accounting') f.expected.bookedMicroUsd = '0';
  if (kind === 'source pin') delete f.reg.segments[0]!.sourceRevision;
  await expect(acceptArchive(f.reg, f.journal, f.expected, { serve: false })).rejects.toThrow(/^observatory_acceptance_/);
});

it.each(['checksum', 'stale history'] as const)('refuses a journal with %s, without repairing it', async kind => {
  const f = await fixture(), envelope = JSON.parse(readFileSync(f.journal, 'utf8'));
  if (kind === 'checksum') envelope.sha256 = '0'.repeat(64);
  else {
    const document = JSON.parse(envelope.payload); document.events.pop();
    envelope.payload = JSON.stringify(document); envelope.sha256 = sha(envelope.payload);
  }
  const copy = join(root(), 'accounting.journal.json'); writeFileSync(copy, JSON.stringify(envelope));
  const before = sha(readFileSync(copy));
  await expect(acceptArchive(f.reg, copy, f.expected, { serve: false })).rejects.toThrow(kind === 'checksum'
    ? 'observatory_acceptance_journal_checksum' : 'observatory_acceptance_journal_history');
  expect(sha(readFileSync(copy))).toBe(before);
});

it('compares journal history canonically rather than requiring one JSON byte layout', async () => {
  const f = await fixture(), envelope = JSON.parse(readFileSync(f.journal, 'utf8'));
  const document = JSON.parse(envelope.payload);
  envelope.payload = JSON.stringify(Object.fromEntries(Object.entries(document).reverse()), null, 2);
  envelope.sha256 = sha(envelope.payload);
  const copy = join(root(), 'accounting.journal.json'); writeFileSync(copy, JSON.stringify(envelope, null, 2));
  expect((await acceptArchive(f.reg, copy, f.expected, { serve: false })).passed).toBe(true);
});
