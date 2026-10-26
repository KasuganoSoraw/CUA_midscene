import { mkdir, open, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  JsonObject,
  ProcessedLogStep,
  SceneManifest,
  ShowuiTrace,
  ShowuiTraceOperation,
  TaskCatalogRoots,
  TaskInputDefinition,
  TaskManifest,
} from '../contracts/types.js';
import {
  readProcessedLog,
  readSceneManifest,
  readShowuiTrace,
  writeJsonFile,
} from '../contracts/validation.js';
import { requireIdentifier } from '../task/tasks.js';
import { writeYamlDocument } from '../task/yaml-task.js';

export const minRecordedWaitMs = 200;
export const maxRecordedWaitMs = 30_000;

export interface ConvertOptions {
  scene: string;
  task: string;
  goal: string;
  catalog: TaskCatalogRoots;
  conversionCommand: string;
  recordingPreparationCommand?: string;
  traceGenerationCommand?: string;
}

async function pathExists(sourcePath: string): Promise<boolean> {
  try {
    await stat(sourcePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function writeTextIfMissing(sourcePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(sourcePath), { recursive: true });
  try {
    const file = await open(sourcePath, 'wx');
    try {
      await file.writeFile(content, 'utf8');
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

export function sceneSkillContent(scene: string): string {
  return `---
name: ${scene}
description: 发现和调用 ${scene} 场景中的本地 CUA 任务。
---

# ${scene} 场景

本文件供 CLI 使用者和任务维护者阅读；Python CUA Agent 通过私有 catalog Tool 获取结构化描述，不直接加载该 Markdown。

运行 \`npm run cua -- task list --scene ${scene} --json\` 发现任务，再按需读取目标任务的 \`SKILL.md\`、\`task.json\` 和 \`task.yaml\`。
`;
}

export function taskSkillContent(scene: string, task: string): string {
  return `---
name: ${task}
description: 调用和维护 ${scene}/${task} 本地 CUA 任务。
---

# ${task} 任务

本文件属于 Executor 管理的用户任务数据包，不作为独立 GDEClaw Skill 注册，也不由 Python CUA Agent 加入模型上下文。使用 \`npm run cua -- task describe --scene ${scene} --task ${task} --json\` 读取输入定义和 \`origin\`、\`writable\`。

本任务的执行流程是 \`task.yaml\`，输入契约是 \`task.json\`，\`source/\` 是只读录制证据。调用、校准和执行模式遵循执行器根 \`SKILL.md\`；本文件只提供任务特有信息，不覆盖根 Skill 的确认与只读规则。
`;
}

function requiredOperationText(value: string | null | undefined, field: string, step: number): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new Error(`trace step ${step} 的 operation.${field} 不能为空`);
  return normalized;
}

export function clampRecordedWaitMs(recordedGapMs: number): number {
  if (recordedGapMs < minRecordedWaitMs) return 0;
  return Math.min(recordedGapMs, maxRecordedWaitMs);
}

function actionFromOperation(
  operation: ShowuiTraceOperation,
  step: number,
  processedStep: ProcessedLogStep,
): { actions: JsonObject[]; input?: [string, TaskInputDefinition] } {
  if (operation.type === 'click' || operation.type === 'doubleClick' || operation.type === 'rightClick') {
    const prompt = requiredOperationText(operation.prompt, 'prompt', step);
    const actionName = { click: 'aiTap', doubleClick: 'aiDoubleClick', rightClick: 'aiRightClick' }[operation.type];
    if (operation.useReferenceImage) {
      const rawReferencePath = processedStep.screenshot_reference?.trim();
      if (!rawReferencePath) {
        throw new Error(`trace step ${step} 请求视觉参考，但 processed log 缺少 screenshot_reference`);
      }
      const normalized = rawReferencePath.replaceAll('\\', '/');
      if (path.win32.isAbsolute(rawReferencePath) || path.posix.isAbsolute(normalized)) {
        throw new Error(`trace step ${step} 的 screenshot_reference 必须是 source 内相对路径：${rawReferencePath}`);
      }
      const referenceUrl = path.posix.normalize(`source/${normalized}`);
      if (!referenceUrl.startsWith('source/') || referenceUrl === 'source') {
        throw new Error(`trace step ${step} 的 screenshot_reference 越出 source：${rawReferencePath}`);
      }
      const stepId = `step-${String(step).padStart(3, '0')}`;
      const imageName = `${stepId}-target`;
      return {
        actions: [{
          [actionName]: null,
          locate: {
            prompt: `${prompt}。目标外观应匹配参考图“${imageName}”正中央的主要图标，参考图周边仅用于辅助理解`,
            images: [{ name: imageName, url: referenceUrl }],
          },
        }],
      };
    }
    return { actions: [{ [actionName]: prompt }] };
  }
  if (operation.useReferenceImage) {
    throw new Error(`trace step ${step} 只有点击动作可以使用视觉参考`);
  }
  if (operation.type === 'input') {
    const prompt = requiredOperationText(operation.prompt, 'prompt', step);
    const locate = requiredOperationText(operation.locatePrompt, 'locatePrompt', step);
    const isPaste = processedStep.action === 'Paste text';
    const value = isPaste
      ? processedStep.clipboard_text
      : requiredOperationText(operation.value, 'value', step);
    if (typeof value !== 'string' || !value.length) {
      throw new Error(`trace step ${step} 的粘贴文本不能为空`);
    }
    const inputId = `step-${String(step).padStart(3, '0')}-input`;
    return {
      actions: isPaste
        ? [
          { KeyboardPress: { keyName: 'End', locate: { prompt: locate } } },
          { aiInput: null, value: `{{${inputId}}}`, mode: 'typeOnly' },
        ]
        : [{ KeyboardTypeText: { locate, value: `{{${inputId}}}`, mode: 'replace' } }],
      input: [inputId, { type: 'string', label: locate, description: prompt, default: value }],
    };
  }
  if (operation.type === 'keyboard') {
    return { actions: [{ KeyboardPress: { keyName: requiredOperationText(operation.key, 'key', step) } }] };
  }
  if (operation.type === 'aiAct') {
    return { actions: [{ ai: requiredOperationText(operation.prompt, 'prompt', step) }] };
  }
  const condition = requiredOperationText(operation.condition, 'condition', step);
  return {
    actions: [{
      aiWaitFor: operation.prompt?.trim() || condition,
      timeout: 15_000,
    }],
  };
}

function isRecordedScroll(step: ProcessedLogStep): boolean {
  return /^Scroll(?:Up|Down)\b/i.test(step.action ?? '');
}

function scrollInstruction(operation: ShowuiTraceOperation, source: ProcessedLogStep, step: number): string {
  if (operation.type !== 'aiAct') throw new Error(`trace step ${step} 的滚动必须使用 aiAct operation`);
  const direction = /^ScrollDown\b/i.test(source.action ?? '') ? '向下' : '向上';
  const count = Number.isInteger(source.scroll_count) && Number(source.scroll_count) > 0
    ? `约 ${source.scroll_count} 次滚轮` : '一段';
  return `${direction}滚动${count}。滚动区域和目的：${requiredOperationText(operation.prompt, 'prompt', step)}`;
}

function followingInstruction(
  operation: ShowuiTraceOperation,
  source: ProcessedLogStep,
  step: number,
): { prompt: string; images: JsonObject[] } {
  if (operation.type === 'click' || operation.type === 'doubleClick' || operation.type === 'rightClick') {
    const action = actionFromOperation(operation, step, source).actions[0];
    const locate = action.locate as JsonObject | undefined;
    return {
      prompt: locate ? String(locate.prompt) : requiredOperationText(operation.prompt, 'prompt', step),
      images: locate ? locate.images as JsonObject[] : [],
    };
  }
  if (operation.type === 'input') {
    const locate = requiredOperationText(operation.locatePrompt, 'locatePrompt', step);
    const value = source.action === 'Paste text'
      ? source.clipboard_text
      : requiredOperationText(operation.value, 'value', step);
    if (typeof value !== 'string' || !value.length) throw new Error(`trace step ${step} 的输入文本不能为空`);
    const instruction = source.action === 'Paste text'
      ? `在${locate}中将${JSON.stringify(value)}追加到现有内容末尾`
      : `在${locate}中输入${JSON.stringify(value)}`;
    return { prompt: instruction, images: [] };
  }
  if (operation.type === 'keyboard') {
    return { prompt: `按下 ${requiredOperationText(operation.key, 'key', step)} 键`, images: [] };
  }
  if (operation.type === 'wait') {
    return { prompt: `等待${requiredOperationText(operation.condition, 'condition', step)}`, images: [] };
  }
  return { prompt: requiredOperationText(operation.prompt, 'prompt', step), images: [] };
}

export function buildTaskAssets(
  trace: ShowuiTrace,
  processedSteps: ProcessedLogStep[],
  options: ConvertOptions,
): { document: JsonObject; manifest: TaskManifest } {
  if (!trace.trajectory.length) throw new Error('trace trajectory 不能为空');
  if (trace.trajectory.length !== processedSteps.length) {
    throw new Error(`trace step 数量 ${trace.trajectory.length} 与 processed log 数量 ${processedSteps.length} 不一致`);
  }
  const tasks: JsonObject[] = [];
  const inputs: Record<string, TaskInputDefinition> = {};
  let previousTimestamp: number | undefined;
  const stepBindings: Record<string, number | number[]> = {};
  let previousSourceStep = 0;
  for (const [sourceIndex, traceStep] of trace.trajectory.entries()) {
    if (traceStep.step_idx <= previousSourceStep) {
      throw new Error('trace step_idx 必须为正整数、唯一且按轨迹顺序严格递增');
    }
    if (traceStep.step_idx !== sourceIndex + 1) {
      throw new Error('trace step_idx 必须从 1 开始连续编号');
    }
    previousSourceStep = traceStep.step_idx;
  }

  for (let index = 0; index < trace.trajectory.length;) {
    const step = tasks.length + 1;
    const stepId = `step-${String(step).padStart(3, '0')}`;
    const flow: JsonObject[] = [];
    if (previousTimestamp !== undefined) {
      const gap = Math.max(0, Math.floor((processedSteps[index].timestamp - previousTimestamp) * 1000 + 0.5));
      const wait = clampRecordedWaitMs(gap);
      if (wait) flow.push({ sleep: wait });
    }
    if (isRecordedScroll(processedSteps[index])) {
      const sources: number[] = [];
      const instructions: string[] = [];
      while (index < trace.trajectory.length && isRecordedScroll(processedSteps[index])) {
        const sourceStep = trace.trajectory[index];
        sources.push(sourceStep.step_idx);
        instructions.push(scrollInstruction(sourceStep.caption.operation, processedSteps[index], sourceStep.step_idx));
        index += 1;
      }
      let images: JsonObject[] = [];
      if (index < trace.trajectory.length) {
        const next = trace.trajectory[index];
        const action = followingInstruction(next.caption.operation, processedSteps[index], step);
        instructions.push(action.prompt);
        images = action.images;
        sources.push(next.step_idx);
        index += 1;
      }
      const prompt = `按顺序完成以下电脑操作，完成后停止，不要重复执行：${instructions.map((item, itemIndex) => `${itemIndex + 1}. ${item}`).join('；')}`;
      flow.push({ ai: images.length ? { prompt, images } : prompt });
      tasks.push({ name: `${stepId} | aiAct`, flow });
      stepBindings[stepId] = sources.length === 1 ? sources[0] : sources;
    } else {
      const sourceStep = trace.trajectory[index];
      const mapped = actionFromOperation(sourceStep.caption.operation, step, processedSteps[index]);
      flow.push(...mapped.actions);
      tasks.push({ name: `${stepId} | ${sourceStep.caption.operation.type}`, flow });
      if (mapped.input) inputs[mapped.input[0]] = mapped.input[1];
      stepBindings[stepId] = sourceStep.step_idx;
      index += 1;
    }
    previousTimestamp = processedSteps[index - 1].timestamp;
  }

  return {
    document: {
      computer: {},
      agent: { groupName: options.task, groupDescription: options.goal, generateReport: true },
      tasks,
    },
    manifest: {
      schemaVersion: '0.2',
      scene: options.scene,
      task: options.task,
      title: options.task,
      description: options.goal,
      goal: options.goal,
      source: {
        tracePath: 'source/showui-trace.json',
        processedLogPath: 'source/processed-log-sc.json',
        conversionCommand: options.conversionCommand,
        stepBindings,
        ...(options.recordingPreparationCommand
          ? { recordingPreparationCommand: options.recordingPreparationCommand }
          : {}),
        ...(options.traceGenerationCommand ? { traceGenerationCommand: options.traceGenerationCommand } : {}),
      },
      inputs,
    },
  };
}

export async function convertTrace(options: ConvertOptions): Promise<string> {
  if (!options.catalog.userProjectsRoot) throw new Error('初始化任务需要用户 projects 目录');
  const scene = requireIdentifier(options.scene, 'scene');
  const task = requireIdentifier(options.task, 'task');
  const userProjects = path.resolve(options.catalog.userProjectsRoot);
  const taskRoot = path.resolve(userProjects, scene, task);
  const taskYamlPath = path.join(taskRoot, 'task.yaml');
  const taskManifestPath = path.join(taskRoot, 'task.json');
  await ensureTraceTarget(options, scene, task, taskYamlPath, taskManifestPath);

  const sourceRoot = path.join(taskRoot, 'source');
  const [trace, processedSteps] = await Promise.all([
    readShowuiTrace(path.join(sourceRoot, 'showui-trace.json')),
    readProcessedLog(path.join(sourceRoot, 'processed-log-sc.json')),
  ]);
  const assets = buildTaskAssets(trace, processedSteps, options);
  await validateReferenceImages(assets.document, taskRoot);
  const sceneManifest = await sourceSceneManifest(options, scene);

  await mkdir(taskRoot, { recursive: true });
  await writeYamlDocument(taskYamlPath, assets.document);
  await writeJsonFile(taskManifestPath, assets.manifest);
  const sceneRoot = path.dirname(taskRoot);
  if (!(await pathExists(path.join(sceneRoot, 'scene.json')))) {
    await writeJsonFile(path.join(sceneRoot, 'scene.json'), sceneManifest);
  }
  await writeTextIfMissing(path.join(sceneRoot, 'SKILL.md'), sceneSkillContent(scene));
  await writeTextIfMissing(path.join(taskRoot, 'SKILL.md'), taskSkillContent(scene, task));
  return taskYamlPath;
}

async function ensureTraceTarget(
  options: ConvertOptions, scene: string, task: string, taskYamlPath: string, taskManifestPath: string,
): Promise<void> {
  if (options.catalog.builtinProjectsRoot) {
    const builtinTask = path.resolve(options.catalog.builtinProjectsRoot, scene, task);
    if (await pathExists(path.join(builtinTask, 'task.json'))) throw new Error(`内置任务不可覆盖：${builtinTask}`);
  }
  const existing: string[] = [];
  for (const candidate of [taskYamlPath, taskManifestPath]) if (await pathExists(candidate)) existing.push(candidate);
  if (existing.length) throw new Error(`任务资产已存在，拒绝覆盖：${existing.join(', ')}`);
}

async function sourceSceneManifest(options: ConvertOptions, scene: string): Promise<SceneManifest> {
  const builtinScenePath = options.catalog.builtinProjectsRoot
    ? path.join(options.catalog.builtinProjectsRoot, scene, 'scene.json') : undefined;
  if (builtinScenePath && (await pathExists(builtinScenePath))) return readSceneManifest(builtinScenePath);
  return { schemaVersion: '0.1', scene, title: scene, description: `${scene} 场景任务集合` };
}

async function validateReferenceImages(document: JsonObject, taskRoot: string): Promise<void> {
  for (const task of document.tasks as JsonObject[]) {
    for (const action of task.flow as JsonObject[]) {
      for (const prompt of [action.locate, action.ai]) {
        if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) continue;
        const images = (prompt as JsonObject).images;
        if (!Array.isArray(images)) continue;
        for (const image of images) {
          if (!image || typeof image !== 'object' || Array.isArray(image) || typeof image.url !== 'string') {
            throw new Error(`${String(task.name)} 包含非法参考图定义`);
          }
          const absoluteImagePath = path.resolve(taskRoot, image.url);
          const relative = path.relative(taskRoot, absoluteImagePath);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`${String(task.name)} 的参考图越出任务目录：${image.url}`);
          }
          if (!(await pathExists(absoluteImagePath)) || !(await stat(absoluteImagePath)).isFile()) {
            throw new Error(`${String(task.name)} 的参考图不存在：${absoluteImagePath}`);
          }
        }
      }
    }
  }
}
