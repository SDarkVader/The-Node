// Compile the accounted-study runtime from the COMMITTED source. Cross-platform; no API request.
// Args: <NEW runtime output directory>    Prints the commit SHA to pass to run-accounted-study.mjs.
// Refuses to build when source, scripts or manifests have uncommitted changes, so the runtime
// always corresponds exactly to the revision recorded in every episode and report.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 1) throw Error('explicit_arguments_required');
const out = resolve(args[0]);
if (existsSync(out)) throw Error('runtime_directory_must_not_exist');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const dirty = git('status', '--porcelain', '--', 'src', 'scripts', 'evals/manifests', 'evals/contracts', 'package.json', 'package-lock.json');
if (dirty) throw Error('uncommitted_changes_refusing_to_build');
const revision = git('rev-parse', 'HEAD');
mkdirSync(out, { recursive: true, mode: 0o700 });
execFileSync(process.execPath, [join('node_modules', 'typescript', 'bin', 'tsc'), '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
  '--strict', '--noUncheckedIndexedAccess', '--skipLibCheck', '--types', 'node', '--outDir', out, '--rootDir', 'src',
  'src/eval/accountedRunner.ts', 'src/agent/experimentBudget.ts', 'src/agent/isolatedHost.ts', 'src/agent/isolatedHostChild.ts',
  'src/eval/anthropicConnectionCheck.ts'], { stdio: 'inherit' });
writeFileSync(join(out, 'package.json'), '{"type":"module"}\n');
writeFileSync(join(out, 'REVISION'), revision + '\n');
console.log(JSON.stringify({ runtime: out, revision }, null, 2));
