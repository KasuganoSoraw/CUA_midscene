import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MIDSCENE_FLOW_SCHEMA_VERSION,
  type MidsceneFlow,
  type MidsceneFlowEvidence,
  type MidsceneFlowRoute,
  type MidsceneFlowStep,
  type MidsceneTraceOperation,
} from './types.js';
import { deriveInputLocatePrompt } from './input-locate-prompt.js';

interface ShowuiTrace {
  trajectory: ShowuiTraceStep[];
}

interface ShowuiTraceStep {
  step_idx: number;
  caption: {
    observation?: string;
    think?: string;
    action?: string;
    expectation?: string;
    operation?: ShowuiTraceOperation;
  };
}

interface ShowuiTraceOperation {
  type?: string;
  prompt?: string;
  locatePrompt?: string;
  value?: string;
  key?: string;
  condition?: string;
}

interface ProcessedLogStep {
  timestamp?: number;
  action?: string;
  screenshot_full?: string;
  screenshot_crop?: string;
}

const MIN_RECORDED_WAIT_MS = 200;
const MAX_RECORDED_WAIT_MS = 3000;

interface ConvertOptions {
  project: string;
  goal: string;
  projectRoot: string;
  conversionCommand: string;
  recordingPreparationCommand?: string;
  traceGenerationCommand?: string;
  flowExecutionCommand?: string;
}

function quoteCommandValue(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function buildConversionCommand(project: string, goal: string): string {
  const args = [`--project ${project}`];
  if (goal) {
    args.push(`--goal ${quoteCommandValue(goal)}`);
  }

  return `npm run flow:convert -- ${args.join(' ')}`;
}

function parseArgs(argv: string[]): ConvertOptions {
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`参数 --${key} 缺少值`);
    }
    options.set(key, value);
    i += 1;
  }

  const project = options.get('project');
  if (!project) {
    throw new Error('必须提供 --project <project-name>');
  }

  const goal = options.get('goal') ?? '';

  return {
    project,
    goal,
    projectRoot: options.get('project-root') ?? path.join('projects', project),
    conversionCommand: buildConversionCommand(project, goal),
    recordingPreparationCommand: options.get('recording-preparation-command'),
    traceGenerationCommand: options.get('trace-generation-command'),
    flowExecutionCommand: options.get('flow-execution-command'),
  };
}

function defaultRecordingPreparationCommand(project: string): string {
  if (project === 'air-tickets-demo') {
    return '将 ShowUI-Aloha 录制视频和输入日志放入 showui-aloha\\Aloha_Learn\\projects\\air_tickets\\inputs';
  }

  return `将该项目的录制视频和输入日志放入对应 ShowUI-Aloha Learn project，并将生成产物复制到 CUA_midscene\\projects\\${project}\\source`;
}

