import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'scripts', 'session-recovery.mjs');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function fixture(t) {
  const parent = fsMkdtemp();
  const root = path.join(parent, 'repo');
  mkdirSync(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Recovery test');
  git(root, 'config', 'user.email', 'recovery@example.invalid');
  writeFileSync(path.join(root, 'tracked.txt'), 'base\n');
  writeFileSync(path.join(root, '.gitignore'), '/.codex/session-recovery/\n');
  git(root, 'add', 'tracked.txt', '.gitignore');
  git(root, 'commit', '-qm', 'initial');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return root;
}

function fsMkdtemp() {
  const parent = fsRealpath(os.tmpdir());
  const root = mkdtempSync(path.join(parent, 'node-session-recovery-'));
  assert.equal(path.dirname(fsRealpath(root)), parent, 'test cleanup target must stay under the OS temp directory');
  return root;
}

function fsRealpath(value) {
  return path.resolve(value);
}

function run(root, command) {
  const result = spawnSync(process.execPath, [cli, command], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_SESSION_RECOVERY_ROOT: root },
    windowsHide: true,
  });
  return result;
}

test('capture preserves staged, unstaged and untracked work and verify matches it', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, 'tracked.txt'), 'staged version\n');
  git(root, 'add', 'tracked.txt');
  writeFileSync(path.join(root, 'tracked.txt'), 'unstaged version\n');
  mkdirSync(path.join(root, 'notes'));
  writeFileSync(path.join(root, 'notes', 'evidence.txt'), 'private local evidence sentinel\n');

  const captured = run(root, 'capture');
  assert.equal(captured.status, 0, captured.stderr);
  const checkpoint = JSON.parse(captured.stdout);
  assert.equal(checkpoint.repository.branch, git(root, 'branch', '--show-current'));
  assert.equal(checkpoint.repository.commit, git(root, 'rev-parse', 'HEAD'));
  assert.equal(checkpoint.worktree.clean, false);
  assert.equal(checkpoint.worktree.untracked.length, 1);
  const snapshot = path.join(root, checkpoint.worktree.snapshot);
  assert.match(readFileSync(path.join(snapshot, 'staged.patch'), 'utf8'), /staged version/);
  assert.match(readFileSync(path.join(snapshot, 'unstaged.patch'), 'utf8'), /unstaged version/);
  assert.equal(readFileSync(path.join(snapshot, 'untracked', 'notes', 'evidence.txt'), 'utf8'), 'private local evidence sentinel\n');

  const verified = run(root, 'verify');
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).stateMatches, true);
  assert.equal(git(root, 'check-ignore', '.codex/session-recovery/checkpoint.json'), '.codex/session-recovery/checkpoint.json');
});

test('verify reports branch, commit or worktree drift and never restores files', (t) => {
  const root = fixture(t);
  assert.equal(run(root, 'capture').status, 0);
  writeFileSync(path.join(root, 'tracked.txt'), 'later local edit\n');
  const before = readFileSync(path.join(root, 'tracked.txt'), 'utf8');
  const verified = run(root, 'verify');
  assert.equal(verified.status, 2);
  assert.equal(JSON.parse(verified.stdout).stateMatches, false);
  assert.equal(readFileSync(path.join(root, 'tracked.txt'), 'utf8'), before);
  assert.match(JSON.parse(verified.stdout).notice, /no files were restored or overwritten/);
});

test('verify detects branch and commit changes independently of worktree contents', (t) => {
  const root = fixture(t);
  assert.equal(run(root, 'capture').status, 0);
  git(root, 'switch', '-qc', 'continuation');
  const branchDrift = run(root, 'verify');
  assert.equal(branchDrift.status, 2);
  assert.equal(JSON.parse(branchDrift.stdout).actual.branch, 'continuation');
  assert.equal(JSON.parse(branchDrift.stdout).actual.commit, JSON.parse(branchDrift.stdout).expected.commit);

  writeFileSync(path.join(root, 'tracked.txt'), 'new commit\n');
  git(root, 'add', 'tracked.txt');
  git(root, 'commit', '-qm', 'new commit');
  const commitDrift = run(root, 'verify');
  assert.equal(commitDrift.status, 2);
  assert.equal(JSON.parse(commitDrift.stdout).actual.branch, 'continuation');
  assert.notEqual(JSON.parse(commitDrift.stdout).actual.commit, JSON.parse(commitDrift.stdout).expected.commit);
});

