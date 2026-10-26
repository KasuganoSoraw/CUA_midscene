import { constants } from 'node:fs';
import { access, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { DataPaths, RuntimeLayout } from './contracts/types.js';
import { readEnvironmentValue } from './environment.js';
import { packageRoot } from './package-root.js';

export const executionRoot = packageRoot;
export const dataRootEnv = 'CUA_DATA_ROOT';
export const skillsRootEnv = 'CUA_SKILLS_ROOT';

async function normalizeConfiguredPath(absolute: string): Promise<string> {
  let existing = absolute;
  const suffix: string[] = [];
  for (;;) {
    try { return path.join(await realpath(existing), ...suffix); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      suffix.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

export async function resolveSkillsRoot(root = executionRoot): Promise<string | undefined> {
  const configured = process.env[skillsRootEnv] === undefined
    ? (await readEnvironmentValue(skillsRootEnv, root)).value
    : process.env[skillsRootEnv]?.trim();
  if (!configured) return undefined;
  if (!path.isAbsolute(configured)) throw new Error('CUA_SKILLS_ROOT 必须配置绝对路径');
  return normalizeConfiguredPath(path.resolve(configured));
}

export function requireSkillsRoot(layout: Pick<RuntimeLayout, 'skillsRoot'>): string {
  if (!layout.skillsRoot) throw new Error('请配置 CUA_SKILLS_ROOT：正式 CUA Skill 的绝对根目录');
  return layout.skillsRoot;
}

function isInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function configuredDataRoot(
  explicit?: string,
  root = executionRoot,
): Promise<{ value?: string; source?: string }> {
  if (explicit !== undefined) return { value: explicit, source: '--data-root' };
  const processValue = process.env[dataRootEnv]?.trim();
  if (processValue) return { value: processValue, source: dataRootEnv };

  return readEnvironmentValue(dataRootEnv, root);
}

export function dataPaths(root: string): DataPaths {
  return {
    root,
    projectsRoot: path.join(root, 'projects'),
    runsRoot: path.join(root, 'runs'),
    cacheRoot: path.join(root, 'cache'),
  };
}

export async function resolveRuntimeLayout(
  explicit?: string,
  options: { executionRoot?: string; builtinProjectsRoot?: string } = {},
): Promise<RuntimeLayout> {
  const root = path.resolve(options.executionRoot ?? executionRoot);
  const configured = await configuredDataRoot(explicit, root);
  let data: DataPaths | undefined;
  if (configured.value !== undefined) {
    if (!path.isAbsolute(configured.value)) {
      throw new Error(`${configured.source} 必须配置绝对路径：${configured.value}`);
    }
    const normalized = path.resolve(configured.value);
    if (isInside(root, normalized)) {
      throw new Error(`${configured.source} 不得位于 Skill 根目录内：${normalized}`);
    }
    data = dataPaths(normalized);
  }
  return {
    skillsRoot: await resolveSkillsRoot(root),
    catalog: {
      ...(options.builtinProjectsRoot ? { builtinProjectsRoot: path.resolve(options.builtinProjectsRoot) } : {}),
      ...(data ? { userProjectsRoot: data.projectsRoot } : {}),
    },
    ...(data ? { data } : {}),
  };
}

export async function requireDataPaths(layout: RuntimeLayout): Promise<DataPaths> {
  if (!layout.data) {
    throw new Error('该命令需要可写数据目录，请提供 --data-root 或配置 CUA_DATA_ROOT');
  }
  try {
    for (const directory of [layout.data.root, layout.data.runsRoot, layout.data.cacheRoot]) {
      await mkdir(directory, { recursive: true });
      await access(directory, constants.W_OK);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`CUA 数据目录不可写：${layout.data.root}\n${message}`);
  }
  return layout.data;
}
