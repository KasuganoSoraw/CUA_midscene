import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { readExecutorResult } from '../../cua/contracts/validation.js';

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function resolveExecutionReport(runsRoot: string, runId: string): Promise<string> {
  try {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,160}$/.test(runId)) throw new Error('Invalid run identifier');
    const root = await realpath(runsRoot);
    const run = await realpath(path.join(root, runId));
    if (!within(root, run)) throw new Error('Run outside runs root');
    const resultPath = await realpath(path.join(run, 'execution-result.json'));
    if (!within(run, resultPath)) throw new Error('Result outside run directory');
    const result = await readExecutorResult(resultPath);
    if (typeof result.reportPath !== 'string' || path.extname(result.reportPath).toLowerCase() !== '.html') throw new Error('No HTML report');
    const report = await realpath(path.resolve(run, result.reportPath));
    if (!within(run, report) || !(await stat(report)).isFile()) throw new Error('Report outside run directory');
    return report;
  } catch {
    throw Object.assign(new Error('本次运行没有可用的执行报告'), { statusCode: 404 });
  }
}
