import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { spawn } from 'node:child_process';
import {
  createTaskFromRecording,
  resolveRecordRoot,
  runRecordingParser,
  type RecorderRunRequest,
} from '../../cua/recording/create-task.js';
import { readTaskManifest } from '../../cua/contracts/validation.js';
import { readYamlDocument } from '../../cua/task/yaml-task.js';

async function exists(sourcePath: string): Promise<boolean> {
  try {
    await stat(sourcePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function validRecordRoot(root: string): Promise<string> {
  await mkdir(path.join(root, 'Aloha_Learn'), { recursive: true });
  await writeFile(path.join(root, 'pyproject.toml'), '[project]\nname="test"\nversion="0.0.0"\n', 'utf8');
  await writeFile(path.join(root, 'Aloha_Learn', 'parser.py'), '# test parser\n', 'utf8');
  return root;
}

async function fixture(): Promise<{
  root: string;
  recordRoot: string;
  recordingPath: string;
  builtinProjectsRoot: string;
  userProjectsRoot: string;
  runsRoot: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-recording-create-'));
  const recordRoot = await validRecordRoot(path.join(root, 'record'));
  const recordingPath = path.join(root, 'recording-demo');
  const builtinProjectsRoot = path.join(root, 'builtin');
  const userProjectsRoot = path.join(root, 'data', 'projects');
  const runsRoot = path.join(root, 'data', 'runs');
  await Promise.all([
    mkdir(path.join(recordingPath, 'inputs'), { recursive: true }),
    mkdir(builtinProjectsRoot, { recursive: true }),
    mkdir(userProjectsRoot, { recursive: true }),
    mkdir(runsRoot, { recursive: true }),
  ]);
  await writeFile(path.join(recordingPath, 'inputs', 'record.txt'), 'CONFIG\n', 'utf8');
  return { root, recordRoot, recordingPath, builtinProjectsRoot, userProjectsRoot, runsRoot };
}

async function writeGeneratedRecording(
  request: RecorderRunRequest,
  options: { escapedScreenshot?: boolean } = {},
): Promise<void> {
  const name = path.basename(request.recordingPath);
  const screenshots = path.join(request.recordingPath, 'screenshots');
  await mkdir(screenshots, { recursive: true });
  await writeFile(
    path.join(request.recordingPath, `${name}_trace.json`),
    JSON.stringify({
      trajectory: [{
        step_idx: 1,
        caption: {
          operation: {
            type: 'click',
            prompt: '点击页面右上角无文字设置图标',
            useReferenceImage: true,
          },
        },
      }],
    }),
    'utf8',
  );
  await writeFile(
    path.join(request.recordingPath, `${name}_processed_log.json`),
    JSON.stringify([{ timestamp: 1 }]),
    'utf8',
  );
  await writeFile(
    path.join(request.recordingPath, `${name}_processed_log_sc.json`),
    JSON.stringify([{
      timestamp: 1,
      screenshot_full: 'screenshots/1.jpg',
      screenshot_crop: 'screenshots/1.crop.jpg',
      screenshot_reference: options.escapedScreenshot
        ? '../outside.png'
        : 'screenshots/1.reference.png',
    }]),
    'utf8',
  );
  await Promise.all([
    writeFile(path.join(screenshots, '1.jpg'), 'full', 'utf8'),
    writeFile(path.join(screenshots, '1.crop.jpg'), 'crop', 'utf8'),
    writeFile(path.join(screenshots, '1.reference.png'), 'reference', 'utf8'),
    writeFile(path.join(screenshots, 'stale.jpg'), 'stale', 'utf8'),
  ]);
}

test('录制后处理器根遵循显式、进程、env.local、env 和源码相邻目录优先级', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-record-root-'));
  const executionRoot = path.join(root, 'execution');
  const explicit = await validRecordRoot(path.join(root, 'explicit'));
  const processRoot = await validRecordRoot(path.join(root, 'process'));
  const localRoot = await validRecordRoot(path.join(root, 'local'));
  const envRoot = await validRecordRoot(path.join(root, 'env'));
  const siblingRoot = await validRecordRoot(path.join(root, 'record'));
  await mkdir(executionRoot);
  await writeFile(path.join(executionRoot, '.env'), `CUA_RECORD_ROOT=${envRoot}\n`, 'utf8');
  await writeFile(path.join(executionRoot, '.env.local'), `CUA_RECORD_ROOT=${localRoot}\n`, 'utf8');

  const previous = process.env.CUA_RECORD_ROOT;
  try {
    process.env.CUA_RECORD_ROOT = processRoot;
    assert.equal(await resolveRecordRoot(explicit, { executionRoot }), explicit);
    assert.equal(await resolveRecordRoot(undefined, { executionRoot }), processRoot);
    delete process.env.CUA_RECORD_ROOT;
    assert.equal(await resolveRecordRoot(undefined, { executionRoot }), localRoot);
    await writeFile(path.join(executionRoot, '.env.local'), '', 'utf8');
    assert.equal(await resolveRecordRoot(undefined, { executionRoot }), envRoot);
    await writeFile(path.join(executionRoot, '.env'), '', 'utf8');
    assert.equal(await resolveRecordRoot(undefined, { executionRoot }), siblingRoot);
  } finally {
    if (previous === undefined) delete process.env.CUA_RECORD_ROOT;
    else process.env.CUA_RECORD_ROOT = previous;
  }
});

test('录制后处理器根必须是包含 uv 项目标记与 parser 的绝对目录', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-invalid-record-root-'));
  await assert.rejects(resolveRecordRoot('relative-record'), /必须配置绝对路径/);
  await assert.rejects(resolveRecordRoot(root), /录制后处理器根目录无效/);
});

test('录制后处理器子进程不使用 shell，不传 goal 并转发进度', async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  let invocation: { command: string; args: readonly string[]; shell: unknown } | undefined;
  const fakeSpawn = ((command: string, args: readonly string[], options: { shell?: boolean }) => {
    invocation = { command, args, shell: options.shell };
    setImmediate(() => {
      stdout.write('trace progress\n');
      stderr.write('trace warning\n');
      child.emit('close', 0, null);
    });
    return child;
  }) as unknown as typeof spawn;
  const progress = new PassThrough();
  let forwarded = '';
  progress.on('data', (chunk) => {
    forwarded += chunk.toString();
  });

  await runRecordingParser({
    recordRoot: 'E:\\record',
    recordingPath: 'E:\\recording',
    progress,
  }, fakeSpawn);

  assert.equal(invocation?.command, 'uv');
  assert.equal(invocation?.shell, false);
  assert.deepEqual(invocation?.args, [
    'run', 'python', path.join('Aloha_Learn', 'parser.py'), 'E:\\recording',
  ]);
  assert.match(forwarded, /trace progress/);
  assert.match(forwarded, /trace warning/);
});

