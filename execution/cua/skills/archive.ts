import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, zip } from 'fflate';
import { readSkillDirectory } from './assets.js';
import { safeSkillFile } from './paths.js';

async function archiveEntries(root: string, relative = '', files: Record<string, Uint8Array> = Object.create(null)): Promise<Record<string, Uint8Array>> {
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


export async function assertSkillDirectoryMatches(expected: string, actual: string): Promise<void> {
  const files = await archiveEntries(expected);
  for (const [name, bytes] of Object.entries(files)) {
    const target = await safeSkillFile(actual, name);
    if (!Buffer.from(bytes).equals(await readFile(target))) throw new Error(`Skill 内容与本次草稿不一致：${name}`);
  }
}

export async function ensureSkillArchive(root: string, skillName: string, zipPath: string): Promise<void> {
  await readSkillDirectory(root, skillName);
  try {
    const entry = await lstat(zipPath);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Skill ZIP 必须是普通文件');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await createSkillArchive(root, skillName, zipPath);
    return;
  }
  const archived = unzipSync(await readFile(zipPath));
  const expected = await archiveEntries(root);
  if (Object.keys(archived).length !== Object.keys(expected).length) throw new Error('已有 ZIP 与草稿不一致，请重新生成技能');
  for (const [name, bytes] of Object.entries(expected)) {
    if (!archived[name] || !Buffer.from(bytes).equals(archived[name])) throw new Error('已有 ZIP 与草稿不一致，请重新生成技能');
  }
}
