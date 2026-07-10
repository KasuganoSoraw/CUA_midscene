import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertAllowedTaskArgs, loadRuntimeInputs, parseTaskArgs } from '../../../src/flow/task/cli-args.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'cua-task-args-'));
try {
  const inputsPath = path.join(root, 'inputs.json');
  await writeFile(inputsPath, JSON.stringify({ from: 'SIN' }), 'utf8');
  const args = parseTaskArgs(['--project', 'air', '--inputs', inputsPath, '--input', 'to=LAX', '--dry-run'], ['dry-run']);
  assertAllowedTaskArgs(args, ['project', 'inputs'], ['dry-run'], true);
  assert.deepEqual(await loadRuntimeInputs(args), { from: 'SIN', to: 'LAX' });

  const duplicate = parseTaskArgs(['--inputs', inputsPath, '--input', 'from=SHA']);
  await assert.rejects(loadRuntimeInputs(duplicate), /输入 from 被重复提供/);
  assert.throws(
    () => assertAllowedTaskArgs(parseTaskArgs(['--unknown', 'value']), ['project'], []),
    /不支持参数 --unknown/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('任务 CLI 参数测试通过');
