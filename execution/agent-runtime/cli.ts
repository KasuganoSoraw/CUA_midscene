#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNaturalLanguageAiAct } from '../cua/act/execution.js';
import { requireDataPaths, resolveRuntimeLayout } from '../cua/data-paths.js';

type AgentCliOptions = {
  prompt: string;
  dataRoot?: string;
  displayId?: string;
  dryRun: boolean;
};

export class AgentCliUsageError extends Error {
  readonly exitCode = 2;
}

export const agentHelpText = `CUA Agent Runtime

用法：cua act run --prompt <电脑操作要求> [options]

选项：
  --data-root <path>   外部可写数据根；也可配置 CUA_DATA_ROOT
  --display-id <id>    指定 Midscene ComputerDevice 显示器
  --dry-run            只校验参数并生成运行报告，不操作电脑或调用模型
  --help, -h           显示帮助
`;

function parseAgentCli(argv: string[]): AgentCliOptions {
  if (argv[0] !== 'act' || argv[1] !== 'run') {
    throw new AgentCliUsageError('Agent Runtime 仅支持命令：cua act run --prompt <电脑操作要求>');
  }

  const values = new Map<string, string>();
  let dryRun = false;
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      if (dryRun) throw new AgentCliUsageError('参数 --dry-run 不能重复提供');
      dryRun = true;
      continue;
    }
    if (!['--prompt', '--data-root', '--display-id'].includes(token)) {
      throw new AgentCliUsageError(`无法识别参数：${token}`);
    }
    if (values.has(token)) throw new AgentCliUsageError(`参数 ${token} 不能重复提供`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new AgentCliUsageError(`参数 ${token} 缺少值`);
    }
    values.set(token, value);
    index += 1;
  }

  const prompt = values.get('--prompt');
  if (prompt === undefined) throw new AgentCliUsageError('必须提供 --prompt');
  return {
    prompt,
    dryRun,
    ...(values.has('--data-root') ? { dataRoot: values.get('--data-root') } : {}),
    ...(values.has('--display-id') ? { displayId: values.get('--display-id') } : {}),
  };
}

export async function runAgentCliCommand(argv: string[]): Promise<string> {
  const options = parseAgentCli(argv);
  const layout = await resolveRuntimeLayout(options.dataRoot);
  const data = await requireDataPaths(layout);
  const run = await runNaturalLanguageAiAct({
    prompt: options.prompt,
    runsRoot: data.runsRoot,
    dryRun: options.dryRun,
    ...(options.displayId === undefined ? {} : { displayId: options.displayId }),
  });
  return `${JSON.stringify({
    mode: 'prompt',
    runDir: run.runDirectory,
    promptPath: run.promptPath,
    resultPath: run.resultPath,
    executor: run.executorResult,
  }, null, 2)}\n`;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(agentHelpText);
    return;
  }
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => console.error(...args);
  console.warn = (...args: unknown[]) => console.error(...args);
  try {
    process.stdout.write(await runAgentCliCommand(argv));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof AgentCliUsageError ? error.exitCode : 1;
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
