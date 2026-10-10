import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withRunDirectory } from '../cua/run-directory.js';
import { cleanupRunHistory, readRunHistoryPolicy, runStateFilename } from '../cua/run-history.js';

const now = Date.parse('2026-10-10T12:00:00Z');
const hour = 3600_000;
const policy = { maxBytes: 3000, targetBytes: 1500, minAgeMs: 24 * hour };

async function fixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-run-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function ageTree(directory: string, modifiedAt: number): Promise<void> {
  for (const name of await readdir(directory)) {
    const child = path.join(directory, name);
    const info = await lstat(child);
    if (info.isDirectory() && !info.isSymbolicLink()) await ageTree(child, modifiedAt);
    else if (!info.isSymbolicLink()) await utimes(child, new Date(modifiedAt), new Date(modifiedAt));
  }
  await utimes(directory, new Date(modifiedAt), new Date(modifiedAt));
}

async function runFixture(root: string, id: number, modifiedAt: number, state: unknown = {
  schemaVersion: '1.0', state: 'completed',
}): Promise<string> {
  const directory = path.join(root, `2026-10-01T00-00-00-000Z-${id.toString(16).padStart(8, '0')}`);
  await mkdir(path.join(directory, 'midscene'), { recursive: true });
  await writeFile(path.join(directory, 'midscene', 'report.html'), Buffer.alloc(1000));
  await writeFile(path.join(directory, 'final-screenshot.png'), Buffer.alloc(100));
  if (state !== null) await writeFile(path.join(directory, runStateFilename), JSON.stringify(state));
  await ageTree(directory, modifiedAt);
  return directory;
}

test('运行历史低于空间阈值或禁用清理时不删除', async (t) => {
  const root = await fixture(t);
  const directory = await runFixture(root, 1, now - 48 * hour);
  const result = await cleanupRunHistory({ runsRoot: root, policy, now });
  assert.deepEqual(result.deletedRuns, []);
  assert.ok(result.beforeBytes > 1000);
  const disabled = await cleanupRunHistory({ runsRoot: root, policy: { ...policy, maxBytes: 0 }, now });
  assert.deepEqual(disabled.deletedRuns, []);
  assert.ok((await lstat(directory)).isDirectory());
});

test('运行历史超限时按最旧优先整目录清理至目标，不触碰任务资产', async (t) => {
  const root = await fixture(t);
  const runsRoot = path.join(root, 'runs');
  const first = await runFixture(runsRoot, 1, now - 72 * hour);
  const second = await runFixture(runsRoot, 2, now - 60 * hour, { schemaVersion: '1.0', state: 'failed' });
  const third = await runFixture(runsRoot, 3, now - 48 * hour);
  await mkdir(path.join(root, 'projects', 'scene', 'task'), { recursive: true });
  await writeFile(path.join(root, 'projects', 'scene', 'task', 'task.yaml'), 'durable');
  const result = await cleanupRunHistory({ runsRoot, policy, now });
  assert.deepEqual(result.deletedRuns, [path.basename(first), path.basename(second)]);
  assert.ok(result.afterBytes <= policy.targetBytes);
  assert.deepEqual(await readdir(runsRoot), [path.basename(third)]);
  assert.equal(await readFile(path.join(root, 'projects', 'scene', 'task', 'task.yaml'), 'utf8'), 'durable');
});

test('当前、近期及存活进程中的运行在超限时仍受保护', async (t) => {
  const root = await fixture(t);
  const active = await runFixture(root, 1, now - 72 * hour, {
    schemaVersion: '1.0', state: 'running', pid: process.pid,
  });
  const recent = await runFixture(root, 2, now - hour);
  const current = await runFixture(root, 3, now - 72 * hour);
  const result = await cleanupRunHistory({
    runsRoot: root, policy: { ...policy, maxBytes: 1, targetBytes: 0 }, now,
    protectedRunDirectories: [current],
  });
  assert.deepEqual(result.deletedRuns, []);
  assert.ok(result.afterBytes > policy.maxBytes);
  for (const directory of [active, recent, current]) assert.ok((await lstat(directory)).isDirectory());
});

test('已退出进程的旧运行可清理，未知及损坏状态不删除', async (t) => {
  const root = await fixture(t);
  // An out-of-range PID deterministically reports ESRCH on the supported platforms.
  const dead = await runFixture(root, 1, now - 72 * hour, {
    schemaVersion: '1.0', state: 'running', pid: 2147483647,
  });
  const unknown = await runFixture(root, 2, now - 72 * hour, null);
  const malformed = await runFixture(root, 3, now - 72 * hour);
  await writeFile(path.join(malformed, runStateFilename), '{');
  await writeFile(path.join(malformed, 'execution-result.json'), JSON.stringify({
    status: 'succeeded', finishedAt: new Date(now - 72 * hour).toISOString(),
  }));
  await ageTree(malformed, now - 72 * hour);
  const result = await cleanupRunHistory({ runsRoot: root, policy: { ...policy, maxBytes: 1, targetBytes: 0 }, now });
  assert.deepEqual(result.deletedRuns, [path.basename(dead)]);
  for (const directory of [unknown, malformed]) assert.ok((await lstat(directory)).isDirectory());
});

