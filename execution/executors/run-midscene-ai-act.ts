import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { composeAiActPrompt } from './ai-act-prompt.js';
import { createKeyboardEnabledComputerAgent } from './computer-agent.js';
import { checkRequiredModelEnv, warnIfNodeVersionIsOld } from './env.js';
import { readResolvedFlow, type ResolvedFlowSnapshot } from './resolved-flow-contract.js';

type AiActMode = 'prompt' | 'task';

interface RunOptions {
  promptFilePath?: string;
  resolvedFlowPath?: string;
  resultPath: string;
  dryRun: boolean;
}

interface AiActExecutorResult {
  schemaVersion: '0.1';
  status: 'succeeded' | 'failed';
  mode?: AiActMode;
  scene?: string;
  task?: string;
  promptPath?: string;
  sourcePath?: string;
  dryRun: boolean;
  aiActResult?: string;
  finishedAt: string;
  error?: string;
}

interface PreparedPrompt {
  mode: AiActMode;
  prompt: string;
  sourcePath: string;
  flow?: ResolvedFlowSnapshot;
}

export const AI_ACT_CONTEXT = [
  '文本输入必须遵守以下规则：',
  '1. 输入内容全部属于 KeyboardTypeText 支持的 ASCII 字符时，只能使用 KeyboardTypeText，不得使用默认 Input。',
  '2. 只有待输入文本包含 KeyboardTypeText 不支持的字符时，才允许使用默认 Input。',
  '3. 不得因为定位失败、动作失败或其他一般执行错误，改用默认 Input；应直接暴露失败。',
  '4. KeyboardTypeText 会自行定位其 locate 参数描述的输入目标，不需要预先额外点击同一输入框。',
].join('\n');

function parseArgs(argv: string[]): RunOptions {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--dry-run') {
      if (dryRun) throw new Error('参数 --dry-run 不能重复提供');
      dryRun = true;
      continue;
    }
    if (!['--prompt-file', '--resolved-flow', '--result'].includes(current)) {
      throw new Error(`无法识别参数：${current}`);
    }
    if (values.has(current)) throw new Error(`参数 ${current} 不能重复提供`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${current} 缺少值`);
    values.set(current, value);
    index += 1;
  }

  const result = values.get('--result');
  if (!result) throw new Error('必须提供 --result <path>');
  return {
    promptFilePath: values.get('--prompt-file')
      ? path.resolve(values.get('--prompt-file') as string)
      : undefined,
    resolvedFlowPath: values.get('--resolved-flow')
      ? path.resolve(values.get('--resolved-flow') as string)
      : undefined,
    resultPath: path.resolve(result),
    dryRun,
  };
}

async function preparePrompt(options: RunOptions): Promise<PreparedPrompt> {
  if (Boolean(options.promptFilePath) === Boolean(options.resolvedFlowPath)) {
    throw new Error('必须且只能提供 --prompt-file 或 --resolved-flow 其中一个');
  }

  if (options.promptFilePath) {
    let prompt: string;
    try {
      prompt = (await readFile(options.promptFilePath, 'utf8')).trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`读取自然语言 prompt 失败：${options.promptFilePath}\n${message}`);
    }
    if (!prompt) throw new Error('自然语言 prompt 不能为空');
    return { mode: 'prompt', prompt, sourcePath: options.promptFilePath };
  }

  const sourcePath = options.resolvedFlowPath as string;
  const flow = await readResolvedFlow(sourcePath);
  return {
    mode: 'task',
    prompt: composeAiActPrompt(flow),
    sourcePath,
    flow,
  };
}

async function writeResult(resultPath: string, result: AiActExecutorResult): Promise<void> {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function executeAiAct(prepared: PreparedPrompt): Promise<string | undefined> {
  warnIfNodeVersionIsOld();
  checkRequiredModelEnv();
  const label = prepared.flow
    ? `${prepared.flow.flow.scene}-${prepared.flow.flow.task}`
    : 'natural-language';
  const agent = await createKeyboardEnabledComputerAgent({
    generateReport: true,
    groupName: `midscene-ai-act-${label}`,
    groupDescription: prepared.flow
      ? `使用 aiAct 执行录制任务：${prepared.flow.flow.scene}/${prepared.flow.flow.task}`
      : '使用 aiAct 执行自然语言电脑操作',
    aiActContext: AI_ACT_CONTEXT,
  });
  try {
    return await agent.aiAct(prepared.prompt);
  } finally {
    await agent.destroy();
  }
}

async function run(options: RunOptions): Promise<void> {
  let prepared: PreparedPrompt | undefined;
  let promptPath: string | undefined;
  try {
    prepared = await preparePrompt(options);
    promptPath = path.join(path.dirname(options.resultPath), 'ai-act-prompt.txt');
    await mkdir(path.dirname(promptPath), { recursive: true });
    await writeFile(promptPath, `${prepared.prompt}\n`, 'utf8');

    let aiActResult: string | undefined;
    if (options.dryRun) {
      console.error(prepared.prompt);
    } else {
      aiActResult = await executeAiAct(prepared);
    }

    await writeResult(options.resultPath, {
      schemaVersion: '0.1',
      status: 'succeeded',
      mode: prepared.mode,
      scene: prepared.flow?.flow.scene,
      task: prepared.flow?.flow.task,
      promptPath,
      sourcePath: prepared.sourcePath,
      dryRun: options.dryRun,
      ...(aiActResult === undefined ? {} : { aiActResult }),
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeResult(options.resultPath, {
      schemaVersion: '0.1',
      status: 'failed',
      mode: prepared?.mode,
      scene: prepared?.flow?.flow.scene,
      task: prepared?.flow?.flow.task,
      promptPath,
      sourcePath: prepared?.sourcePath ?? options.promptFilePath ?? options.resolvedFlowPath,
      dryRun: options.dryRun,
      finishedAt: new Date().toISOString(),
      error: message,
    });
    throw error;
  }
}

let options: RunOptions;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  process.exit();
}

run(options).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
