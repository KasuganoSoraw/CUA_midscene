import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TaskCatalogRoots, TaskManifest } from '../../cua/contracts/types.js';
import { validateContract } from '../../cua/contracts/validation.js';
import { resolveYamlInputs, validateRecordedTaskDocument, dumpYamlDocument } from '../../cua/task/yaml-task.js';
import type { SaveReviewTaskRequest, SaveReviewTaskResult } from '../shared/types.js';
import { resolveReviewTaskRoot, reviewRevision } from './review-task.js';

export class ReviewConflictError extends Error {}
export class ReviewReadonlyError extends Error {}

export async function validateReviewDraft(request: Pick<SaveReviewTaskRequest, 'manifest' | 'document'>): Promise<void> {
  const manifest = await validateContract<TaskManifest>(request.manifest, 'task.schema.json', 'review task.json draft');
  validateRecordedTaskDocument(request.document, manifest, 'review task.yaml draft');
  resolveYamlInputs(request.document, manifest);
}

async function atomicReplace(target: string, content: string): Promise<void> {
  const temporary = `${target}.review-${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, content, 'utf8');
  try {
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function saveReviewTask(
  scene: string,
  task: string,
  catalog: TaskCatalogRoots,
  request: SaveReviewTaskRequest,
  options: { replace?: (target: string, content: string) => Promise<void> } = {},
): Promise<SaveReviewTaskResult> {
  const resolved = await resolveReviewTaskRoot(scene, task, catalog);
  if (!resolved.writable) throw new ReviewReadonlyError(`内置任务不可修改：${scene}/${task}`);
  const taskJsonPath = path.join(resolved.taskRoot, 'task.json');
  const taskYamlPath = path.join(resolved.taskRoot, 'task.yaml');
  const [originalJson, originalYaml] = await Promise.all([readFile(taskJsonPath), readFile(taskYamlPath)]);
  const currentRevision = reviewRevision(originalJson, originalYaml);
  if (request.expectedRevision !== currentRevision) throw new ReviewConflictError('任务已被外部修改，请重新加载');
  await validateReviewDraft(request);
  const nextJson = `${JSON.stringify(request.manifest, null, 2)}\n`;
  const nextYaml = dumpYamlDocument(request.document);
  const changed: Array<'task.yaml' | 'task.json'> = [];
  if (nextYaml !== originalYaml.toString('utf8')) changed.push('task.yaml');
  if (nextJson !== originalJson.toString('utf8')) changed.push('task.json');
  if (!changed.length) return { revision: currentRevision, changed };

  let yamlChanged = false;
  const replace = options.replace ?? atomicReplace;
  try {
    if (changed.includes('task.yaml')) {
      await replace(taskYamlPath, nextYaml);
      yamlChanged = true;
    }
    if (changed.includes('task.json')) await replace(taskJsonPath, nextJson);
  } catch (error) {
    if (yamlChanged) await replace(taskYamlPath, originalYaml.toString('utf8'));
    throw error;
  }
  return { revision: reviewRevision(nextJson, nextYaml), changed };
}