test('一键创建规范化 source 并允许空 goal 通过 Midscene dry-run 校验', async () => {
  const setup = await fixture();
  const result = await createTaskFromRecording({
    scene: 'network',
    task: 'open-settings',
    recording: setup.recordingPath,
    recordRoot: setup.recordRoot,
    catalog: {
      builtinProjectsRoot: setup.builtinProjectsRoot,
      userProjectsRoot: setup.userProjectsRoot,
    },
    runsRoot: setup.runsRoot,
  }, {
    runRecorder: async (request) => {
      await writeGeneratedRecording(request);
    },
  });

  assert.equal(result.goal, '');
  assert.equal(result.executor.status, 'succeeded');
  assert.equal(result.executor.dryRun, true);
  const manifest = await readTaskManifest(result.taskManifestPath);
  const document = await readYamlDocument(result.taskYamlPath);
  assert.equal(manifest.goal, '');
  assert.equal(manifest.description, '');
  assert.equal((document.agent as Record<string, unknown>).groupDescription, '');
  assert.equal(await readFile(path.join(result.sourceRoot, 'screenshots', '1.reference.png'), 'utf8'), 'reference');
  assert.equal(await exists(path.join(result.sourceRoot, 'screenshots', 'stale.jpg')), false);
  assert.equal(await exists(path.join(result.sourceRoot, 'inputs')), false);
});