test('capture retains continuity notes and session-start emits them as context', (t) => {
  const root = fixture(t);
  const local = path.join(root, '.codex', 'session-recovery');
  mkdirSync(local, { recursive: true });
  writeFileSync(path.join(local, 'continuity.md'), 'Completed: recovery CLI.\nTests: 3 passed.\nNext: inspect diff.\n');
  assert.equal(run(root, 'capture').status, 0);
  const start = run(root, 'hook-start');
  assert.equal(start.status, 0, start.stderr);
  const output = JSON.parse(start.stdout).hookSpecificOutput.additionalContext;
  assert.match(output, /Completed: recovery CLI/);
  assert.match(output, /Tests: 3 passed/);
  assert.match(output, /Next: inspect diff/);
});

test('repeated capture reuses the snapshot for identical repository state', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, 'local.txt'), 'untracked\n');
  const first = JSON.parse(run(root, 'capture').stdout);
  const second = JSON.parse(run(root, 'capture').stdout);
  assert.equal(first.worktree.snapshot, second.worktree.snapshot);
  assert.equal(first.worktree.stateSha256, second.worktree.stateSha256);
});

test('a missing checkpoint is reported without initializing or changing the repository', (t) => {
  const root = fixture(t);
  const head = git(root, 'rev-parse', 'HEAD');
  const verification = run(root, 'verify');
  assert.equal(verification.status, 2);
  assert.equal(JSON.parse(verification.stdout).reason, 'checkpoint_missing');
  const start = run(root, 'hook-start');
  assert.equal(start.status, 0);
  assert.match(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, /checkpoint verification needs attention/);
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(root, 'status', '--porcelain'), '');
});

test('a fresh checkout verifies the Git-tracked handover without a local checkpoint', (t) => {
  const root = fixture(t);
  const branch = git(root, 'branch', '--show-current');
  const anchor = git(root, 'rev-parse', 'HEAD');
  const shared = path.join(root, 'docs', 'recovery', 'CURRENT_SESSION.md');
  mkdirSync(path.dirname(shared), { recursive: true });
  const metadata = {
    format: 'the-node-git-session-checkpoint', version: 1, branch,
    verifiedBaseCommit: anchor,
  };
  writeFileSync(shared, `<!-- NODE_SESSION_CHECKPOINT\n${JSON.stringify(metadata)}\nNODE_SESSION_CHECKPOINT -->\n\n# Completed work\nFresh-session test handover.\n`);
  git(root, 'add', 'docs/recovery/CURRENT_SESSION.md');
  git(root, 'commit', '-qm', 'add shared recovery checkpoint');

  const verified = run(root, 'verify');
  assert.equal(verified.status, 0, verified.stderr);
  const result = JSON.parse(verified.stdout);
  assert.equal(result.source, 'git-tracked-checkpoint');
  assert.equal(result.expected.branch, branch);
  assert.equal(result.actual.commit, git(root, 'rev-parse', 'HEAD'));
  assert.match(result.continuity, /Fresh-session test handover/);
  assert.equal(git(root, 'status', '--porcelain'), '');

  const start = JSON.parse(run(root, 'hook-start').stdout).hookSpecificOutput.additionalContext;
  assert.match(start, /Verified Git-tracked development checkpoint/);
  assert.match(start, /saved a local exact-state snapshot/);
  assert.match(start, /Fresh-session test handover/);
  const localCheckpoint = JSON.parse(readFileSync(path.join(root, '.codex', 'session-recovery', 'checkpoint.json'), 'utf8'));
  assert.equal(localCheckpoint.repository.branch, branch);
  assert.equal(localCheckpoint.repository.commit, git(root, 'rev-parse', 'HEAD'));
  assert.equal(localCheckpoint.worktree.clean, true);
});
