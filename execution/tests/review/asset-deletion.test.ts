import assert from 'node:assert/strict';
import { access, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { deleteRecording, deleteUserTask } from '../../review/service/asset-deletion.js';
import { ReviewReadonlyError } from '../../review/service/task-save.js';
import { createTaskFixture } from '../helpers/task-fixture.js';

test('用户任务删除仅移除目标任务并保留场景，内置与冲突任务保持不变', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-review-delete-task-'));
  const builtin = path.join(root, 'builtin');
  const user = path.join(root, 'user');
  const userTask = await createTaskFixture(user, { scene: 'mail', task: 'send-message' });
  const builtinTask = await createTaskFixture(builtin, { scene: 'mail', task: 'open-mail' });
  const catalog = { builtinProjectsRoot: builtin, userProjectsRoot: user };

  assert.deepEqual(await deleteUserTask('mail', 'send-message', catalog), {
    deleted: true, scene: 'mail', task: 'send-message',
  });
  await assert.rejects(access(userTask));
  await access(path.join(user, 'mail', 'scene.json'));

  await assert.rejects(
    deleteUserTask('mail', 'open-mail', catalog),
    (error: unknown) => error instanceof ReviewReadonlyError,
  );
  await access(builtinTask);

  const builtinConflict = await createTaskFixture(builtin, { scene: 'mail', task: 'conflict' });
  const userConflict = await createTaskFixture(user, { scene: 'mail', task: 'conflict' });
  await assert.rejects(deleteUserTask('mail', 'conflict', catalog), /同时存在于内置与用户 catalog/);
  await Promise.all([access(builtinConflict), access(userConflict)]);
});

test('原始录制删除严格限制为录制根下的单个一级目录', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-review-delete-recording-'));
  const recording = path.join(root, 'Recording_demo');
  await mkdir(path.join(recording, 'inputs'), { recursive: true });

  assert.deepEqual(await deleteRecording('Recording_demo', { recordingsRoot: root }), {
    deleted: true, recording: 'Recording_demo',
  });
  await assert.rejects(access(recording));
  await assert.rejects(
    deleteRecording('Recording_demo', { recordingsRoot: root }),
    (error: any) => error?.statusCode === 404,
  );
  await assert.rejects(deleteRecording('..\\outside', { recordingsRoot: root }), /单一目录标识/);
});
