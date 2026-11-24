import path from 'node:path';
import type { deleteHostSkill } from '../../cua/skills/host-delete.js';
import { readSkill } from '../../cua/skills/assets.js';
import { assertSkillDirectoryMatches, ensureSkillArchive } from '../../cua/skills/archive.js';
import { publishRecordingDraft } from '../../cua/skills/create.js';
import { resolveSkillImportEndpoint } from '../../cua/skills/host-import.js';
import { generatedSkillName, type WorkflowStatus } from '../shared/workflow.js';
import { checkedDraft, generationAssetsForDeletion, removeOwnedSkill } from './generation-assets.js';
import { backupGenerationSkill, skillExists } from './generation-backup.js';
import { readGenerationSync, writeGenerationSync, type GenerationSyncState } from './generation-sync-state.js';

interface SyncOptions {
  dataRoot: string; skillsRoot: string; executionRoot?: string;
  beforeDelete?: (names: string[]) => void;
  log: (message: string) => void;
}
interface SyncDependencies { publish?: typeof publishRecordingDraft; deleteSkill?: typeof deleteHostSkill }

export async function assertPendingSkillMatches(skillsRoot: string, draftRoot: string, name: string): Promise<void> {
  if (!await skillExists(skillsRoot, name)) return;
  const expected = await readSkill(draftRoot, name);
  const actual = await readSkill(skillsRoot, name);
  await assertSkillDirectoryMatches(expected.root, actual.root);
}

async function syncState(options: SyncOptions, status: WorkflowStatus): Promise<GenerationSyncState> {
  const name = generatedSkillName(status);
  const stored = await readGenerationSync(status.draftRoot);
  if (stored) {
    if (stored.skillName !== name) throw new Error('同步状态与本次生成的技能名称不一致');
    return stored;
  }
  const assets = await generationAssetsForDeletion(options.dataRoot, status);
  for (const pending of assets.pending) await assertPendingSkillMatches(options.skillsRoot, pending.draftRoot, pending.skillName);
  const state: GenerationSyncState = { skillName: name, oldNames: assets.skillNames, deletedNames: [], attempted: false, confirmed: false };
  await writeGenerationSync(status.draftRoot, state);
  return state;
}

async function deleteOldSkills(options: SyncOptions, draftRoot: string, state: GenerationSyncState, dependencies: SyncDependencies): Promise<void> {
  options.beforeDelete?.(state.oldNames);
  for (const name of state.oldNames) {
    if (state.deletedNames.includes(name)) continue;
    const backup = await backupGenerationSkill(options.skillsRoot, draftRoot, name);
    if (backup) options.log(`旧版本备份：${backup}`);
  }
  for (const name of state.oldNames) {
    if (state.deletedNames.includes(name)) continue;
    options.beforeDelete?.([name]);
    options.log(`正在通过 GDE API 删除旧技能：${name}`);
    await removeOwnedSkill(options.skillsRoot, name, { ...options, deleteSkill: dependencies.deleteSkill });
    state.deletedNames.push(name);
    await writeGenerationSync(draftRoot, state);
    options.log(`旧技能已删除：${name}`);
  }
}

async function prepareImport(options: SyncOptions, draftRoot: string, state: GenerationSyncState, dependencies: SyncDependencies): Promise<void> {
  if (!await skillExists(options.skillsRoot, state.skillName)) return;
  if (!state.attempted) throw new Error('待导入的技能名称已被其他资产占用，请重新生成技能');
  await assertPendingSkillMatches(options.skillsRoot, draftRoot, state.skillName);
  options.beforeDelete?.([state.skillName]);
  options.log(`正在通过 GDE API 清理上次导入的同名目标：${state.skillName}`);
  await removeOwnedSkill(options.skillsRoot, state.skillName, { ...options, deleteSkill: dependencies.deleteSkill });
}

export async function synchronizeGeneration(options: SyncOptions, status: WorkflowStatus, dependencies: SyncDependencies = {}): Promise<string> {
  await checkedDraft(options.dataRoot, status.draftRoot);
  const name = generatedSkillName(status);
  options.log('正在校验新技能资产和 ZIP。');
  const asset = await readSkill(status.draftRoot, name);
  await ensureSkillArchive(asset.root, name, path.join(status.draftRoot, `${name}.zip`));
  if (!dependencies.publish) await resolveSkillImportEndpoint(options.executionRoot);
  const state = await syncState(options, status);
  if (!state.confirmed) {
    await deleteOldSkills(options, status.draftRoot, state, dependencies);
    await prepareImport(options, status.draftRoot, state, dependencies);
    state.attempted = true;
    await writeGenerationSync(status.draftRoot, state);
    options.log(`正在打包并同步到 GDE：${name}，请等待导入确认。`);
    await (dependencies.publish ?? publishRecordingDraft)({ ...options, draftRoot: status.draftRoot, skillName: name });
    await readSkill(options.skillsRoot, name);
    state.confirmed = true;
    await writeGenerationSync(status.draftRoot, state);
  } else {
    await readSkill(options.skillsRoot, name);
  }
  options.log(`GDE 已确认导入，正式技能资源校验完成：${name}`);
  return name;
}
