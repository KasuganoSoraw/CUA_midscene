import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyEnvironmentFiles,
  environmentRoot,
  readEnvironmentFiles,
  readEnvironmentValue,
} from '../cua/environment.js';

test('环境配置根是 execution 根的父目录', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-environment-root-'));
  const executionRoot = path.join(root, 'execution');
  await mkdir(executionRoot);

  assert.equal(environmentRoot(executionRoot), root);
});

test('根 env.local 覆盖根 env 且忽略 execution 子目录文件', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-environment-files-'));
  const executionRoot = path.join(root, 'execution');
  await mkdir(executionRoot);
  await writeFile(path.join(root, '.env'), 'SHARED=env\nENV_ONLY=present\n', 'utf8');
  await writeFile(path.join(root, '.env.local'), 'SHARED=local\nLOCAL_ONLY=present\n', 'utf8');
  await writeFile(path.join(executionRoot, '.env.local'), 'SHARED=nested\n', 'utf8');

  assert.deepEqual(readEnvironmentFiles(executionRoot), {
    SHARED: 'local',
    ENV_ONLY: 'present',
    LOCAL_ONLY: 'present',
  });
  assert.deepEqual(await readEnvironmentValue('SHARED', executionRoot), {
    value: 'local',
    source: path.join(root, '.env.local'),
  });
});

test('进程环境优先于根环境文件', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-environment-process-'));
  const executionRoot = path.join(root, 'execution');
  await mkdir(executionRoot);
  await writeFile(path.join(root, '.env.local'), 'CUA_ENV_PRIORITY=file\nCUA_ENV_FILE_ONLY=file\n', 'utf8');
  const previousPriority = process.env.CUA_ENV_PRIORITY;
  const previousFileOnly = process.env.CUA_ENV_FILE_ONLY;
  try {
    process.env.CUA_ENV_PRIORITY = 'process';
    delete process.env.CUA_ENV_FILE_ONLY;
    applyEnvironmentFiles(executionRoot);
    assert.equal(process.env.CUA_ENV_PRIORITY, 'process');
    assert.equal(process.env.CUA_ENV_FILE_ONLY, 'file');
  } finally {
    if (previousPriority === undefined) delete process.env.CUA_ENV_PRIORITY;
    else process.env.CUA_ENV_PRIORITY = previousPriority;
    if (previousFileOnly === undefined) delete process.env.CUA_ENV_FILE_ONLY;
    else process.env.CUA_ENV_FILE_ONLY = previousFileOnly;
  }
});
