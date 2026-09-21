import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { TaskCatalogRoots } from '../../cua/contracts/types.js';
import { requireIdentifier } from '../../cua/task/tasks.js';
import { resolveRecordingDirectory } from '../../cua/recording/recording-catalog.js';
import { resolveReviewTaskRoot } from './review-task.js';
import { ReviewReadonlyError } from './task-save.js';

function assertDirectChild(parent: string, target: string, label: string): void {
  const root = path.resolve(parent);
  const absolute = path.resolve(target);
  const relative = path.relative(root, absolute);
  if (!relative || path.isAbsolute(relative) || relative.startsWith('..') || path.dirname(relative) !== '.') {
    throw Object.assign(new Error(`${label} 越出允许的目录边界`), { statusCode: 400 });
  }
}

function deletionError(error: unknown, missingMessage: string): never {
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    throw Object.assign(new Error(missingMessage), { statusCode: 404 });
  }
  throw error;
}

export async function deleteUserTask(
  sceneValue: string,
  taskValue: string,
  catalog: TaskCatalogRoots,
): Promise<{ deleted: true; scene: string; task: string }> {
  const scene = requireIdentifier(sceneValue, 'scene');
  const task = requireIdentifier(taskValue, 'task');
  let resolved: Awaited<ReturnType<typeof resolveReviewTaskRoot>>;
  try {
    resolved = await resolveReviewTaskRoot(scene, task, catalog);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('任务不存在：')) {
      throw Object.assign(error, { statusCode: 404 });
    }
    throw error;
  }
  if (!resolved.writable || !catalog.userProjectsRoot) {
    throw new ReviewReadonlyError(`内置任务不可删除：${scene}/${task}`);
  }
  const userRoot = path.resolve(catalog.userProjectsRoot);
  const sceneRoot = path.resolve(userRoot, scene);
  assertDirectChild(userRoot, sceneRoot, '场景目录');
  assertDirectChild(sceneRoot, resolved.taskRoot, '任务目录');
  try {
    await rm(resolved.taskRoot, { recursive: true, force: false });
  } catch (error) {
    deletionError(error, `任务不存在：${scene}/${task}`);
  }
  return { deleted: true, scene, task };
}

export async function deleteRecording(
  recordingValue: string,
  options: { recordingsRoot?: string; executionRoot?: string } = {},
): Promise<{ deleted: true; recording: string }> {
  const recording = requireIdentifier(recordingValue, 'recording');
  let recordingPath: string;
  try {
    recordingPath = await resolveRecordingDirectory(recording, options);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('录制目录不存在：')) {
      throw Object.assign(error, { statusCode: 404 });
    }
    throw error;
  }
  const root = path.dirname(recordingPath);
  assertDirectChild(root, recordingPath, '录制目录');
  try {
    await rm(recordingPath, { recursive: true, force: false });
  } catch (error) {
    deletionError(error, `录制目录不存在：${recording}`);
  }
  return { deleted: true, recording };
}
