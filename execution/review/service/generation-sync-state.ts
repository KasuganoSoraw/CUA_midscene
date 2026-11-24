import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { requireSkillName } from '../../cua/skills/paths.js';
import { atomicReplace } from './task-save.js';

export interface GenerationSyncState {
  skillName: string;
  oldNames: string[];
  deletedNames: string[];
  attempted: boolean;
  confirmed: boolean;
}
const filename = '.skill-sync.json';

export async function readGenerationSync(draftRoot: string): Promise<GenerationSyncState | undefined> {
  try {
    const file = path.join(draftRoot, filename);
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('技能同步状态必须是普通文件');
    const value = JSON.parse(await readFile(file, 'utf8')) as GenerationSyncState;
    requireSkillName(value.skillName);
    if (!Array.isArray(value.oldNames) || !Array.isArray(value.deletedNames)
      || typeof value.attempted !== 'boolean' || typeof value.confirmed !== 'boolean') throw new Error('技能同步状态格式错误');
    for (const name of [...value.oldNames, ...value.deletedNames]) requireSkillName(name);
    if (value.deletedNames.some(name => !value.oldNames.includes(name))) throw new Error('技能同步删除记录不属于旧版本');
    if (value.confirmed && !value.attempted) throw new Error('技能同步确认记录缺少导入尝试');
    if (value.attempted && value.oldNames.some(name => !value.deletedNames.includes(name))) throw new Error('技能同步记录缺少旧版本删除确认');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeGenerationSync(draftRoot: string, state: GenerationSyncState): Promise<void> {
  await atomicReplace(path.join(draftRoot, filename), JSON.stringify(state));
}
