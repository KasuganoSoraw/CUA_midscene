import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const executionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(executionRoot, 'executors', 'run-midscene-ai-act.ts');
const tsxCliPath = path.join(executionRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const root = await mkdtemp(path.join(os.tmpdir(), 'cua-ai-act-contract-'));

function run(args: string[]) {
  return spawnSync(process.execPath, [tsxCliPath, runnerPath, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
}

try {
  const promptFile = path.join(root, 'source-prompt.txt');
  const promptResult = path.join(root, 'prompt-run', 'ai-act-result.json');
  await writeFile(promptFile, '打开 Chrome 并搜索 GUI agent\n', 'utf8');
  const direct = run(['--prompt-file', promptFile, '--result', promptResult, '--dry-run']);
  assert.equal(direct.status, 0, direct.stderr);
  assert.match(direct.stderr, /打开 Chrome 并搜索 GUI agent/);
  const directResult = JSON.parse(await readFile(promptResult, 'utf8')) as Record<string, unknown>;
  assert.equal(directResult.status, 'succeeded');
  assert.equal(directResult.mode, 'prompt');
  assert.equal(directResult.dryRun, true);
  assert.equal(await readFile(String(directResult.promptPath), 'utf8'), '打开 Chrome 并搜索 GUI agent\n');

  const flowPath = path.join(
    executionRoot,
    'projects',
    'browser-demo',
    'air-tickets-demo',
    'midscene-flow.json',
  );
  const flow = JSON.parse(await readFile(flowPath, 'utf8')) as Record<string, unknown>;
  const snapshotPath = path.join(root, 'resolved-flow.json');
  await writeFile(
    snapshotPath,
    JSON.stringify({
      schemaVersion: '0.1',
      resolvedAt: new Date().toISOString(),
      flow,
      sources: {
        flowPath,
        taskPath: path.join(path.dirname(flowPath), 'task.json'),
      },
      inputs: {},
    }),
    'utf8',
  );
  const taskResultPath = path.join(root, 'task-run', 'ai-act-result.json');
  const task = run(['--resolved-flow', snapshotPath, '--result', taskResultPath, '--dry-run']);
  assert.equal(task.status, 0, task.stderr);
  const taskResult = JSON.parse(await readFile(taskResultPath, 'utf8')) as Record<string, unknown>;
  assert.equal(taskResult.status, 'succeeded');
  assert.equal(taskResult.mode, 'task');
  assert.equal(taskResult.scene, 'browser-demo');
  assert.equal(taskResult.task, 'air-tickets-demo');

  const invalidResultPath = path.join(root, 'invalid-run', 'ai-act-result.json');
  const invalid = run([
    '--prompt-file',
    promptFile,
    '--resolved-flow',
    snapshotPath,
    '--result',
    invalidResultPath,
    '--dry-run',
  ]);
  assert.notEqual(invalid.status, 0);
  const invalidResult = JSON.parse(await readFile(invalidResultPath, 'utf8')) as Record<string, unknown>;
  assert.equal(invalidResult.status, 'failed');
  assert.match(String(invalidResult.error), /必须且只能提供/);

  const runnerSource = await readFile(runnerPath, 'utf8');
  assert.doesNotMatch(runnerSource, /run-midscene-flow|execute_resolved_flow|flow runner/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('aiAct executor 契约测试通过');
