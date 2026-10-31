import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import type { CuaSkillManifest, GenerationLanguage, JsonObject, ShowuiTrace, SkillTaskManifest } from '../contracts/types.js';
import { readProcessedLog, readShowuiTrace, writeJsonFile } from '../contracts/validation.js';
import { buildRecordedSteps } from '../conversion/showui-trace.js';
import { packageRoot } from '../package-root.js';
import { resolvePythonExecutable } from '../python-worker.js';
import { copyGeneratedAssets, generatedAssets, runRecordingParser } from '../recording/create-task.js';
import { writeYamlDocument } from '../task/yaml-task.js';
import { resolveSkillExportRoot } from '../data-paths.js';
import { readSkill } from './assets.js';
import { createSkillArchive } from './archive.js';
import { availableSkillName, occupiedSkillNames } from './names.js';
import { importSkillArchive, resolveSkillImportEndpoint, skillImportUrl, SkillImportError } from './host-import.js';
import { assertContained, requireSkillName, safeSkillFile } from './paths.js';

export interface GeneratedSkillMetadata { name: string; description: string; goal: string }

export function readGeneratedSkillMetadata(trace: ShowuiTrace): GeneratedSkillMetadata {
  const value = trace.skill as Partial<GeneratedSkillMetadata> | undefined;
  if (!value || typeof value.name !== 'string' || typeof value.description !== 'string' || !value.description.trim()
    || typeof value.goal !== 'string' || !value.goal.trim()) throw new Error('录制模型未生成完整 Skill 名称、描述和目标');
  return { name: requireSkillName(value.name), description: value.description.trim(), goal: value.goal.trim() };
}

function skillDescription(metadata: GeneratedSkillMetadata, language: GenerationLanguage): string {
  return language === 'en-US'
    ? `${metadata.description} The Computer-Use SubAgent performs this desktop task.`
    : `${metadata.description} 由 CUA 子 Agent 执行此电脑操作任务。`;
}

export function skillMarkdown(metadata: GeneratedSkillMetadata, language: GenerationLanguage = 'zh-CN'): string {
  const description = skillDescription(metadata, language);
  const exampleInput = language === 'en-US'
    ? ['<parameter-id-from-task.json>', '<user-value-or-nonempty-default>']
    : ['<task.json 中的参数 ID>', '<用户提供值或非空默认值>'];
  const example = JSON.stringify({ execution: {
    skillName: metadata.name, strategy: 'guided', inputs: { [exampleInput[0]]: exampleInput[1] },
  } }, null, 2);
  const instructions = language === 'en-US'
    ? `Before each execution, read the adjacent \`task.json\`. Its \`inputs\` object defines the current
parameter IDs, labels, descriptions, and defaults. Use values supplied by the user; otherwise use a
non-empty default. If a default is empty and the user has not supplied a value, ask the user before
delegating. Do not guess a value or treat the example as the parameter list.

Delegate the complete task and resolved inputs to the Computer-Use SubAgent. Bind
\`execution.skillName\` to \`${metadata.name}\` and pass \`execution.inputs\` as an object mapping
parameter IDs to string values, not as a serialized JSON string. Use \`guided\` by default; use
\`replay\` only when strict replay is explicitly requested. Do not search for another task or pass
file paths to the SubAgent.

Example binding (replace the placeholders using \`task.json.inputs\`; use \`{}\` when there are no inputs):

\`\`\`json
${example}
\`\`\`
`
    : `每次执行前先读取同目录的 \`task.json\`。其中 \`inputs\` 的键是当前参数 ID，
\`label\`、\`description\` 用于理解参数，\`default\` 是当前默认值。优先使用用户提供的值；
未提供时可使用非空默认值；默认值为空且用户未提供时，先向用户询问，得到答复后再委派。
不要猜测参数值，也不要把下方示例当作实际参数清单。

将完整任务和确定的参数委派给 Computer-Use SubAgent。\`execution.skillName\` 使用
\`${metadata.name}\`，\`execution.inputs\` 是以参数 ID 为键、字符串值为值的对象，
不是序列化后的 JSON 字符串。默认使用 \`guided\`；仅在明确要求严格回放时使用 \`replay\`。
不要重新搜索任务或把文件路径交给子 Agent。

调用绑定示例（参数 ID 和值以执行前读取的 \`task.json.inputs\` 为准；无参数时使用 \`{}\`）：

\`\`\`json
${example}
\`\`\`
`;
  return `---\n${stringify({ name: metadata.name, description }).trim()}\n---\n\n# ${metadata.name}\n\n${metadata.goal}\n\n`
    + instructions;
}

