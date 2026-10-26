import { randomBytes } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseSkillName } from './assets.js';
import { assertContained, canonicalSkillsRoot, requireSkillName } from './paths.js';

async function declaredName(root: string, directory: string): Promise<string | undefined> {
  const target = path.join(root, directory, 'SKILL.md');
  try {
    const entry = await lstat(target);
    if (!entry.isFile() || entry.isSymbolicLink()) return undefined;
    assertContained(root, await realpath(target));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const text = await readFile(target, 'utf8');
  try { return parseSkillName(text); }
  catch {
    // 无效的普通 Skill 元数据不提供规范名称；实际目录名仍保留为占用名称。
    return undefined;
  }
}

export async function occupiedSkillNames(skillsRoot: string): Promise<Set<string>> {
  let root: string;
  try { root = await canonicalSkillsRoot(skillsRoot); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw error;
  }
  const names = new Set<string>();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    names.add(entry.name.toLowerCase());
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const name = await declaredName(root, entry.name);
    if (name) names.add(name.toLowerCase());
  }
  return names;
}

export function availableSkillName(name: string, occupied: Set<string>, suffix = () => randomBytes(3).toString('hex')): string {
  requireSkillName(name);
  if (!occupied.has(name.toLowerCase())) return name;
  const stem = name.slice(0, 57).replace(/-+$/, '');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const value = suffix();
    if (!/^[a-f0-9]{6}$/.test(value)) throw new Error('Skill 随机后缀必须是六位十六进制字符串');
    const candidate = requireSkillName(`${stem}-${value}`);
    if (!occupied.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error('无法生成未占用的 Skill 名称，请检查正式目录');
}
