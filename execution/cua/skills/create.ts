import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import type { CuaSkillManifest, JsonObject, ShowuiTrace, SkillTaskManifest } from '../contracts/types.js';
import { readProcessedLog, readShowuiTrace, writeJsonFile } from '../contracts/validation.js';
import { buildRecordedSteps } from '../conversion/showui-trace.js';
import { packageRoot } from '../package-root.js';
import { resolvePythonExecutable } from '../python-worker.js';
import { copyGeneratedAssets, generatedAssets, runRecordingParser } from '../recording/create-task.js';
import { writeYamlDocument } from '../task/yaml-task.js';
import { readSkillDirectory } from './assets.js';
import { assertContained, canonicalSkillsRoot, requireSkillName, safeSkillFile } from './paths.js';

export interface GeneratedSkillMetadata { name: string; description: string; goal: string }

export function readGeneratedSkillMetadata(trace: ShowuiTrace): GeneratedSkillMetadata {
  const value = trace.skill as Partial<GeneratedSkillMetadata> | undefined;
  if (!value || typeof value.name !== 'string' || typeof value.description !== 'string' || !value.description.trim()
    || typeof value.goal !== 'string' || !value.goal.trim()) throw new Error('录制模型未生成完整 Skill 名称、描述和目标');
  return { name: requireSkillName(value.name), description: value.description.trim(), goal: value.goal.trim() };
}

export function skillMarkdown(metadata: GeneratedSkillMetadata): string {
  const description = `${metadata.description} 由 CUA 子 Agent 执行此电脑操作任务。`;
  return `---\n${stringify({ name: metadata.name, description }).trim()}\n---\n\n# ${metadata.name}\n\n${metadata.goal}\n\n`
    + `将完整任务与业务参数委派给 Computer-Use SubAgent，execution 使用 skillName: ${metadata.name}，默认 strategy: guided。`
    + '仅在明确要求严格回放时指定 replay。不要重新搜索任务或把文件路径交给模型。\n';
}

async function copyTreeExclusive(source: string, target: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === 'cua-manifest.json') continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) { await mkdir(to); await copyTreeExclusive(from, to); }
    else if (entry.isFile()) await copyFile(from, to, constants.COPYFILE_EXCL);
    else throw new Error('安装目录包含非法链接或文件');
  }
}

export async function installSkill(skillsRoot: string, name: string, assemble: (stage: string) => Promise<void>): Promise<string> {
  requireSkillName(name);
  const root = await canonicalSkillsRoot(skillsRoot, true);
  const staging = path.join(root, '.cua-staging');
  await mkdir(staging, { recursive: true });
  if ((await lstat(staging)).isSymbolicLink()) throw new Error('Skill 暂存目录不能是符号链接');
  assertContained(root, await realpath(staging));
  const stage = await mkdtemp(path.join(staging, 'build-'));
  const target = path.join(root, name);
  let reserved = false;
  try {
    await assemble(stage);
    await readSkillDirectory(stage, name);
    await mkdir(target);
    reserved = true;
    await copyTreeExclusive(stage, target);
    await copyFile(path.join(stage, 'cua-manifest.json'), path.join(target, 'cua-manifest.json'), constants.COPYFILE_EXCL);
    await readSkillDirectory(target, name);
    return target;
  } catch (error) {
    if (reserved) await rm(assertContained(root, target), { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Skill 名称已存在，拒绝覆盖：${name}`);
    throw error;
  } finally { await rm(assertContained(staging, stage), { recursive: true, force: true }); }
}

async function assembleSkill(stage: string, recording: string, metadata: GeneratedSkillMetadata,
  assets: Awaited<ReturnType<typeof generatedAssets>>): Promise<void> {
  for (const file of [assets.tracePath, assets.processedLogPath, assets.processedLogScPath]) {
    await safeSkillFile(recording, path.relative(recording, file));
  }
  for (const file of assets.screenshotPaths) await safeSkillFile(recording, file);
  await copyGeneratedAssets(recording, path.join(stage, 'source'), assets);
  const [trace, processed] = await Promise.all([readShowuiTrace(assets.tracePath), readProcessedLog(assets.processedLogScPath)]);
  const built = buildRecordedSteps(trace, processed);
  const markdown = skillMarkdown(metadata);
  const manifest: SkillTaskManifest = {
    schemaVersion: '0.3', skillName: metadata.name, title: metadata.name,
    description: `${metadata.description} 由 CUA 子 Agent 执行此电脑操作任务。`, goal: metadata.goal,
    source: {
      tracePath: 'source/showui-trace.json', processedLogPath: 'source/processed-log-sc.json',
      conversionCommand: 'cua skill create-from-recording', stepBindings: built.stepBindings,
    }, inputs: built.inputs,
  };
  const document: JsonObject = {
    computer: {}, agent: { groupName: metadata.name, groupDescription: metadata.goal, generateReport: true }, tasks: built.tasks,
  };
  const marker: CuaSkillManifest = { schemaVersion: '0.1', kind: 'cua-skill', skillName: metadata.name, taskSchemaVersion: '0.3' };
  await writeFile(path.join(stage, 'SKILL.md'), markdown, 'utf8');
  await writeYamlDocument(path.join(stage, 'task.yaml'), document);
  await writeJsonFile(path.join(stage, 'task.json'), manifest);
  await writeJsonFile(path.join(stage, 'cua-manifest.json'), marker);
}

export async function createSkillFromRecording(options: {
  recording: string; skillsRoot: string; executionRoot?: string; pythonExecutable?: string;
}, dependencies: { runRecorder?: typeof runRecordingParser } = {}): Promise<{
  created: true; valid: true; skillName: string; goal: string;
}> {
  if (!path.isAbsolute(options.skillsRoot)) throw new Error('请配置绝对路径 CUA_SKILLS_ROOT');
  const executionRoot = options.executionRoot ?? packageRoot;
  const pythonExecutable = await resolvePythonExecutable(options.pythonExecutable, {
    executionRoot, devProjectRoot: path.resolve(executionRoot, '..', 'record'),
  });
  await (dependencies.runRecorder ?? runRecordingParser)({ pythonExecutable, recordingPath: options.recording, progress: process.stderr });
  const assets = await generatedAssets(options.recording);
  const metadata = readGeneratedSkillMetadata(await readShowuiTrace(assets.tracePath));
  await installSkill(options.skillsRoot, metadata.name, stage => assembleSkill(stage, options.recording, metadata, assets));
  return { created: true, valid: true, skillName: metadata.name, goal: metadata.goal };
}
