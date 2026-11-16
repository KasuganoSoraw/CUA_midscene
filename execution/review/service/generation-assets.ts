import { lstat, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { assertContained, requireSkillName } from '../../cua/skills/paths.js';
import { requireIdentifier } from '../../cua/task/tasks.js';
import { resolveRecordingDirectory } from '../../cua/recording/recording-catalog.js';
import type { WorkflowStatus } from '../shared/workflow.js';
import { deleteReviewSkill } from './review-skill.js';
import { atomicReplace } from './task-save.js';

interface GenerationAssets { draftRoot: string; skillName: string; recordingId: string }
interface AssetOptions { dataRoot: string; skillsRoot: string; recordingsRoot?: string; executionRoot?: string }
const ownershipFile = '.previous-generations.json';

async function checkedDraft(dataRoot: string, draftRoot: string): Promise<string> {
  const parent = path.join(dataRoot, 'workbench', 'drafts');
  const target = path.resolve(draftRoot);
  if (path.dirname(target) !== path.resolve(parent)) throw new Error('旧生成资产越出工作流草稿目录');
  const canonicalParent = assertContained(await realpath(dataRoot), await realpath(parent));
  try {
    const entry = await lstat(target);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('生成资产目录必须是普通目录');
    assertContained(canonicalParent, await realpath(target));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return target;
}

async function previousAssets(draftRoot: string): Promise<GenerationAssets[]> {
  const file = path.join(draftRoot, ownershipFile);
  try {
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('生成资产归属记录必须是普通文件');
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(value)) throw new Error('生成资产归属记录格式错误');
    for (const item of value) {
      if (!item || typeof item.draftRoot !== 'string' || !item.draftRoot
        || typeof item.skillName !== 'string' || typeof item.recordingId !== 'string') throw new Error('生成资产归属记录不完整');
      if (item.skillName) requireSkillName(item.skillName);
      if (item.recordingId) requireIdentifier(item.recordingId, 'recording');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function saveOwnership(draftRoot: string, entries: GenerationAssets[]): Promise<void> {
  return atomicReplace(path.join(draftRoot, ownershipFile), JSON.stringify(entries));
}

export async function trackGenerationAssets(dataRoot: string, previous: WorkflowStatus | undefined, draftRoot: string): Promise<string[]> {
  await checkedDraft(dataRoot, draftRoot);
  const entries: GenerationAssets[] = [];
  if (previous?.draftRoot) {
    await checkedDraft(dataRoot, previous.draftRoot);
    entries.push(...await previousAssets(previous.draftRoot));
    entries.push({ draftRoot: previous.draftRoot, skillName: previous.skillName, recordingId: previous.recordingId });
  }
  const unique = [...new Map(entries.map(entry => [path.resolve(entry.draftRoot), entry])).values()];
  for (const entry of unique) {
    await checkedDraft(dataRoot, entry.draftRoot);
    if (entry.skillName) requireSkillName(entry.skillName);
    if (entry.recordingId) requireIdentifier(entry.recordingId, 'recording');
  }
  await saveOwnership(draftRoot, unique);
  return [...new Set(unique.flatMap(entry => entry.skillName ? [entry.skillName] : []))];
}

async function removeDerivedRecording(options: AssetOptions, recordingId: string): Promise<void> {
  if (!recordingId) return;
  let recording: string;
  try { recording = await resolveRecordingDirectory(recordingId, options); }
  catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404 || (error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const name = path.basename(recording);
  for (const file of ['screenshots', `${name}_trace.json`, `${name}_processed_log.json`, `${name}_processed_log_sc.json`]) {
    await rm(path.join(recording, file), { recursive: true, force: true });
  }
}

async function removeOwnedSkill(skillsRoot: string, skillName: string): Promise<void> {
  try { await lstat(path.join(skillsRoot, requireSkillName(skillName))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await deleteReviewSkill(skillsRoot, skillName);
}

export async function cleanupPreviousGeneration(options: AssetOptions, draftRoot: string): Promise<number> {
  await checkedDraft(options.dataRoot, draftRoot);
  const entries = await previousAssets(draftRoot);
  for (const entry of entries) {
    const target = await checkedDraft(options.dataRoot, entry.draftRoot);
    if (target === path.resolve(draftRoot)) throw new Error('不能清理当前生成资产');
    if (entry.skillName) await removeOwnedSkill(options.skillsRoot, entry.skillName);
    await removeDerivedRecording(options, entry.recordingId);
    await rm(target, { recursive: true, force: true });
    await saveOwnership(draftRoot, entries.slice(entries.indexOf(entry) + 1));
  }
  return entries.length;
}
