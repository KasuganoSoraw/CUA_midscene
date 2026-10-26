import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutorResult, JsonObject, ResolvedTaskResult, TaskCatalogRoots } from '../contracts/types.js';
import { executeMidsceneYaml, type MidsceneYamlExecutionOptions } from '../../executors/midscene-yaml.js';
import type { ExecutionProgressSink } from '../../executors/midscene-progress.js';
import { keyboardInputAiActContext } from '../../executors/computer-agent.js';
import { withRunDirectory } from '../run-directory.js';
import { resolveTask } from './tasks.js';
import { resolveSkillTask } from '../skills/assets.js';
import { validateYamlDocument, writeYamlDocument } from './yaml-task.js';

export const aiActContext = keyboardInputAiActContext;

interface ExecutionOptionsBase {
  runsRoot: string;
  inputs?: Record<string, string>;
  dryRun?: boolean;
  onProgress?: ExecutionProgressSink;
  executor?: typeof executeMidsceneYaml;
}

export type ExecutionOptions = ExecutionOptionsBase & (
  | { scene: string; task: string; catalog: TaskCatalogRoots; skillName?: never; skillsRoot?: never }
  | { skillName: string; skillsRoot: string; scene?: never; task?: never; catalog?: never }
);

async function resolveExecutionTask(options: ExecutionOptions): Promise<ResolvedTaskResult> {
  if (options.skillName !== undefined) return resolveSkillTask({ ...options, skillsRoot: options.skillsRoot });
  return resolveTask(options);
}

export interface TaskRun {
  resolved: ResolvedTaskResult;
  resolvedTaskPath: string;
  executorResult: ExecutorResult;
}

export interface RecordedTaskAiActRun extends TaskRun {
  promptPath: string;
  aiActYamlPath: string;
}

export interface RecordedTaskAiActPrompt {
  prompt: string;
  images: Array<{ name: string; url: string }>;
  convertHttpImage2Base64?: boolean;
}

function requiredString(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${context} 的 ${field} 必须是非空字符串`);
  return value.trim();
}

function readUserPrompt(value: unknown, field: string, context: string): RecordedTaskAiActPrompt {
  if (typeof value === 'string') return { prompt: requiredString(value, field, context), images: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} 的 ${field} 必须是非空字符串或 Midscene 图片 prompt`);
  }
  const userPrompt = value as JsonObject;
  const allowed = new Set(['prompt', 'images', 'convertHttpImage2Base64']);
  const unexpected = Object.keys(userPrompt).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`${context} 的 ${field} 包含无法解释的字段：${unexpected.sort().join(', ')}`);
  if (!Array.isArray(userPrompt.images) || userPrompt.images.length === 0) {
    throw new Error(`${context} 的 ${field}.images 必须是非空数组`);
  }
  const images = userPrompt.images.map((image, index) => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      throw new Error(`${context} 的 ${field}.images[${index}] 必须是对象`);
    }
    const item = image as JsonObject;
    return {
      name: requiredString(item.name, `${field}.images[${index}].name`, context),
      url: requiredString(item.url, `${field}.images[${index}].url`, context),
    };
  });
  if (userPrompt.convertHttpImage2Base64 !== undefined && typeof userPrompt.convertHttpImage2Base64 !== 'boolean') {
    throw new Error(`${context} 的 ${field}.convertHttpImage2Base64 必须是布尔值`);
  }
  return {
    prompt: requiredString(userPrompt.prompt, `${field}.prompt`, context),
    images,
    ...(userPrompt.convertHttpImage2Base64 === true ? { convertHttpImage2Base64: true } : {}),
  };
}

