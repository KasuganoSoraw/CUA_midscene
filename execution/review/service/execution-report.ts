import { realpath, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readExecutorResult } from '../../cua/contracts/validation.js';

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function resolveExecutionReport(runsRoot: string, runId: string): Promise<string> {
  try {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,160}$/.test(runId)) throw new Error('运行标识无效');
    const root = await realpath(runsRoot);
    const run = await realpath(path.join(root, runId));
    if (!within(root, run)) throw new Error('运行目录越出数据根目录');
    const resultPath = await realpath(path.join(run, 'execution-result.json'));
    if (!within(run, resultPath)) throw new Error('结果文件越出运行目录');
    const result = await readExecutorResult(resultPath);
    if (typeof result.reportPath !== 'string' || path.extname(result.reportPath).toLowerCase() !== '.html') throw new Error('没有 HTML 执行报告');
    const report = await realpath(path.resolve(run, result.reportPath));
    if (!within(run, report) || !(await stat(report)).isFile()) throw new Error('报告不是运行目录内的文件');
    return report;
  } catch {
    throw Object.assign(new Error('本次运行没有可用的执行报告'), { statusCode: 404 });
  }
}

export async function openExecutionReportFile(
  reportPath: string,
  spawnProcess: typeof spawn = spawn,
): Promise<void> {
  const command = process.platform === 'win32' ? 'explorer.exe'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(command, [reportPath], {
      detached: true, shell: false, stdio: 'ignore', windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