function defaultTraceGenerationCommand(project: string): string {
  if (project === 'air-tickets-demo') {
    return 'uv run python Aloha_Learn\\parser.py Aloha_Learn\\projects\\air_tickets';
  }

  return `未记录；请通过 --trace-generation-command 提供 ${project} 的 ShowUI-Aloha trace 生成命令`;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取 JSON 失败：${filePath}\n${message}`);
  }
}

function normalizeSourceScreenshotPath(sourcePath: string | undefined): string | undefined {
  if (!sourcePath) return undefined;
  return path.posix.join('source', sourcePath.replaceAll('\\', '/'));
}

function extractQuotedValue(action: string): string | undefined {
  const match = action.match(/['"]([^'"]+)['"]/);
  return match?.[1];
}

function extractChineseInputValue(action: string): string | undefined {
  const match = action.match(/(?:输入|键入|录入)(?:文本|文字|内容)?\s*([^。；，,.;]+)/);
  return match?.[1]?.trim();
}

function targetFromAction(action: string): string {
  return action
    .replace(/^Click\s+/i, '')
    .replace(/^点击\s*/i, '')
    .replace(/^the\s+/i, '')
    .replace(/\.$/, '')
    .replace(/。$/, '')
    .trim();
}

function normalizeTraceOperation(operation: ShowuiTraceOperation | undefined): MidsceneTraceOperation | undefined {
  if (!operation?.type) return undefined;

  const type = operation.type.trim().toLowerCase();
  const prompt = operation.prompt?.trim();
  const locatePrompt = operation.locatePrompt?.trim();
  const value = operation.value?.trim();
  const key = operation.key?.trim();
  const condition = operation.condition?.trim();

  if (type === 'click' && prompt) {
    return { type: 'click', prompt };
  }

  if (type === 'input' && prompt && value) {
    return { type: 'input', prompt, locatePrompt: locatePrompt ?? deriveInputLocatePrompt(prompt), value };
  }

  if (type === 'keyboard' && key) {
    return { type: 'keyboard', prompt, key };
  }

  if (type === 'wait' && condition) {
    return { type: 'wait', prompt, condition };
  }

  return { type: 'unknown', prompt };
}

function routeFromOperation(operation: MidsceneTraceOperation | undefined): MidsceneFlowRoute | undefined {
  if (!operation || operation.type === 'unknown') return undefined;

  switch (operation.type) {
    case 'click':
      return { strategy: 'tap', prompt: operation.prompt };
    case 'input':
      return {
        strategy: 'input',
        prompt: operation.prompt,
        locatePrompt: operation.locatePrompt ?? deriveInputLocatePrompt(operation.prompt),
        value: operation.value,
        mode: 'replace',
        inputMethod: 'keyboard-action',
      };
    case 'keyboard':
      return { strategy: 'keyboard', keyName: operation.key };
    case 'wait':
      return { strategy: 'wait', prompt: operation.prompt, condition: operation.condition, timeoutMs: 15000 };
  }
}

function routeStep(action: string, expectation: string, rawAction: string | undefined): MidsceneFlowRoute {
  if (/press\s+enter/i.test(rawAction ?? action) || /(?:按|按下).*(?:enter|回车)/i.test(action)) {
    return { strategy: 'keyboard', keyName: 'Enter' };
  }

  if (/^type\s*:/i.test(rawAction ?? '')) {
    return {
      strategy: 'input',
      prompt: action,
      locatePrompt: deriveInputLocatePrompt(action),
      value: (rawAction ?? '').replace(/^Type\s*:\s*/i, '').trim(),
      mode: 'replace',
      inputMethod: 'keyboard-action',
    };
  }

  if (/^click\s+/i.test(action) || /^点击/.test(action)) {
    if (/date-picker|calendar|dropdown|button|field|option|radio|search result|link/i.test(action)) {
      return { strategy: 'tap', prompt: targetFromAction(action) };
    }

    if (/日期|日历|下拉|按钮|输入框|字段|选项|建议项|单选|搜索结果|链接/.test(action)) {
      return { strategy: 'tap', prompt: targetFromAction(action) };
    }

    return {
      strategy: 'act',
      prompt: action,
    };
  }

  if (/^type\s+/i.test(action) || /(?:输入|键入|录入)/.test(action)) {
    return {
      strategy: 'input',
      prompt: action,
      locatePrompt: deriveInputLocatePrompt(action),
      value: extractQuotedValue(action) ?? extractChineseInputValue(action) ?? action.replace(/^Type\s+/i, '').trim(),
      mode: 'replace',
      inputMethod: 'keyboard-action',
    };
  }

  if (/visible|loaded|navigate|will navigate/i.test(expectation)) {
    return {
      strategy: 'wait',
      prompt: expectation,
      condition: expectation,
      timeoutMs: 15000,
    };
  }

  return {
    strategy: 'manual-review',
    reason: '无法根据 ShowUI-Aloha action 稳定推断 Midscene 执行策略。',
  };
}

function buildFallback(route: MidsceneFlowRoute, action: string) {
  if (route.strategy === 'manual-review') {
    return {
      strategy: 'fail' as const,
      reason: route.reason,
    };
  }

  return {
    strategy: 'vision' as const,
    instruction: 'prompt' in route && route.prompt ? route.prompt : action,
  };
}

function clampRecordedWaitMs(recordedGapMs: number): number {
  if (recordedGapMs < MIN_RECORDED_WAIT_MS) return 0;
  return Math.min(recordedGapMs, MAX_RECORDED_WAIT_MS);
}

function buildTiming(processedStep: ProcessedLogStep | undefined, previousProcessedStep: ProcessedLogStep | undefined) {
  if (typeof processedStep?.timestamp !== 'number' || typeof previousProcessedStep?.timestamp !== 'number') {
    return undefined;
  }

  const recordedGapMs = Math.max(0, Math.round((processedStep.timestamp - previousProcessedStep.timestamp) * 1000));
  const waitBeforeMs = clampRecordedWaitMs(recordedGapMs);
  if (waitBeforeMs <= 0) {
    return { recordedGapMs };
  }

  return {
    recordedGapMs,
    waitBeforeMs,
    waitReason: 'recorded-step-gap' as const,
  };
}

function buildStep(
  traceStep: ShowuiTraceStep,
  processedStep: ProcessedLogStep | undefined,
  previousProcessedStep: ProcessedLogStep | undefined,
): MidsceneFlowStep {
  const caption = traceStep.caption;
  const observation = caption.observation ?? '';
  const action = caption.action ?? '';
  const expectation = caption.expectation ?? '';
  const operation = normalizeTraceOperation(caption.operation);
  const route = routeFromOperation(operation) ?? routeStep(action, expectation, processedStep?.action);
  const evidence: MidsceneFlowEvidence = {
    observation,
    thought: caption.think,
    action,
    expectation,
    operation,
    screenshot: normalizeSourceScreenshotPath(processedStep?.screenshot_full),
    crop: normalizeSourceScreenshotPath(processedStep?.screenshot_crop),
  };

  return {
    id: `step-${String(traceStep.step_idx).padStart(3, '0')}`,
    sourceTrace: {
      stepIndex: traceStep.step_idx,
      rawAction: processedStep?.action,
      timestampSec: processedStep?.timestamp,
    },
    intent: caption.think ?? action,
    timing: buildTiming(processedStep, previousProcessedStep),
    evidence,
    route,
    fallback: buildFallback(route, action),
  };
}

async function convert(options: ConvertOptions): Promise<string> {
  const projectRoot = path.resolve(options.projectRoot);
  const sourceRoot = path.join(projectRoot, 'source');
  const tracePath = path.join(sourceRoot, 'showui-trace.json');
  const processedLogPath = path.join(sourceRoot, 'processed-log.json');
  const processedLogWithScreenshotsPath = path.join(sourceRoot, 'processed-log-sc.json');
  const screenshotsDir = path.join(sourceRoot, 'screenshots');
  const outputPath = path.join(projectRoot, 'ir', 'midscene-flow.json');

  const trace = await readJsonFile<ShowuiTrace>(tracePath);
  if (!Array.isArray(trace.trajectory)) {
    throw new Error(`无效 trace：${tracePath} 缺少 trajectory 数组`);
  }

  const processedSteps = await readJsonFile<ProcessedLogStep[]>(processedLogWithScreenshotsPath);
  if (!Array.isArray(processedSteps)) {
    throw new Error(`无效 processed log：${processedLogWithScreenshotsPath} 不是数组`);
  }

  const flow: MidsceneFlow = {
    schemaVersion: MIDSCENE_FLOW_SCHEMA_VERSION,
    project: options.project,
    goal: options.goal,
    source: {
      tracePath: path.posix.join('source', 'showui-trace.json'),
      processedLogPath: path.posix.join('source', 'processed-log.json'),
      processedLogWithScreenshotsPath: path.posix.join('source', 'processed-log-sc.json'),
      screenshotsDir: path.posix.join('source', 'screenshots'),
    },
    commands: {
      recordingPreparation: options.recordingPreparationCommand ?? defaultRecordingPreparationCommand(options.project),
      traceGeneration: options.traceGenerationCommand ?? defaultTraceGenerationCommand(options.project),
      traceToFlowConversion: options.conversionCommand,
      flowExecution: options.flowExecutionCommand ?? `npm run flow:run -- --project ${options.project}`,
    },
    steps: trace.trajectory.map((step, index) => buildStep(step, processedSteps[index], processedSteps[index - 1])),
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(flow, null, 2)}\n`, 'utf8');

  console.log(`已生成 Midscene flow：${outputPath}`);
  console.log(`源 trace：${tracePath}`);
  console.log(`源日志：${processedLogPath}`);
  console.log(`截图目录：${screenshotsDir}`);
  return outputPath;
}

convert(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
