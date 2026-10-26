import { lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export function requireSkillName(value: string): string {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)
    || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value)) {
    throw new Error('skillName 必须是至多 64 字符的小写英文、数字和连字符标识，不能是路径或保留名称');
  }
  return value;
}

export function assertContained(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Skill 资产路径越出允许目录：${target}`);
  }
  return target;
}

export async function canonicalSkillsRoot(root: string, create = false): Promise<string> {
  if (!path.isAbsolute(root)) throw new Error('CUA_SKILLS_ROOT 必须配置绝对路径');
  if (create) await mkdir(root, { recursive: true });
  return realpath(root);
}

export async function safeSkillFile(root: string, reference: string): Promise<string> {
  if (!reference || /[:\0]/.test(reference) || path.win32.isAbsolute(reference) || path.posix.isAbsolute(reference)) {
    throw new Error(`Skill 资产必须是目录内相对路径：${reference}`);
  }
  const parts = reference.replaceAll('\\', '/').split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`非法 Skill 资产路径：${reference}`);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error(`Skill 不接受符号链接资产：${reference}`);
    assertContained(root, await realpath(current));
  }
  if (!(await lstat(current)).isFile()) throw new Error(`Skill 资产不是文件：${reference}`);
  return current;
}

export async function validateAssetTree(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Skill 不接受符号链接资产：${entry.name}`);
    assertContained(root, await realpath(target));
    if (entry.isDirectory()) await validateAssetTree(target);
    else if (!entry.isFile()) throw new Error(`Skill 包含非法资产：${entry.name}`);
  }
}
