import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveExecutionReport } from '../../review/service/execution-report.js';
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
  const server = await startReviewServer({ dataRoot: root, port: 0 });
  try {
    const response = await fetch(new URL('/api/execution/runs/test-run/report', server.url));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.ok(!(response.headers.get('content-security-policy') ?? '').includes('allow-same-origin'));
    assert.equal(await response.text(), '<html>execution report</html>');
    assert.equal((await fetch(new URL('/api/execution/runs/missing/report', server.url))).status, 404);
  } finally { await server.close(); }
  await writeFile(path.join(root, 'outside.html'), 'private');
  await writeFile(path.join(run, 'execution-result.json'), JSON.stringify({ ...result, reportPath: path.join(root, 'outside.html') }));
  await assert.rejects(resolveExecutionReport(runs, 'test-run'));
  await writeFile(path.join(run, 'execution-result.json'), JSON.stringify({ ...result, reportPath: path.join(run, 'task.yaml') }));
  await assert.rejects(resolveExecutionReport(runs, 'test-run'));
});
