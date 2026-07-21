#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CliUsageError,
  helpText as cuaHelpText,
  runCliCommand as runCuaCliCommand,
} from '../cua/cli/main.js';
import { openSystemBrowser, startReviewServer, type StartedReviewServer } from '../review/server/main.js';

export const helpText = `${cuaHelpText.trimEnd()}

本地复核：
  review [--data-root <path>] [--no-open] [--json]
`;

function reviewOptions(argv: string[]): { dataRoot?: string; noOpen: boolean; json: boolean } {
  const result: { dataRoot?: string; noOpen: boolean; json: boolean } = { noOpen: false, json: false };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--no-open') result.noOpen = true;
    else if (token === '--json') result.json = true;
    else if (token === '--data-root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new CliUsageError(`参数 ${token} 缺少值`);
      result.dataRoot = value;
      index += 1;
    } else if (token === '--help' || token === '-h') {
      continue;
    } else throw new CliUsageError(`无法识别参数：${token}`);
  }
  return result;
}

export async function runCliCommand(
  argv: string[],
  dependencies: { startReview?: typeof startReviewServer; openBrowser?: typeof openSystemBrowser } = {},
): Promise<string> {
  if (argv[0] !== 'review') return runCuaCliCommand(argv);
  if (argv.includes('--help') || argv.includes('-h')) return helpText;
  const options = reviewOptions(argv);
  const started: StartedReviewServer = await (dependencies.startReview ?? startReviewServer)({
    ...(options.dataRoot ? { dataRoot: options.dataRoot } : {}),
  });
  if (!options.noOpen) (dependencies.openBrowser ?? openSystemBrowser)(started.url);
  return options.json
    ? `${JSON.stringify({ url: started.url, host: '127.0.0.1' }, null, 2)}\n`
    : `复核页面已启动：${started.url}\n`;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(helpText);
    return;
  }
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => console.error(...args);
  console.warn = (...args: unknown[]) => console.error(...args);
  try {
    process.stdout.write(await runCliCommand(argv));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof CliUsageError ? error.exitCode : 1;
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
