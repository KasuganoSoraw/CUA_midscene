import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { failedRunDirectory } from '../cua/run-directory.js';
import { readExecutorResult, readNativeAiActExecutorResult } from '../cua/contracts/validation.js';
import { existingMidsceneHtmlReport } from '../executors/midscene-report.js';

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..'
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function failedExecutionReport(error: unknown, strategy: unknown): Promise<string | undefined> {
  const runDirectory = failedRunDirectory(error);
  if (!runDirectory || !['replay', 'guided', 'freeform'].includes(String(strategy))) return undefined;
  try {
    const runsRoot = await realpath(path.dirname(runDirectory));
    const runRoot = await realpath(runDirectory);
    if (!within(runsRoot, runRoot)) return undefined;
    const resultFilename = strategy === 'freeform' ? 'ai-act-result.json' : 'execution-result.json';
    const resultPath = await realpath(path.join(runRoot, resultFilename));
    if (!within(runRoot, resultPath)) return undefined;
    const result = strategy === 'freeform'
      ? await readNativeAiActExecutorResult(resultPath)
      : await readExecutorResult(resultPath);
    if (result.status !== 'failed' || typeof result.reportPath !== 'string') return undefined;
    const report = await realpath(path.resolve(runRoot, result.reportPath));
    if (!within(runRoot, report)) return undefined;
    return await existingMidsceneHtmlReport(report);
  } catch {
    // 诊断产物不可用时保留原始执行错误，不编造报告路径。
    return undefined;
  }
}
