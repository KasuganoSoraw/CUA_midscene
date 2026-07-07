import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MIDSCENE_FLOW_SCHEMA_VERSION,
  type MidsceneFlow,
  type MidsceneFlowEvidence,
  type MidsceneFlowRoute,
  type MidsceneFlowStep,
} from './types.js';

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
  };
}

interface ProcessedLogStep {
  action?: string;
  screenshot_full?: string;
  screenshot_crop?: string;
}

interface ConvertOptions {
  project: string;
  goal: string;
  projectRoot: string;
  recordingPreparationCommand?: string;
  traceGenerationCommand?: string;
  flowExecutionCommand?: string;
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

  return {
    project,
    goal: options.get('goal') ?? '',
    projectRoot: options.get('project-root') ?? path.join('projects', project),
    recordingPreparationCommand: options.get('recording-preparation-command'),
    traceGenerationCommand: options.get('trace-generation-command'),
    flowExecutionCommand: options.get('flow-execution-command'),
  };
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

function targetFromAction(action: string): string {
  return action
    .replace(/^Click\s+/i, '')
    .replace(/^the\s+/i, '')
    .replace(/\.$/, '')
    .trim();
}

function isBlankOrUnsafeClick(action: string, observation: string): boolean {
  const text = `${action}\n${observation}`.toLowerCase();
  return text.includes('blank region') || text.includes('empty tab strip') || text.includes('no visible text or icon');
}

function routeStep(action: string, observation: string, expectation: string): MidsceneFlowRoute {
  if (/press\s+enter/i.test(action)) {
    return { strategy: 'keyboard', keyName: 'Enter' };
  }

  if (/^type\s+/i.test(action)) {
    return {
      strategy: 'input',
      target: targetFromAction(action),
      value: extractQuotedValue(action) ?? action.replace(/^Type\s+/i, '').trim(),
      mode: 'replace',
    };
  }

  if (/^click\s+/i.test(action)) {
    if (isBlankOrUnsafeClick(action, observation)) {
      return {
        strategy: 'manual-review',
        reason: '该点击目标疑似为空白区域或非语义控件，不能安全自动执行。',
      };
    }

    if (/date-picker|calendar|dropdown|button|field|option|radio|search result|link/i.test(action)) {
      return { strategy: 'tap', target: targetFromAction(action) };
    }

    return {
      strategy: 'act',
      instruction: action,
    };
  }

  if (/visible|loaded|navigate|will navigate/i.test(expectation)) {
    return {
      strategy: 'wait',
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
    instruction: action,
  };
}

function buildStep(traceStep: ShowuiTraceStep, processedStep: ProcessedLogStep | undefined): MidsceneFlowStep {
  const caption = traceStep.caption;
  const observation = caption.observation ?? '';
  const action = caption.action ?? '';
  const expectation = caption.expectation ?? '';
  const route = routeStep(action, observation, expectation);
  const evidence: MidsceneFlowEvidence = {
    observation,
    thought: caption.think,
    action,
    expectation,
    screenshot: normalizeSourceScreenshotPath(processedStep?.screenshot_full),
    crop: normalizeSourceScreenshotPath(processedStep?.screenshot_crop),
  };

  return {
    id: `step-${String(traceStep.step_idx).padStart(3, '0')}`,
    sourceTrace: {
      stepIndex: traceStep.step_idx,
      rawAction: processedStep?.action,
    },
    intent: caption.think ?? action,
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
      recordingPreparation:
        options.recordingPreparationCommand ??
        '将 ShowUI-Aloha 录制视频和输入日志放入 showui-aloha\\Aloha_Learn\\projects\\air_tickets\\inputs',
      traceGeneration:
        options.traceGenerationCommand ??
        'uv run python Aloha_Learn\\parser.py Aloha_Learn\\projects\\air_tickets',
      traceToFlowConversion: 'npm run flow:convert:air',
      flowExecution: options.flowExecutionCommand ?? 'npm run flow:run:air',
    },
    steps: trace.trajectory.map((step, index) => buildStep(step, processedSteps[index])),
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
