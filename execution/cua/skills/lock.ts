import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { assertContained, canonicalSkillsRoot, requireSkillName } from './paths.js';

export async function withSkillWriteLock<T>(skillsRoot: string, name: string, operation: () => Promise<T>): Promise<T> {
  requireSkillName(name);
  const root = await canonicalSkillsRoot(skillsRoot);
  const directory = path.join(root, '.cua-locks');
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Skill 锁目录不能是符号链接');
  assertContained(root, await realpath(directory));
  const filename = path.join(directory, `${name}.lock`);
  let lock;
  try { lock = await open(filename, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw Object.assign(new Error('Skill 正在写入，请稍后重试'), { statusCode: 409 });
    }
    throw error;
  }
  try { return await operation(); }
  finally { await lock.close(); await rm(filename, { force: true }); }
}
