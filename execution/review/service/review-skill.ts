import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { SkillTaskManifest } from '../../cua/contracts/types.js';
import { readSkill, validateSkillDraft, type SkillAsset } from '../../cua/skills/assets.js';
import { withSkillWriteLock } from '../../cua/skills/lock.js';
import { assertContained, safeSkillFile } from '../../cua/skills/paths.js';
import { dumpYamlDocument } from '../../cua/task/yaml-task.js';
import type { ReviewSkillView, SaveReviewTaskRequest, SaveReviewTaskResult } from '../shared/types.js';
import { buildReviewSteps } from './review-task.js';
import { atomicReplace, ReviewConflictError } from './task-save.js';

export async function skillRevision(asset: SkillAsset): Promise<string> {
  const hash = createHash('sha256');
  for (const name of ['SKILL.md', 'cua-manifest.json', 'task.json', 'task.yaml']) {
    hash.update(await readFile(await safeSkillFile(asset.root, name))).update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export async function loadReviewSkill(skillsRoot: string, skillName: string): Promise<ReviewSkillView> {
  const asset = await readSkill(skillsRoot, skillName);
  return {
    skillName: asset.skill.name, title: asset.skill.name, description: asset.skill.description,
    origin: 'user', writable: true, manifest: asset.manifest, document: asset.document,
    revision: await skillRevision(asset), steps: await buildReviewSteps(asset.root, asset.manifest, asset.document),
  };
}

async function replaceSkillDraft(asset: SkillAsset, request: SaveReviewTaskRequest<SkillTaskManifest>): Promise<SaveReviewTaskResult> {
  const current = await skillRevision(asset);
  if (current !== request.expectedRevision) throw new ReviewConflictError('Skill 已被外部修改，请重新加载');
  await validateSkillDraft(asset, request.manifest, request.document);
  if (await skillRevision(asset) !== current) throw new ReviewConflictError('Skill 已被外部修改，请重新加载');
  const paths = await Promise.all(['task.yaml', 'task.json'].map(name => safeSkillFile(asset.root, name)));
  const original = await Promise.all(paths.map(file => readFile(file, 'utf8')));
  const next = [dumpYamlDocument(request.document), `${JSON.stringify(request.manifest, null, 2)}\n`];
  const changed = (['task.yaml', 'task.json'] as const).filter((_, index) => next[index] !== original[index]);
  const written: number[] = [];
  try {
    for (let index = 0; index < paths.length; index += 1) {
      if (original[index] === next[index]) continue;
      await atomicReplace(paths[index], next[index]);
      written.push(index);
    }
  } catch (error) {
    for (const index of written.reverse()) await atomicReplace(paths[index], original[index]);
    throw error;
  }
  return { revision: await skillRevision(asset), changed };
}

export async function saveReviewSkill(skillsRoot: string, name: string,
  request: SaveReviewTaskRequest<SkillTaskManifest>): Promise<SaveReviewTaskResult> {
  return withSkillWriteLock(skillsRoot, name, async () => {
    const asset = await readSkill(skillsRoot, name);
    return replaceSkillDraft(asset, request);
  });
}

export async function deleteReviewSkill(skillsRoot: string, name: string): Promise<{ deleted: true; skillName: string }> {
  return withSkillWriteLock(skillsRoot, name, async () => {
    const asset = await readSkill(skillsRoot, name);
    const root = await realpath(skillsRoot);
    const staging = path.join(root, '.cua-staging');
    await mkdir(staging, { recursive: true });
    if ((await lstat(staging)).isSymbolicLink()) throw new Error('Skill 暂存目录不能是符号链接');
    const actual = assertContained(root, await realpath(staging));
    const trash = path.join(actual, `trash-${randomUUID()}`);
    await rename(assertContained(root, asset.root), trash);
    await rm(assertContained(actual, trash), { recursive: true });
    return { deleted: true, skillName: name };
  });
}