function renderAction(action: JsonObject, context: string): RecordedTaskAiActPrompt | undefined {
  const name = validatedActionName(action, context);
  if (name === 'sleep') return undefined;
  const value = action[name];
  if (name === 'aiTap' || name === 'aiDoubleClick' || name === 'aiRightClick') {
    const hasLocate = Object.hasOwn(action, 'locate');
    if (hasLocate && value !== null && value !== undefined) {
      throw new Error(`${context} 使用 locate 时 ${name} 的值必须为空`);
    }
    const locatedPrompt = readUserPrompt(hasLocate ? action.locate : value, hasLocate ? 'locate' : name, context);
    return {
      ...locatedPrompt,
      prompt: name === 'aiTap'
        ? locatedPrompt.prompt
        : `${name === 'aiRightClick' ? '右键点击' : '双击'}以下描述对应的目标：${JSON.stringify(locatedPrompt.prompt)}`,
    };
  }
  if (name === 'ai') return readUserPrompt(value, name, context);
  if (name === 'aiWaitFor') return { prompt: requiredString(value, name, context), images: [] };
  if (name === 'aiInput') return renderInput(action, context);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} 的 ${name} 必须是对象`);
  const parameters = value as JsonObject;
  if (name === 'KeyboardPress') {
    const locate = parameters.locate;
    const target = locate === undefined ? ''
      : `在 ${JSON.stringify(requiredString(
        locate && typeof locate === 'object' && !Array.isArray(locate) ? (locate as JsonObject).prompt : locate,
        'KeyboardPress.locate', context,
      ))} 中`;
    return {
      prompt: `${target}按下 ${JSON.stringify(requiredString(parameters.keyName, 'KeyboardPress.keyName', context))} 键`,
      images: [],
    };
  }
  return renderKeyboardTypeText(parameters, context);
}

function validatedActionName(action: JsonObject, context: string): string {
  if (Object.hasOwn(action, 'sleep')) {
    if (Object.keys(action).length !== 1) throw new Error(`${context} 的 sleep 不能与其他字段组合`);
    if (!Number.isInteger(action.sleep)) throw new Error(`${context} 的 sleep 必须是整数`);
    return 'sleep';
  }
  const supported = ['ai', 'aiDoubleClick', 'aiRightClick', 'aiTap', 'aiInput', 'aiWaitFor', 'KeyboardPress', 'KeyboardTypeText'];
  const names = supported.filter((name) => Object.hasOwn(action, name));
  if (names.length !== 1) {
    throw new Error(`${context} 必须且只能包含一个受支持动作，当前字段：${Object.keys(action).sort().join(', ') || '空动作'}`);
  }
  const name = names[0];
  const allowed = new Set([name]);
  if (name === 'aiWaitFor') allowed.add('timeout');
  if (name === 'aiTap' || name === 'aiDoubleClick') allowed.add('locate');
  if (name === 'aiRightClick') allowed.add('locate');
  if (name === 'aiInput') for (const field of ['locate', 'value', 'mode']) allowed.add(field);
  const unexpected = Object.keys(action).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`${context} 包含无法解释的字段：${unexpected.sort().join(', ')}`);
  return name;
}

function renderInput(parameters: JsonObject, context: string): RecordedTaskAiActPrompt {
  const locate = parameters.locate === undefined
    ? '当前焦点输入框' : requiredString(parameters.locate, 'aiInput.locate', context);
  if (typeof parameters.value !== 'string' || !parameters.value.length) {
    throw new Error(`${context} 的 aiInput.value 必须是非空字符串`);
  }
  const value = parameters.value;
  if (!['replace', 'typeOnly', 'append'].includes(String(parameters.mode))) {
    throw new Error(`${context} 的 aiInput.mode 不受支持`);
  }
  const verb = parameters.mode === 'replace' ? '替换输入' : '追加输入';
  return { prompt: `在 ${JSON.stringify(locate)} 中${verb} ${JSON.stringify(value)}`, images: [] };
}

function renderKeyboardTypeText(parameters: JsonObject, context: string): RecordedTaskAiActPrompt {
  const locate = requiredString(parameters.locate, 'locate', context);
  if (typeof parameters.value !== 'string') throw new Error(`${context} 的 KeyboardTypeText.value 必须是字符串`);
  const mode = parameters.mode ?? 'replace';
  if (!['replace', 'append', 'typeOnly', 'clear'].includes(String(mode))) {
    throw new Error(`${context} 的 KeyboardTypeText.mode 不受支持：${String(mode)}`);
  }
  if (mode === 'clear') return { prompt: `使用 KeyboardTypeText 清空 ${JSON.stringify(locate)}`, images: [] };
  const modeText = { replace: '替换输入', append: '追加输入', typeOnly: '直接输入' }[mode as 'replace'];
  return {
    prompt: `使用 KeyboardTypeText 在 ${JSON.stringify(locate)} 中${modeText} ${JSON.stringify(parameters.value)}`,
    images: [],
  };
}

export function buildRecordedTaskAiActPrompt(document: JsonObject): RecordedTaskAiActPrompt {
  validateYamlDocument(document, 'recorded task aiAct prompt');
  const lines = ['请严格按以下步骤顺序完成电脑操作：'];
  const images = new Map<string, string>();
  let convertHttpImage2Base64 = false;
  for (const task of document.tasks as JsonObject[]) {
    const taskName = String(task.name).trim();
    const rendered = (task.flow as JsonObject[])
      .map((action, index) => renderAction(action, `${taskName} 的 flow[${index + 1}]`))
      .filter((value): value is RecordedTaskAiActPrompt => value !== undefined);
    if (!rendered.length) throw new Error(`${taskName} 没有可用于整体 aiAct 的执行动作`);
    for (const item of rendered) {
      convertHttpImage2Base64 ||= item.convertHttpImage2Base64 === true;
      for (const image of item.images) {
        const existing = images.get(image.name);
        if (existing !== undefined && existing !== image.url) {
          throw new Error(`整体 aiAct 参考图名称冲突：${image.name} 同时指向 ${existing} 和 ${image.url}`);
        }
        images.set(image.name, image.url);
      }
    }
    lines.push(`${taskName}:`, ...rendered.map((item, index) => `  ${index + 1}. ${item.prompt}`));
  }
  return {
    prompt: `${lines.join('\n')}\n`,
    images: [...images].map(([name, url]) => ({ name, url })),
    ...(convertHttpImage2Base64 ? { convertHttpImage2Base64: true } : {}),
  };
}

export function aiActYamlDocument(
  prompt: string | RecordedTaskAiActPrompt,
  groupName: string,
  groupDescription: string,
  taskName: string,
): JsonObject {
  return {
    computer: {},
    agent: { groupName, groupDescription, generateReport: true, aiActContext },
    tasks: [{ name: taskName, flow: [{ ai: prompt }] }],
  };
}

async function execute(
  yamlPath: string,
  runDirectory: string,
  dryRun: boolean,
  executor: typeof executeMidsceneYaml,
  onProgress?: ExecutionProgressSink,
): Promise<ExecutorResult> {
  const options: MidsceneYamlExecutionOptions = {
    yamlPath,
    resultPath: path.join(runDirectory, 'execution-result.json'),
    runDirectory,
    dryRun,
    ...(onProgress === undefined ? {} : { onProgress }),
  };
  return executor(options);
}

export async function runTask(options: ExecutionOptions): Promise<TaskRun> {
  const resolved = await resolveExecutionTask(options);
  return withRunDirectory(options.runsRoot, async (runDirectory) => {
    const resolvedTaskPath = path.join(runDirectory, 'resolved-task.yaml');
    await writeYamlDocument(resolvedTaskPath, resolved.document);
    const executorResult = await execute(
      resolvedTaskPath,
      runDirectory,
      options.dryRun ?? false,
      options.executor ?? executeMidsceneYaml,
      options.onProgress,
    );
    return { resolved, resolvedTaskPath, executorResult };
  });
}

export async function runRecordedTaskAiAct(options: ExecutionOptions): Promise<RecordedTaskAiActRun> {
  const resolved = await resolveExecutionTask(options);
  const taskPrompt = buildRecordedTaskAiActPrompt(resolved.document);
  return withRunDirectory(options.runsRoot, async (runDirectory) => {
    const resolvedTaskPath = path.join(runDirectory, 'resolved-task.yaml');
    const promptPath = path.join(runDirectory, 'ai-act-prompt.txt');
    const aiActYamlPath = path.join(runDirectory, 'ai-act-task.yaml');
    await writeYamlDocument(resolvedTaskPath, resolved.document);
    await writeFile(promptPath, taskPrompt.prompt, 'utf8');
    await writeYamlDocument(
      aiActYamlPath,
      aiActYamlDocument(
        taskPrompt.images.length ? taskPrompt : taskPrompt.prompt,
        `${options.skillName ?? options.task}-ai-act`,
        resolved.manifest.goal,
        '录制任务整体 aiAct',
      ),
    );
    const executorResult = await execute(
      aiActYamlPath,
      runDirectory,
      options.dryRun ?? false,
      options.executor ?? executeMidsceneYaml,
      options.onProgress,
    );
    return { resolved, resolvedTaskPath, promptPath, aiActYamlPath, executorResult };
  });
}

export async function runPrompt(options: {
  prompt: string;
  runsRoot: string;
  dryRun?: boolean;
  executor?: typeof executeMidsceneYaml;
}): Promise<{ yamlPath: string; executorResult: ExecutorResult }> {
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error('自然语言 prompt 不能为空');
  return withRunDirectory(options.runsRoot, async (runDirectory) => {
    const yamlPath = path.join(runDirectory, 'resolved-task.yaml');
    await writeYamlDocument(
      yamlPath,
      aiActYamlDocument(prompt, 'natural-language-ai-act', '执行无录制自然语言电脑操作', '自然语言电脑操作'),
    );
    const executorResult = await execute(
      yamlPath,
      runDirectory,
      options.dryRun ?? false,
      options.executor ?? executeMidsceneYaml,
    );
    return { yamlPath, executorResult };
  });
}
