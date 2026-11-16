import { cp, lstat, mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { readSkill } from '../../cua/skills/assets.js';
import { withSkillWriteLock } from '../../cua/skills/lock.js';
import { assertContained, canonicalSkillsRoot } from '../../cua/skills/paths.js';

type Move = typeof rename;
class ReplacementRollbackError extends Error {}

async function stagingDirectory(root: string): Promise<string> {
  const staging = path.join(root, '.cua-staging');
  await mkdir(staging, { recursive: true });
  if ((await lstat(staging)).isSymbolicLink()) throw new Error('Skill 暂存目录不能是符号链接');
  const actual = assertContained(root, await realpath(staging));
  return mkdtemp(path.join(actual, 'replace-'));
}

async function installedSkill(root: string, name: string): Promise<boolean> {
  try { await lstat(path.join(root, name)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  await readSkill(root, name);
  return true;
}

async function swapSkill(root: string, staging: string, name: string, move: Move): Promise<void> {
  const target = path.join(root, name);
  const backup = path.join(staging, 'previous');
  const previous = await installedSkill(root, name);
  if (previous) await move(target, backup);
  let installed = false;
  try {
    await move(path.join(staging, name), target);
    installed = true;
    await readSkill(root, name);
  } catch (error) {
    try {
      if (installed) await rm(target, { recursive: true });
      if (previous) await move(backup, target);
    } catch (restoreError) {
      throw new ReplacementRollbackError(`Skill 替换失败且恢复失败，请检查备份目录：${backup}`, {
        cause: new AggregateError([error, restoreError]),
      });
    }
    throw error;
  }
}

export async function replaceRecordingDraft(options: {
  draftRoot: string; skillName: string; skillsRoot: string;
}, dependencies: { rename?: Move } = {}): Promise<void> {
  const source = await readSkill(options.draftRoot, options.skillName);
  const root = await canonicalSkillsRoot(options.skillsRoot);
  const relative = path.relative(root, source.root);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('替换草稿必须位于正式 Skill 根目录之外');
  }
  await withSkillWriteLock(root, options.skillName, async () => {
    const staging = await stagingDirectory(root);
    try {
      await cp(source.root, path.join(staging, options.skillName), { recursive: true, force: false, errorOnExist: true });
      await readSkill(staging, options.skillName);
      await swapSkill(root, staging, options.skillName, dependencies.rename ?? rename);
    } catch (error) {
      if (!(error instanceof ReplacementRollbackError)) await rm(staging, { recursive: true, force: true });
      throw error;
    }
    await rm(staging, { recursive: true });
  });
}
