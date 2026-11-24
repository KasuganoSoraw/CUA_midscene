import { cp, lstat, mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { readSkill } from '../../cua/skills/assets.js';
import { assertSkillDirectoryMatches, ensureSkillArchive } from '../../cua/skills/archive.js';
import { withSkillWriteLock } from '../../cua/skills/lock.js';
import { assertContained } from '../../cua/skills/paths.js';

export async function skillExists(skillsRoot: string, name: string): Promise<boolean> {
  try { await lstat(path.join(skillsRoot, name)); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function backupRoot(draftRoot: string): Promise<string> {
  const target = path.join(draftRoot, '.skill-backups');
  await mkdir(target, { recursive: true });
  if ((await lstat(target)).isSymbolicLink()) throw new Error('技能备份目录不能是符号链接');
  return assertContained(await realpath(draftRoot), await realpath(target));
}

async function copyBackup(source: string, root: string, name: string): Promise<void> {
  const stage = await mkdtemp(path.join(root, '.snapshot-'));
  try {
    await cp(source, path.join(stage, name), { recursive: true, force: false, errorOnExist: true });
    const asset = await readSkill(stage, name);
    await assertSkillDirectoryMatches(source, asset.root);
    await rename(asset.root, path.join(root, name));
  } finally { await rm(stage, { recursive: true, force: true }); }
}

export async function backupGenerationSkill(skillsRoot: string, draftRoot: string, name: string): Promise<string | undefined> {
  if (!await skillExists(skillsRoot, name)) return undefined;
  return withSkillWriteLock(skillsRoot, name, async () => {
    const source = await readSkill(skillsRoot, name);
    const root = await backupRoot(draftRoot);
    if (!await skillExists(root, name)) await copyBackup(source.root, root, name);
    const backup = await readSkill(root, name);
    await assertSkillDirectoryMatches(source.root, backup.root);
    const zipPath = path.join(root, `${name}.zip`);
    await ensureSkillArchive(backup.root, name, zipPath);
    return zipPath;
  });
}


export async function clearGenerationBackups(draftRoot: string): Promise<void> {
  const target = path.join(draftRoot, '.skill-backups');
  try {
    const entry = await lstat(target);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('技能备份目录必须是普通目录');
    assertContained(await realpath(draftRoot), await realpath(target));
    await rm(target, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
