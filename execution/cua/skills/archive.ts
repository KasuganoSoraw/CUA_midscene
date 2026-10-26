import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zip, type Zippable } from 'fflate';
import { readSkillDirectory } from './assets.js';
import { safeSkillFile } from './paths.js';

async function archiveEntries(root: string, relative = '', files: Zippable = {}): Promise<Zippable> {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) await archiveEntries(root, name, files);
    else if (entry.isFile()) files[name] = await readFile(await safeSkillFile(root, name));
    else throw new Error('Skill ZIP 不接受符号链接或特殊文件');
  }
  return files;
}

export async function createSkillArchive(root: string, skillName: string, zipPath: string): Promise<void> {
  await readSkillDirectory(root, skillName);
  const relative = path.relative(root, zipPath);
  if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error('ZIP 产物不能位于被打包的 Skill 目录内');
  }
  const entries = await archiveEntries(root);
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 6 }, (error, data) => { if (error) reject(error); else resolve(data); });
  });
  await writeFile(zipPath, bytes, { flag: 'wx', mode: 0o600 });
}