test('非空 goal 不传给录制后处理器，只写入任务资产', async () => {
  const setup = await fixture();
  const result = await createTaskFromRecording({
    scene: 'network',
    task: 'query-alarm',
    recording: setup.recordingPath,
    goal: '  查询当前网管告警  ',
    recordRoot: setup.recordRoot,
    catalog: {
      builtinProjectsRoot: setup.builtinProjectsRoot,
      userProjectsRoot: setup.userProjectsRoot,
    },
    runsRoot: setup.runsRoot,
  }, {
    runRecorder: async (request) => {
      await writeGeneratedRecording(request);
    },
  });

  const manifest = await readTaskManifest(result.taskManifestPath);
  assert.equal(manifest.goal, '查询当前网管告警');
  assert.equal(manifest.description, '查询当前网管告警');
  assert.doesNotMatch(manifest.source.traceGenerationCommand ?? '', /--goal/);
});

test('已有任务在录制后处理器执行前失败，验证失败则清理本次任务', async () => {
  const existing = await fixture();
  const existingTask = path.join(existing.userProjectsRoot, 'network', 'existing');
  await mkdir(existingTask, { recursive: true });
  await writeFile(path.join(existingTask, 'preserve.txt'), 'keep', 'utf8');
  let recorderCalls = 0;
  await assert.rejects(createTaskFromRecording({
    scene: 'network',
    task: 'existing',
    recording: existing.recordingPath,
    recordRoot: existing.recordRoot,
    catalog: {
      builtinProjectsRoot: existing.builtinProjectsRoot,
      userProjectsRoot: existing.userProjectsRoot,
    },
    runsRoot: existing.runsRoot,
  }, {
    runRecorder: async () => {
      recorderCalls += 1;
    },
  }), /用户任务目录已存在/);
  assert.equal(recorderCalls, 0);
  assert.equal(await readFile(path.join(existingTask, 'preserve.txt'), 'utf8'), 'keep');

  const builtin = await fixture();
  const builtinTask = path.join(builtin.builtinProjectsRoot, 'network', 'builtin-task');
  await mkdir(builtinTask, { recursive: true });
  await writeFile(path.join(builtinTask, 'task.json'), '{}', 'utf8');
  await assert.rejects(createTaskFromRecording({
    scene: 'network',
    task: 'builtin-task',
    recording: builtin.recordingPath,
    recordRoot: builtin.recordRoot,
    catalog: {
      builtinProjectsRoot: builtin.builtinProjectsRoot,
      userProjectsRoot: builtin.userProjectsRoot,
    },
    runsRoot: builtin.runsRoot,
  }, {
    runRecorder: async () => {
      recorderCalls += 1;
    },
  }), /内置任务不可覆盖/);
  assert.equal(recorderCalls, 0);

  const failed = await fixture();
  const failedTask = path.join(failed.userProjectsRoot, 'network', 'invalid');
  await assert.rejects(createTaskFromRecording({
    scene: 'network',
    task: 'invalid',
    recording: failed.recordingPath,
    recordRoot: failed.recordRoot,
    catalog: {
      builtinProjectsRoot: failed.builtinProjectsRoot,
      userProjectsRoot: failed.userProjectsRoot,
    },
    runsRoot: failed.runsRoot,
  }, {
    runRecorder: writeGeneratedRecording,
    validate: async () => {
      throw new Error('静态验证失败');
    },
  }), /静态验证失败/);
  assert.equal(await exists(failedTask), false);
  assert.equal(await exists(path.join(failed.recordingPath, 'recording-demo_trace.json')), true);
});

test('截图路径越界时拒绝创建任务', async () => {
  const setup = await fixture();
  const taskRoot = path.join(setup.userProjectsRoot, 'network', 'escaped');
  await assert.rejects(createTaskFromRecording({
    scene: 'network',
    task: 'escaped',
    recording: setup.recordingPath,
    recordRoot: setup.recordRoot,
    catalog: {
      builtinProjectsRoot: setup.builtinProjectsRoot,
      userProjectsRoot: setup.userProjectsRoot,
    },
    runsRoot: setup.runsRoot,
  }, {
    runRecorder: async (request) => writeGeneratedRecording(request, { escapedScreenshot: true }),
  }), /必须位于 screenshots/);
  assert.equal(await exists(taskRoot), false);
});
