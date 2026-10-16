import assert from 'node:assert/strict';
import { type ChildProcess, type spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openExecutionReportFile, resolveExecutionReport } from '../../review/service/execution-report.js';
import { startReviewServer } from '../../review/server/main.js';

test('执行报告仅从运行目录内读取，报告使用隔离的 HTML 上下文', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-report-'));
  const runs = path.join(root, 'runs');
  const run = path.join(runs, 'test-run');
  const report = path.join(run, 'report.html');
  await mkdir(run, { recursive: true });
  await writeFile(report, '<html>execution report</html>');
  const result = { schemaVersion: '0.2', status: 'failed', sourceYamlPath: path.join(run, 'task.yaml'), dryRun: false, finishedAt: new Date().toISOString(), error: 'failed', reportPath: report };
  await writeFile(path.join(run, 'execution-result.json'), JSON.stringify(result));
  assert.equal(await resolveExecutionReport(runs, 'test-run'), report);
  await assert.rejects(resolveExecutionReport(runs, '..'));
  const opened: string[] = [];
  let failOpen = false;
  const server = await startReviewServer({ dataRoot: root, port: 0, dependencies: {
    openReport: async (reportPath) => {
      if (failOpen) throw new Error('opener unavailable');
      opened.push(reportPath);
    },
  } });
  try {
    const response = await fetch(new URL('/api/execution/runs/test-run/report', server.url));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.ok(!(response.headers.get('content-security-policy') ?? '').includes('allow-same-origin'));
    assert.match(response.headers.get('content-security-policy') ?? '', /connect-src 'none'/);
    assert.match(response.headers.get('content-security-policy') ?? '', /form-action 'none'/);
    assert.equal(await response.text(), '<html>execution report</html>');
    assert.equal((await fetch(new URL('/api/execution/runs/missing/report', server.url))).status, 404);
    const openUrl = new URL('/api/execution/runs/test-run/report/open', server.url);
    const openResponse = await fetch(openUrl, { method: 'POST', headers: { origin: new URL(server.url).origin } });
    assert.equal(openResponse.status, 200);
    assert.deepEqual(await openResponse.json(), { opened: true, reportPath: report });
    assert.deepEqual(opened, [report]);
    failOpen = true;
    const failedOpen = await fetch(openUrl, { method: 'POST' });
    assert.equal(failedOpen.status, 400);
    assert.deepEqual(await failedOpen.json(), { error: 'opener unavailable' });
    failOpen = false;
    assert.equal((await fetch(openUrl, { method: 'POST', headers: { origin: 'https://other.example' } })).status, 403);
    assert.equal((await fetch(openUrl, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(new URL('/api/execution/runs/missing/report/open', server.url), { method: 'POST' })).status, 404);
    await writeFile(path.join(root, 'outside.html'), 'private');
    await writeFile(path.join(run, 'execution-result.json'), JSON.stringify({ ...result, reportPath: path.join(root, 'outside.html') }));
    assert.equal((await fetch(openUrl, { method: 'POST' })).status, 404);
    assert.deepEqual(opened, [report]);
  } finally { await server.close(); }
  await writeFile(path.join(root, 'outside.html'), 'private');
  await writeFile(path.join(run, 'execution-result.json'), JSON.stringify({ ...result, reportPath: path.join(root, 'outside.html') }));
  await assert.rejects(resolveExecutionReport(runs, 'test-run'));
  await writeFile(path.join(run, 'execution-result.json'), JSON.stringify({ ...result, reportPath: path.join(run, 'task.yaml') }));
  await assert.rejects(resolveExecutionReport(runs, 'test-run'));
});

test('本地报告以单个文件路径参数交给系统打开，不使用 shell，并传播启动错误', async () => {
  const report = path.resolve(os.tmpdir(), '报告 & 100% 示例.html');
  let unref = false;
  const platformCommands: Record<string, string> = { win32: 'explorer.exe', darwin: 'open' };
  const launch = ((command: string, args: string[], options: Record<string, unknown>) => {
    assert.equal(command, platformCommands[process.platform] ?? 'xdg-open');
    assert.deepEqual(args, [report]);
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter() as ChildProcess;
    child.unref = () => { unref = true; };
    queueMicrotask(() => child.emit('spawn'));
    return child;
  }) as typeof spawn;
  await openExecutionReportFile(report, launch);
  assert.equal(unref, true);
  const fail = (() => {
    const child = new EventEmitter() as ChildProcess;
    queueMicrotask(() => child.emit('error', new Error('opener unavailable')));
    return child;
  }) as typeof spawn;
  await assert.rejects(openExecutionReportFile(report, fail), /opener unavailable/);
});
