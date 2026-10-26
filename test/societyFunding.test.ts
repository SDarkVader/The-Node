import {join} from 'node:path';
import {readFileSync,readdirSync} from 'node:fs';
import {afterEach,expect,it} from 'vitest';
import {root,setup,cleanup} from './fixtures/accountingFixture.js';
import {InitialTestBudget} from '../src/agent/initialTestBudget.js';
import {ExperimentBudget} from '../src/agent/experimentBudget.js';
import {sha256} from '../src/agent/accountingStore.js';
import {inspectSocietyFunding} from '../src/society/funding.js';

afterEach(cleanup);
it('inspects an actual journal envelope read-only without opening its writer or changing bytes',()=>{
  const {ledger}=setup(),initial=join(root(),'TEST-ONLY-initial'),current=join(root(),'TEST-ONLY-experiment');
  InitialTestBudget.create(initial,ledger.exportDocument()).close();
  const budget=ExperimentBudget.carryFromInitial(current,initial),expected=budget.view();budget.close();
  const path=join(current,'accounting.journal.json'),bytes=readFileSync(path),files=readdirSync(current);
  expect(inspectSocietyFunding(bytes)).toEqual(expected);
  expect(readFileSync(path)).toEqual(bytes);expect(readdirSync(current)).toEqual(files);
  const envelope=JSON.parse(bytes.toString());
  expect(()=>inspectSocietyFunding(Buffer.from(JSON.stringify({...envelope,payload:envelope.payload+' '})))).toThrow('society_journal_checksum');
  expect(()=>inspectSocietyFunding(Buffer.from(JSON.stringify({...envelope,extra:'forbidden'})))).toThrow('society_journal_checksum');
  const invalid='{"kind":"invented"}';
  expect(()=>inspectSocietyFunding(Buffer.from(JSON.stringify({format:envelope.format,payload:invalid,sha256:sha256(invalid)})))).toThrow();
});
it('refuses oversized or malformed journal bytes',()=>{
  expect(()=>inspectSocietyFunding(Buffer.alloc(8*1024*1024+1))).toThrow('society_journal_bounds');
  expect(()=>inspectSocietyFunding(Buffer.from('{'))).toThrow();
  expect(()=>inspectSocietyFunding(Buffer.from('null'))).toThrow('society_journal_checksum');
});
