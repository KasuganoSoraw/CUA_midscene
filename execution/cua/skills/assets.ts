import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import type { CuaSkillManifest, JsonObject, ResolvedTaskResult, SkillCatalogItem, SkillDescription, SkillTaskManifest } from '../contracts/types.js';
import { readJsonContract, readProcessedLog, readShowuiTrace, validateContract } from '../contracts/validation.js';
import { readYamlDocument, resolveYamlInputs, validateRecordedTaskDocument } from '../task/yaml-task.js';
import { assertContained, canonicalSkillsRoot, requireSkillName, safeSkillFile, validateAssetTree } from './paths.js';

export interface SkillAsset {
  root: string;
  skill: { name: string; description: string };
  marker: CuaSkillManifest;
  manifest: SkillTaskManifest;
  document: JsonObject;
}

export function parseSkillMarkdown(text: string): SkillAsset['skill'] {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error('SKILL.md 缺少合法 frontmatter');
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length) throw new Error(`SKILL.md frontmatter 非法：${document.errors[0].message}`);
  const metadata = document.toJS() as Record<string, unknown> | null;
  if (!metadata || typeof metadata.name !== 'string' || typeof metadata.description !== 'string' || !metadata.description.trim()) {
    throw new Error('SKILL.md 必须包含非空 name 和 description');
  }
  return { name: requireSkillName(metadata.name), description: metadata.description.trim() };
}

export async function validateSkillReferences(root: string, manifest: SkillTaskManifest, document: JsonObject): Promise<void> {
  for (const reference of [manifest.source.tracePath, manifest.source.processedLogPath]) {
    if (!reference.replaceAll('\\', '/').startsWith('source/')) throw new Error('录制证据必须位于 source/');
    await safeSkillFile(root, reference);
  }
  await validateImageReferences(root, document);
  const trace = await readShowuiTrace(await safeSkillFile(root, manifest.source.tracePath));
  const processed = await readProcessedLog(await safeSkillFile(root, manifest.source.processedLogPath));
  if (trace.trajectory.length !== processed.length) throw new Error('录制轨迹与处理日志数量不一致');
  for (const step of processed) {
    for (const key of ['screenshot_full', 'screenshot_crop', 'screenshot_reference']) {
      const reference = step[key];
      if (reference !== undefined && reference !== null) {
        if (typeof reference !== 'string') throw new Error('录制截图引用必须是相对路径');
        await safeSkillFile(path.join(root, 'source'), reference);
      }
    }
  }
}

async function validateImageReferences(root: string, value: unknown): Promise<void> {
  if (Array.isArray(value)) {
    for (const item of value) await validateImageReferences(root, item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'images') {
      if (!Array.isArray(item) || !item.length) throw new Error('参考图 images 必须是非空数组');
      for (const image of item) {
        if (!image || typeof image.name !== 'string' || !image.name.trim() || typeof image.url !== 'string') {
          throw new Error('参考图必须具有 name 和目录内 url');
        }
        await safeSkillFile(root, image.url);
      }
    } else await validateImageReferences(root, item);
  }
}

export async function readSkillDirectory(root: string, expectedName: string): Promise<SkillAsset> {
  requireSkillName(expectedName);
  await validateAssetTree(root);
  const markdown = await safeSkillFile(root, 'SKILL.md');
  const skill = parseSkillMarkdown(await readFile(markdown, 'utf8'));
  const marker = await readJsonContract<CuaSkillManifest>(await safeSkillFile(root, 'cua-manifest.json'), 'cua-manifest.schema.json', 'CUA Skill 标记');
  const manifest = await readJsonContract<SkillTaskManifest>(await safeSkillFile(root, 'task.json'), 'skill-task.schema.json', 'Skill 任务');
  if (skill.name !== expectedName || marker.skillName !== skill.name || manifest.skillName !== skill.name) {
    throw new Error('Skill 目录、SKILL.md、cua-manifest.json 与 task.json 身份不一致');
  }
  if (manifest.description !== skill.description || manifest.title !== skill.name) throw new Error('Skill 任务名称或描述与 SKILL.md 不一致');
  const document = await readYamlDocument(await safeSkillFile(root, 'task.yaml'));
  validateRecordedTaskDocument(document, manifest, 'Skill task.yaml');
  resolveYamlInputs(document, manifest);
  await validateSkillReferences(root, manifest, document);
  return { root, skill, marker, manifest, document };
}

export async function readSkill(skillsRoot: string, skillName: string): Promise<SkillAsset> {
  requireSkillName(skillName);
  const root = await canonicalSkillsRoot(skillsRoot);
  const target = path.join(root, skillName);
  if ((await lstat(target)).isSymbolicLink()) throw new Error('Skill 目录不能是符号链接');
  const actual = assertContained(root, await realpath(target));
  if (path.basename(actual) !== skillName) throw new Error('Skill 实际目录名与规范身份不一致');
  return readSkillDirectory(actual, skillName);
}

export function describeSkill(asset: SkillAsset): SkillDescription {
  const steps = asset.document.tasks as JsonObject[];
  return {
    skillName: asset.skill.name, description: asset.skill.description, goal: asset.manifest.goal,
    inputs: asset.manifest.inputs, taskCount: steps.length,
    actionCount: steps.reduce((count, step) => count + (step.flow as unknown[]).length, 0),
  };
}

export async function listSkills(skillsRoot: string): Promise<SkillCatalogItem[]> {
  let root: string;
  try { root = await canonicalSkillsRoot(skillsRoot); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const result: SkillCatalogItem[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const marker = path.join(root, entry.name, 'cua-manifest.json');
    try { await lstat(marker); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    try { result.push({ status: 'ready', ...describeSkill(await readSkill(root, entry.name)) }); }
    catch (error) {
      result.push({ status: 'error', skillName: entry.name, description: '', error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result.sort((left, right) => left.skillName.localeCompare(right.skillName));
}

async function resolveImages(root: string, value: unknown): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(item => resolveImages(root, item)));
  if (!value || typeof value !== 'object') return value;
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = key === 'images'
      ? await Promise.all((item as Array<{ name: string; url: string }>).map(async image => ({ ...image, url: await safeSkillFile(root, image.url) })))
      : await resolveImages(root, item);
  }
  return result;
}

export async function resolveSkillTask(options: {
  skillsRoot: string; skillName: string; inputs?: Record<string, string>;
}): Promise<ResolvedTaskResult> {
  const asset = await readSkill(options.skillsRoot, options.skillName);
  const resolved = resolveYamlInputs(asset.document, asset.manifest, options.inputs);
  return {
    document: await resolveImages(asset.root, resolved.document) as JsonObject,
    manifest: asset.manifest, inputs: resolved.inputs,
    sourcePath: path.join(asset.root, 'task.yaml'), origin: 'user', writable: true,
  };
}

export async function validateSkillDraft(asset: SkillAsset, manifest: SkillTaskManifest, document: JsonObject): Promise<void> {
  await validateContract(manifest, 'skill-task.schema.json', 'Skill task.json draft');
  if (manifest.skillName !== asset.skill.name || manifest.title !== asset.skill.name || manifest.description !== asset.skill.description) {
    throw new Error('保存不能改变 Skill 身份或 SKILL.md 元数据');
  }
  validateRecordedTaskDocument(document, manifest, 'Skill task.yaml draft');
  resolveYamlInputs(document, manifest);
  await validateSkillReferences(asset.root, manifest, document);
}
