import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const executionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(executionRoot, 'executors', 'run-midscene-flow.ts');
const tsxCliPath = path.join(executionRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const root = await mkdtemp(path.join(os.tmpdir(), 'cua-resolved-contract-'));

try {
  const snapshotPath = path.join(root, 'invalid-resolved-flow.json');
  const resultPath = path.join(root, 'execution-result.json');
  await writeFile(snapshotPath, JSON.stringify({ schemaVersion: '0.1' }), 'utf8');
  const completed = spawnSync(
    process.execPath,
    [tsxCliPath, runnerPath, '--resolved-flow', snapshotPath, '--result', resultPath, '--dry-run'],
    { encoding: 'utf8' },
  );
  assert.notEqual(completed.status, 0);
  const result = JSON.parse(await readFile(resultPath, 'utf8')) as { status: string; error?: string };
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /resolved flow 契约校验失败/);

  const runnerSource = await readFile(runnerPath, 'utf8');
  assert.doesNotMatch(runnerSource, /project\.json|flow-overrides\.json|resolveProjectFlow/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('resolved flow 执行契约测试通过');