async function assembleSkill(stage: string, recording: string, metadata: GeneratedSkillMetadata,
  assets: Awaited<ReturnType<typeof generatedAssets>>, language: GenerationLanguage): Promise<void> {
  for (const file of [assets.tracePath, assets.processedLogPath, assets.processedLogScPath]) {
    await safeSkillFile(recording, path.relative(recording, file));
  }
  for (const file of assets.screenshotPaths) await safeSkillFile(recording, file);
  await copyGeneratedAssets(recording, path.join(stage, 'source'), assets);
  const [trace, processed] = await Promise.all([readShowuiTrace(assets.tracePath), readProcessedLog(assets.processedLogScPath)]);
  const built = buildRecordedSteps(trace, processed, language);
  const markdown = skillMarkdown(metadata, language);
  const manifest: SkillTaskManifest = {
    schemaVersion: '0.3', skillName: metadata.name, title: metadata.name,
    description: skillDescription(metadata, language), goal: metadata.goal,
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

async function exportSkill(exportRoot: string, recording: string, metadata: GeneratedSkillMetadata,
  assets: Awaited<ReturnType<typeof generatedAssets>>, language: GenerationLanguage): Promise<string> {
  const workspace = await mkdtemp(path.join(exportRoot, 'cua-skill-export-'));
  const stage = path.join(workspace, metadata.name);
  const zipPath = path.join(workspace, `${metadata.name}.zip`);
  try {
    await mkdir(stage);
    await assembleSkill(stage, recording, metadata, assets, language);
    await createSkillArchive(stage, metadata.name, zipPath);
    return zipPath;
  } catch (error) {
    await rm(assertContained(exportRoot, workspace), { recursive: true, force: true });
    throw error;
  }
}

export async function createSkillFromRecording(options: {
  recording: string; skillsRoot: string; executionRoot?: string; pythonExecutable?: string; language?: GenerationLanguage;
}, dependencies: { runRecorder?: typeof runRecordingParser; fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<{
  created: true; valid: true; skillName: string; goal: string; zipPath: string;
}> {
  if (!path.isAbsolute(options.skillsRoot)) throw new Error('请配置绝对路径 CUA_SKILLS_ROOT');
  const executionRoot = options.executionRoot ?? packageRoot;
  const endpoint = await resolveSkillImportEndpoint(executionRoot);
  const exportRoot = await resolveSkillExportRoot(options.skillsRoot, executionRoot);
  const pythonExecutable = await resolvePythonExecutable(options.pythonExecutable, {
    executionRoot, devProjectRoot: path.resolve(executionRoot, '..', 'record'),
  });
  await (dependencies.runRecorder ?? runRecordingParser)({
    pythonExecutable, recordingPath: options.recording, progress: process.stderr,
    ...(options.language ? { language: options.language } : {}),
  });
  const assets = await generatedAssets(options.recording);
  const metadata = readGeneratedSkillMetadata(await readShowuiTrace(assets.tracePath));
  metadata.name = availableSkillName(metadata.name, await occupiedSkillNames(options.skillsRoot));
  const zipPath = await exportSkill(exportRoot, options.recording, metadata, assets, options.language ?? 'zh-CN');
  await importSkillArchive({ url: skillImportUrl(metadata.name, endpoint), skillName: metadata.name, zipPath }, dependencies);
  try { await readSkill(options.skillsRoot, metadata.name); }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SkillImportError(`GDEClaw 已报告导入成功，但正式目录中的 Skill 无法读取；请检查 CUA_SKILLS_ROOT 与 default workspace 配置及资产完整性：${detail}`, zipPath);
  }
  return { created: true, valid: true, skillName: metadata.name, goal: metadata.goal, zipPath };
}
