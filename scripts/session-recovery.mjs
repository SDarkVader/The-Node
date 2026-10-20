#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync,
  readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(process.env.NODE_SESSION_RECOVERY_ROOT ?? path.resolve(SCRIPT_DIR, '..'));
const CHECKPOINT_DIR = path.join(DEFAULT_ROOT, '.codex', 'session-recovery');
const CHECKPOINT_FILE = path.join(CHECKPOINT_DIR, 'checkpoint.json');
const CONTINUITY_FILE = path.join(CHECKPOINT_DIR, 'continuity.md');
const SNAPSHOTS_DIR = path.join(CHECKPOINT_DIR, 'snapshots');
const SHARED_CHECKPOINT_FILE = path.join(DEFAULT_ROOT, 'docs', 'recovery', 'CURRENT_SESSION.md');
const VERSION = 1;

function git(args, { cwd = DEFAULT_ROOT, encoding = 'utf8' } = {}) {
  const result = spawnSync('git', args, { cwd, encoding, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed (${result.status}): ${String(result.stderr).trim()}`);
  return result.stdout;
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function atomicWrite(file, bytes) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, bytes, { flag: 'wx' });
  try {
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function repositoryState() {
  const root = path.resolve(git(['rev-parse', '--show-toplevel']).trim());
  const branch = git(['branch', '--show-current'], { cwd: root }).trim();
  const commit = git(['rev-parse', 'HEAD'], { cwd: root }).trim();
  const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, encoding: 'buffer' });
  const staged = git(['diff', '--cached', '--binary', '--full-index'], { cwd: root, encoding: 'buffer' });
  const unstaged = git(['diff', '--binary', '--full-index'], { cwd: root, encoding: 'buffer' });
  const untrackedPaths = git(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'buffer' })
    .toString('utf8').split('\0').filter(Boolean).sort();
  const untracked = untrackedPaths.map((relative) => {
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error('untracked path escapes repository');
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) {
      const link = Buffer.from(readlinkSync(absolute));
      return { path: relative, kind: 'symlink', bytes: Buffer.byteLength(link), sha256: hash(link) };
    }
    if (!info.isFile()) throw new Error(`cannot snapshot non-regular untracked path: ${relative}`);
    const data = readFileSync(absolute);
    return { path: relative, kind: 'file', bytes: data.length, sha256: hash(data) };
  });
  const statusRows = status.toString('utf8').split('\0').filter(Boolean);
  const stateHash = hash(Buffer.concat([
    Buffer.from(branch), Buffer.from([0]), Buffer.from(commit), Buffer.from([0]),
    status, staged, unstaged,
    Buffer.from(JSON.stringify(untracked)),
  ]));
  return {
    root, branch, commit, statusRows, staged, unstaged, untracked,
    statusSha256: hash(status), stagedPatchSha256: hash(staged),
    unstagedPatchSha256: hash(unstaged), stateSha256: stateHash,
  };
}

function loadContinuity() {
  if (existsSync(CONTINUITY_FILE)) return readFileSync(CONTINUITY_FILE, 'utf8').trim();
  if (existsSync(SHARED_CHECKPOINT_FILE)) {
    const text = readFileSync(SHARED_CHECKPOINT_FILE, 'utf8').trim();
    mkdirSync(CHECKPOINT_DIR, { recursive: true });
    writeFileSync(CONTINUITY_FILE, `${text}\n`, { flag: 'wx' });
    return text;
  }
  const seed = path.join(DEFAULT_ROOT, 'docs', 'recovery', 'DEVELOPMENT_SESSION_RECOVERY.md');
  if (!existsSync(seed)) return '## Completed work\n\nNo continuity notes have been recorded yet.\n\n## Test results\n\nNot recorded.\n\n## Unresolved issues\n\nNone recorded.\n\n## Exact next steps\n\n1. Inspect repository state and the current user request.';
  const text = readFileSync(seed, 'utf8').trim();
  mkdirSync(CHECKPOINT_DIR, { recursive: true });
  writeFileSync(CONTINUITY_FILE, `${text}\n`, { flag: 'wx' });
  return text;
}

function snapshot(state) {
  if (!existsSync(CHECKPOINT_DIR)) mkdirSync(CHECKPOINT_DIR, { recursive: true });
  const id = `${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}-${state.stateSha256.slice(0, 12)}`;
  const directory = path.join(SNAPSHOTS_DIR, id);
  if (existsSync(directory)) return id;
  mkdirSync(path.join(directory, 'untracked'), { recursive: true });
  try {
    writeFileSync(path.join(directory, 'staged.patch'), state.staged, { flag: 'wx' });
    writeFileSync(path.join(directory, 'unstaged.patch'), state.unstaged, { flag: 'wx' });
    for (const entry of state.untracked) {
      const source = path.join(state.root, entry.path);
      const destination = path.join(directory, 'untracked', entry.path);
      mkdirSync(path.dirname(destination), { recursive: true });
      const info = lstatSync(source);
      if (info.isSymbolicLink()) {
        const target = readlinkSync(source);
        symlinkSafe(target, destination);
        if (hash(Buffer.from(target)) !== entry.sha256) throw new Error(`untracked symlink changed during checkpoint capture: ${entry.path}`);
      } else {
        copyFileSync(source, destination, 1);
        if (hash(readFileSync(destination)) !== entry.sha256) throw new Error(`untracked file changed during checkpoint capture: ${entry.path}`);
      }
    }
    writeFileSync(path.join(directory, 'snapshot.json'), `${JSON.stringify({
      version: VERSION,
      branch: state.branch,
      commit: state.commit,
      stateSha256: state.stateSha256,
      stagedPatchSha256: state.stagedPatchSha256,
      unstagedPatchSha256: state.unstagedPatchSha256,
      untracked: state.untracked,
      warning: 'Local recovery snapshot only. Review against the current worktree before applying; restoration is never automatic.',
    }, null, 2)}\n`, { flag: 'wx' });
    return id;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function symlinkSafe(target, destination) {
  if (process.platform === 'win32') {
    // The link itself is preserved as metadata where Windows cannot create it without elevation.
    writeFileSync(`${destination}.symlink-target.txt`, target, { flag: 'wx' });
    return;
  }
  symlinkSync(target, destination);
}

function writeCheckpoint(state, snapshotId) {
  const continuity = loadContinuity();
  const checkpoint = {
    format: 'the-node-development-session-checkpoint',
    version: VERSION,
    capturedAt: new Date().toISOString(),
    repository: { root: state.root, branch: state.branch, commit: state.commit },
    worktree: {
      clean: state.statusRows.length === 0,
      status: state.statusRows,
      statusSha256: state.statusSha256,
      stagedPatchSha256: state.stagedPatchSha256,
      unstagedPatchSha256: state.unstagedPatchSha256,
      untracked: state.untracked,
      stateSha256: state.stateSha256,
      snapshot: path.relative(DEFAULT_ROOT, path.join(SNAPSHOTS_DIR, snapshotId)).replaceAll(path.sep, '/'),
    },
    continuity,
  };
  atomicWrite(CHECKPOINT_FILE, `${JSON.stringify(checkpoint, null, 2)}\n`);
  return checkpoint;
}

function readCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) return null;
  const value = JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8'));
  if (value.format !== 'the-node-development-session-checkpoint' || value.version !== VERSION) {
    throw new Error('unsupported or malformed development recovery checkpoint');
  }
  return value;
}

function readSharedCheckpoint() {
  if (!existsSync(SHARED_CHECKPOINT_FILE)) return null;
  const markdown = readFileSync(SHARED_CHECKPOINT_FILE, 'utf8');
  const match = markdown.match(/<!-- NODE_SESSION_CHECKPOINT\s*([\s\S]*?)\s*NODE_SESSION_CHECKPOINT -->/);
  if (!match) throw new Error('tracked session checkpoint metadata is missing or malformed');
  const metadata = JSON.parse(match[1]);
  if (metadata.format !== 'the-node-git-session-checkpoint' || metadata.version !== 1
      || typeof metadata.branch !== 'string' || !/^[0-9a-f]{40}$/i.test(metadata.verifiedBaseCommit)
      || (metadata.reviewBranch !== undefined && (typeof metadata.reviewBranch !== 'string' || !metadata.reviewBranch.trim()))) {
    throw new Error('tracked session checkpoint metadata is unsupported or malformed');
  }
  return { metadata, markdown };
}

function isAncestor(root, ancestor, commit) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, commit], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status === 1) return false;
  if (result.status !== 0) throw new Error(`git merge-base failed (${result.status}): ${String(result.stderr).trim()}`);
  return true;
}

function verify() {
  const previous = readCheckpoint();
  const current = repositoryState();
  if (!previous) {
    const shared = readSharedCheckpoint();
    if (!shared) return { ok: false, reason: 'checkpoint_missing', next: 'Run npm run recovery:capture to create the first local checkpoint.' };
    const branchMatches = shared.metadata.branch === current.branch || shared.metadata.reviewBranch === current.branch;
    const commitDescendsFromAnchor = isAncestor(current.root, shared.metadata.verifiedBaseCommit, current.commit);
    const clean = current.statusRows.length === 0;
    const matches = branchMatches && commitDescendsFromAnchor && clean;
    return {
      ok: matches,
      source: 'git-tracked-checkpoint',
      expected: { branch: shared.metadata.branch,
        ...(shared.metadata.reviewBranch === undefined ? {} : { reviewBranch: shared.metadata.reviewBranch }),
        verifiedBaseCommit: shared.metadata.verifiedBaseCommit },
      actual: { branch: current.branch, commit: current.commit, clean, status: current.statusRows },
      stateMatches: matches,
      notice: matches
        ? 'Tracked checkpoint is present in this branch and the current checkout is its clean descendant.'
        : 'Tracked checkpoint does not match this branch, commit history, or worktree. Inspect both states; no files were restored or overwritten.',
      continuity: shared.markdown,
    };
  }
  const matches = previous.repository.branch === current.branch
    && previous.repository.commit === current.commit
    && previous.worktree.stateSha256 === current.stateSha256;
  return {
    ok: matches,
    expected: previous.repository,
    actual: { branch: current.branch, commit: current.commit, clean: current.statusRows.length === 0, status: current.statusRows },
    checkpointCapturedAt: previous.capturedAt,
    stateMatches: matches,
    notice: matches ? 'Checkpoint matches the current repository state.' : 'Repository differs from the checkpoint. Inspect both states; no files were restored or overwritten.',
    continuity: previous.continuity,
  };
}

function capture() {
  const state = repositoryState();
  const existing = readCheckpoint();
  const id = existing?.worktree?.stateSha256 === state.stateSha256
    && existing?.repository?.branch === state.branch
    && existing?.repository?.commit === state.commit
    ? existing.worktree.snapshot.split('/').at(-1)
    : snapshot(state);
  const afterSnapshot = repositoryState();
  if (afterSnapshot.stateSha256 !== state.stateSha256) {
    throw new Error('repository changed while checkpointing; prior checkpoint was retained, inspect Git and capture again');
  }
  return writeCheckpoint(state, id);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const command = process.argv[2] ?? 'help';
try {
  if (command === 'capture' || command === 'hook-capture') {
    const result = capture();
    if (command === 'hook-capture') {
      print({ saved: true, branch: result.repository.branch, commit: result.repository.commit, clean: result.worktree.clean, snapshot: result.worktree.snapshot });
    } else print(result);
  } else if (command === 'verify') {
    const result = verify();
    print(result);
    if (!result.ok) process.exitCode = 2;
  } else if (command === 'hook-start') {
    const result = verify();
    // A verified clean clone gets its local exact-state checkpoint on startup.
    // A mismatch is left untouched so an older checkpoint cannot be hidden.
    if (result.ok) capture();
    const checkpoint = readCheckpoint();
    const shared = checkpoint ? null : readSharedCheckpoint();
    const message = result.ok
      ? `Verified ${result.source === 'git-tracked-checkpoint' ? 'Git-tracked' : 'local'} development checkpoint and saved a local exact-state snapshot for ${result.actual.branch} at ${result.actual.commit}. Read its recorded completed work, test results, unresolved issues and exact next steps before making changes.\n\n${checkpoint?.continuity ?? shared?.markdown ?? result.continuity}`
      : `Development checkpoint verification needs attention: ${result.reason ?? 'repository_mismatch'}. ${result.next ?? result.notice} Do not restore or overwrite files automatically. Inspect .codex/session-recovery/checkpoint.json and the actual Git state first.`;
    print({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message } });
  } else if (command === 'show') {
    const checkpoint = readCheckpoint();
    if (!checkpoint) throw new Error('checkpoint_missing; run npm run recovery:capture');
    print(checkpoint);
  } else {
    process.stdout.write('Usage: node scripts/session-recovery.mjs {capture|verify|show|hook-start|hook-capture}\n');
  }
} catch (error) {
  process.stderr.write(`session-recovery: ${error.message}\n`);
  process.exitCode = 1;
}