test('已有 YAML 和原生 aiAct 的成功或失败产物可识别为运行历史', async (t) => {
  const root = await fixture(t);
  for (const [id, filename, status] of [[1, 'execution-result.json', 'succeeded'], [2, 'ai-act-result.json', 'failed']] as const) {
    const directory = await runFixture(root, id, now - 72 * hour, null);
    await writeFile(path.join(directory, filename), JSON.stringify({ status, finishedAt: new Date(now - 72 * hour).toISOString() }));
    await ageTree(directory, now - 72 * hour);
  }
  const result = await cleanupRunHistory({ runsRoot: root, policy: { ...policy, maxBytes: 1, targetBytes: 0 }, now });
  assert.equal(result.deletedRuns.length, 2);
  assert.deepEqual(await readdir(root), []);
});

test('清理拒绝链接根目录并跳过包含链接的运行目录', async (t) => {
  const root = await fixture(t);
  const outside = path.join(root, 'assets');
  await mkdir(outside);
  await writeFile(path.join(outside, 'keep.txt'), 'keep');
  const runsRoot = path.join(root, 'runs');
  const directory = await runFixture(runsRoot, 1, now - 72 * hour);
  await symlink(outside, path.join(directory, 'linked'), 'junction');
  const result = await cleanupRunHistory({ runsRoot, policy: { ...policy, maxBytes: 1, targetBytes: 0 }, now });
  assert.deepEqual(result.deletedRuns, []);
  const linkedRoot = path.join(root, 'linked-runs');
  await symlink(runsRoot, linkedRoot, 'junction');
  await assert.rejects(cleanupRunHistory({ runsRoot: linkedRoot, policy, now }), /regular non-root directory/);
  assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});

test('配置校验及清理错误不改变操作成功或原始异常', async (t) => {
  const root = await fixture(t);
  const previous = process.env.CUA_RUNS_MAX_MB;
  process.env.CUA_RUNS_MAX_MB = 'invalid';
  t.after(() => {
    if (previous === undefined) delete process.env.CUA_RUNS_MAX_MB;
    else process.env.CUA_RUNS_MAX_MB = previous;
  });
  const warnings: unknown[][] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args));
  await assert.rejects(readRunHistoryPolicy(), /non-negative number/);
  let completed = '';
  assert.equal(await withRunDirectory(root, async (directory) => { completed = directory; return 'ok'; }), 'ok');
  assert.equal(JSON.parse(await readFile(path.join(completed, runStateFilename), 'utf8')).state, 'completed');
  const error = new Error('original execution error');
  let failed = '';
  await assert.rejects(withRunDirectory(root, async (directory) => { failed = directory; throw error; }), (actual) => actual === error);
  assert.equal(JSON.parse(await readFile(path.join(failed, runStateFilename), 'utf8')).state, 'failed');
  assert.equal(warnings.length, 4);
});

test('运行入口在开始及结束时自动清理，并保留本次返回的产物', async (t) => {
  const root = await fixture(t);
  const keys = ['CUA_RUNS_MAX_MB', 'CUA_RUNS_TARGET_MB', 'CUA_RUNS_MIN_AGE_HOURS'] as const;
  const previous = keys.map((key) => process.env[key]);
  keys.forEach((key, index) => { process.env[key] = ['0.004', '0.0015', '0'][index]; });
  t.after(() => keys.forEach((key, index) => {
    if (previous[index] === undefined) delete process.env[key];
    else process.env[key] = previous[index];
  }));
  t.mock.method(console, 'warn', () => undefined);
  const old = await runFixture(root, 1, now - 72 * hour);
  const report = await withRunDirectory(root, async (directory) => {
    // At startup this history is still below the threshold.
    assert.ok((await lstat(old)).isDirectory());
    assert.equal(JSON.parse(await readFile(path.join(directory, runStateFilename), 'utf8')).state, 'running');
    const report = path.join(directory, 'report.html');
    await writeFile(report, Buffer.alloc(5000));
    return report;
  });
  await assert.rejects(lstat(old), { code: 'ENOENT' });
  assert.equal((await lstat(report)).size, 5000);
  const anotherOld = await runFixture(root, 2, now - 72 * hour);
  await withRunDirectory(root, async () => {
    // The previous execution is eligible once its minimum protection period is zero.
    await assert.rejects(lstat(anotherOld), { code: 'ENOENT' });
    await assert.rejects(lstat(report), { code: 'ENOENT' });
  });
});
