/** Read and export private evidence. Optional source-pinned journal replay executes only
 * recorded actions locally; it never invokes a policy, provider or accounting operation. */
import { parseArgs } from 'node:util';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readSocietyResults, writeSocietyResults, writeSocietyRawResults } from '../src/society/report.js';
import { parseSocietyEvidence } from '../src/society/codec.js';
import { recoverSocietySubmissions, validateSocietyRecoveryTarget, writeSocietyRecoveryBundle } from '../src/society/submissionRecovery.js';
import type { SocietyRunEvent } from '../src/society/accounted.js';

const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' }, raw: { type: 'boolean', default: false }, recover: {type:'boolean',default:false} } });
if (!values.input || !values.output) throw Error('society_report_input_and_fresh_output_required');
let recovered;
let pinnedEvents:Buffer|undefined;
if(values.recover){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),input=resolve(values.input),output=resolve(values.output);
  if(existsSync(join(input,'society.json')))throw Error('society_recovery_original_tape_exists');
  validateSocietyRecoveryTarget(input,output);
  let ancestor=output;while(!existsSync(ancestor)){const parent=dirname(ancestor);if(parent===ancestor)throw Error('society_recovery_private_output');ancestor=parent;}
  const target=resolve(realpathSync(ancestor),relative(ancestor,output)),rel=relative(realpathSync(root),target);
  if(rel===''||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))throw Error('society_recovery_private_output');
  const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  execFileSync('git',['diff','--quiet','HEAD','--','src','scripts','package.json','package-lock.json'],{cwd:root,windowsHide:true});
  const untracked=execFileSync('git',['ls-files','--others','--exclude-standard','--','src','scripts','package.json','package-lock.json'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  if(untracked)throw Error('society_recovery_untracked_source');
  pinnedEvents=readFileSync(join(input,'events.jsonl'));
  const text=pinnedEvents.toString('utf8'),lines=text.split(/\r?\n/);
  // A torn final line is not a durable submission; retain it in the original evidence.
  if(!text.endsWith('\n'))lines.pop();
  const events=lines.filter(line=>line.trim()).map(line=>parseSocietyEvidence<SocietyRunEvent>(line));
  recovered=recoverSocietySubmissions(events,revision);
}
const report = readSocietyResults(values.input,recovered,pinnedEvents?.toString('utf8'));
const files = values.raw ? writeSocietyRawResults(report, values.output) : writeSocietyResults(report, values.output);
const viewingBundle=recovered?join(files.outputDirectory,'viewing-bundle'):null;
if(recovered&&viewingBundle&&pinnedEvents)writeSocietyRecoveryBundle(values.input,viewingBundle,recovered,pinnedEvents);
console.log(JSON.stringify({ files, counts: report.counts,
  controlled: report.controlled, integrityIssues: report.integrityIssues.length, viewingBundle, providerCalls: 0 }, null, 2));
