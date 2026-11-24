import { assertPendingSkillMatches } from './generation-sync.js';
import type { deleteHostSkill } from '../../cua/skills/host-delete.js';
import { rm } from 'node:fs/promises';
import { readSkill } from '../../cua/skills/assets.js';
import type { WorkflowStatus } from '../shared/workflow.js';
import { generationAssetsForDeletion, removeOwnedSkill } from './generation-assets.js';

async function validateOwnedSkills(skillsRoot: string, names: string[]): Promise<void> {
  for (const name of names) {
    try { await readSkill(skillsRoot, name); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
}

export async function deleteWorkflowAssets(options: {
  dataRoot: string; skillsRoot?: string; executionRoot?: string; deleteSkill?: typeof deleteHostSkill; beforeDelete?: (skillNames: string[]) => void;
}, status: WorkflowStatus | undefined, removeRecording: () => Promise<void>): Promise<void> {
  const assets = await generationAssetsForDeletion(options.dataRoot, status);
  if (assets.skillNames.length && !options.skillsRoot) throw new Error('请配置 CUA_SKILLS_ROOT 后再删除关联技能');
  if (assets.skillNames.length) await validateOwnedSkills(options.skillsRoot!, assets.skillNames);
  for (const pending of assets.pending) await assertPendingSkillMatches(options.skillsRoot!, pending.draftRoot, pending.skillName);
  options.beforeDelete?.(assets.skillNames);
  for (const name of assets.skillNames) await removeOwnedSkill(options.skillsRoot!, name, options);
  await removeRecording();
  for (const root of assets.draftRoots) await rm(root, { recursive: true, force: true });
}
