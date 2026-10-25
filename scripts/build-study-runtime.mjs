// Compile the accounted-study runtime from the COMMITTED source. Cross-platform; no API request.
// Args: <NEW runtime output directory>    Prints the commit SHA to pass to run-accounted-study.mjs.
// Refuses to build when source, scripts or manifests have uncommitted changes, so the runtime
// always corresponds exactly to the revision recorded in every episode and report.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, cpSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 1) throw Error('explicit_arguments_required');
const out = resolve(args[0]);
if (existsSync(out)) throw Error('runtime_directory_must_not_exist');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const dirty = git('status', '--porcelain', '--', 'src', 'scripts', 'client', 'experiments', 'evals/manifests', 'evals/contracts', 'package.json', 'package-lock.json');
if (dirty) throw Error('uncommitted_changes_refusing_to_build');
const revision = git('rev-parse', 'HEAD');
mkdirSync(out, { recursive: true, mode: 0o700 });
execFileSync(process.execPath, [join('node_modules', 'typescript', 'bin', 'tsc'), '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
  '--strict', '--noUncheckedIndexedAccess', '--skipLibCheck', '--types', 'node', '--outDir', out, '--rootDir', 'src',
  'src/eval/accountedRunner.ts', 'src/agent/experimentBudget.ts', 'src/agent/isolatedHost.ts', 'src/agent/isolatedHostChild.ts',
  'src/eval/anthropicConnectionCheck.ts', 'src/eval/continuationRunner.ts', 'src/eval/continuationLedger.ts',
  'src/eval/reasoningAudit.ts', 'src/observatory/freshPerception.ts', 'src/observatory/freshReadiness.ts', 'src/observatory/source.ts'], { stdio: 'inherit' });
// Copy committed assets/configuration, excluding local import caches and private files.
const assets = execFileSync('git', ['ls-files', '-z', 'client', 'experiments', 'scripts'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of assets) { const target = join(out,file); mkdirSync(dirname(target),{recursive:true}); copyFileSync(file,target); }
const lockedWs = JSON.parse(readFileSync('package-lock.json','utf8')).packages['node_modules/ws'];
const installedWs = JSON.parse(readFileSync('node_modules/ws/package.json','utf8'));
if (!lockedWs || installedWs.version !== lockedWs.version) throw Error('runtime_dependency_lock_mismatch');
mkdirSync(join(out,'node_modules'),{recursive:true}); cpSync('node_modules/ws',join(out,'node_modules','ws'),{recursive:true});
writeFileSync(join(out,'DEPENDENCIES.json'),JSON.stringify({ws:{version:lockedWs.version,integrity:lockedWs.integrity}},null,2)+'\n');
writeFileSync(join(out, 'package.json'), JSON.stringify({type:'module',dependencies:{ws:lockedWs.version}})+'\n');
writeFileSync(join(out, 'REVISION'), revision + '\n');
console.log(JSON.stringify({ runtime: out, revision }, null, 2));
