import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseYamlScript } from '@midscene/core/yaml';
import {
  createKeyboardEnabledComputerAgent,
  type ComputerAgentOptions,
} from './computer-agent.js';
import { checkRequiredModelEnv, warnIfNodeVersionIsOld } from './env.js';

interface RunOptions {
  yamlPath: string;
  resultPath: string;
  dryRun: boolean;
}

interface ExecutorResult {
  schemaVersion: '0.2';
  status: 'succeeded' | 'failed';
  sourceYamlPath: string;
  dryRun: boolean;
  taskCount?: number;
  midsceneResult?: Record<string, unknown>;
  finishedAt: string;
  error?: string;
}

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
    if (current !== '--yaml' && current !== '--result') {
      throw new Error(`无法识别参数：${current}`);
    }
    if (values.has(current)) throw new Error(`参数 ${current} 不能重复提供`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${current} 缺少值`);
    values.set(current, value);
    index += 1;
  }
  const yaml = values.get('--yaml');
  const result = values.get('--result');
  if (!yaml) throw new Error('必须提供 --yaml <path>');
  if (!result) throw new Error('必须提供 --result <path>');
  return {
    yamlPath: path.resolve(yaml),
    resultPath: path.resolve(result),
    dryRun,
  };
}

async function writeResult(resultPath: string, result: ExecutorResult): Promise<void> {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function readScript(yamlPath: string) {
  let content: string;
  try {
    content = await readFile(yamlPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取 Midscene YAML 失败：${yamlPath}\n${message}`);
  }
  const script = parseYamlScript(content, yamlPath);
  if (!Array.isArray(script.tasks) || script.tasks.length === 0) {
    throw new Error('Midscene YAML tasks 必须是非空数组');
  }
  return { content, script };
}

async function executeYaml(content: string, script: ReturnType<typeof parseYamlScript>) {
  warnIfNodeVersionIsOld();
  checkRequiredModelEnv();
  const options: ComputerAgentOptions = {
    ...(script.agent ?? {}),
    ...(script.computer?.displayId ? { displayId: script.computer.displayId } : {}),
    generateReport: script.agent?.generateReport ?? true,
    groupName: script.agent?.groupName ?? 'midscene-yaml-task',
    groupDescription: script.agent?.groupDescription ?? '执行 Midscene YAML 电脑操作任务',
  };
  const agent = await createKeyboardEnabledComputerAgent(options);
  try {
    return await agent.runYaml(content);
  } finally {
    await agent.destroy();
  }
}

async function run(options: RunOptions): Promise<void> {
  let taskCount: number | undefined;
  try {
    const { content, script } = await readScript(options.yamlPath);
    taskCount = script.tasks.length;
    let midsceneResult: Record<string, unknown> | undefined;
    if (!options.dryRun) {
      const execution = await executeYaml(content, script);
      midsceneResult = execution.result;
    }
    await writeResult(options.resultPath, {
      schemaVersion: '0.2',
      status: 'succeeded',
      sourceYamlPath: options.yamlPath,
      dryRun: options.dryRun,
      taskCount,
      ...(midsceneResult === undefined ? {} : { midsceneResult }),
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeResult(options.resultPath, {
      schemaVersion: '0.2',
      status: 'failed',
      sourceYamlPath: options.yamlPath,
      dryRun: options.dryRun,
      taskCount,
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
