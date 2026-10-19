import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withRunDirectory } from '../../cua/run-directory.js';
import { runTask, runRecordedTaskAiAct } from '../../cua/task/execution.js';
import { runNaturalLanguageAiAct } from '../../cua/act/execution.js';
import { executeMidsceneYaml } from '../../executors/midscene-yaml.js';
import { executeMidsceneAiAct } from '../../executors/midscene-ai-act.js';
import { requiredModelEnv } from '../../executors/env.js';
import { dispatchRuntimeBridgeRequest, type RuntimeBridgeHandlers } from '../../runtime-bridge/dispatcher.js';
import { failedExecutionReport } from '../../runtime-bridge/failure-report.js';
import { cuaExecute } from '../../runtime-bridge/tools/execute.js';
import { createTaskFixture } from '../helpers/task-fixture.js';

test('三种执行策略失败时均从实际运行产物返回报告，错误状态和原始诊断保持不变', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-bridge-failure-'));
  await createTaskFixture(path.join(root, 'projects'));
  const previous = Object.fromEntries(requiredModelEnv.map(key => [key, process.env[key]]));
  for (const key of requiredModelEnv) process.env[key] = 'test';
  try {
    for (const strategy of ['replay', 'guided', 'freeform'] as const) {
      const original = new Error('受控执行失败');
      let calls = 0;
      let resultPath = '';
      const agentFactory = async () => {
        calls += 1;
        const reportFile = path.join(process.env.MIDSCENE_RUN_DIR!, 'report', 'execution-report.html');
        return {
          reportFile,
          runYaml: async (): Promise<never> => { throw original; },
          aiAct: async (): Promise<never> => { throw original; },
          destroy: async () => {
            await mkdir(path.dirname(reportFile), { recursive: true });
            await writeFile(reportFile, '<html>failed run</html>');
          },
        };
      };
      const yamlExecutor: typeof executeMidsceneYaml = options => {
        resultPath = options.resultPath;
        return executeMidsceneYaml({ ...options, agentFactory });
      };
      const handlers: RuntimeBridgeHandlers = {
        catalog: async () => { throw new Error('不应调用 catalog'); },
        workbench: async () => { throw new Error('不应调用 workbench'); },
        execute: request => cuaExecute(request, {
          runTask: options => runTask({ ...options, executor: yamlExecutor }),
          runRecordedTaskAiAct: options => runRecordedTaskAiAct({ ...options, executor: yamlExecutor }),
          runNaturalLanguageAiAct: options => runNaturalLanguageAiAct({ ...options, executor: execution => {
            resultPath = execution.resultPath;
            return executeMidsceneAiAct({ ...execution, agentFactory });
          } }),
        }),
      };
      const response = await dispatchRuntimeBridgeRequest({
        schemaVersion: '1.0', requestId: strategy, method: 'execute',
        payload: { strategy, scene: 'browser-demo', task: 'search-demo', goal: '测试目标', dataRoot: root },
      }, handlers);
      assert.equal(response.ok, false);
      assert.equal(calls, 1, '失败不重试或切换执行方式');
      assert.equal(response.requestId, strategy);
      if (response.ok) throw new Error('执行失败不能返回成功响应');
      const persisted = JSON.parse(await readFile(resultPath, 'utf8'));
      assert.equal(persisted.status, 'failed');
      assert.equal(response.error.code, 'RUNTIME_METHOD_FAILED');
      assert.equal(response.error.message, original.message);
      assert.equal(response.error.details?.stack, original.stack);
      assert.equal(response.error.details?.reportPath, await realpath(persisted.reportPath));
      assert.ok((await stat(String(response.error.details?.reportPath))).isFile());
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('失败报告缺失、越界、格式非法或结果非失败时不返回报告路径', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-failure-report-boundary-'));
  const outside = path.join(root, 'outside.html');
  await writeFile(outside, '<html>outside</html>');
  for (const kind of ['missing-result', 'invalid-result', 'missing-report', 'outside', 'non-html', 'succeeded', 'relative']) {
    const error = new Error('原始错误');
    let expected: string | undefined;
    await assert.rejects(withRunDirectory(path.join(root, 'runs'), async runDirectory => {
      const report = path.join(runDirectory, kind === 'non-html' ? 'report.txt' : 'report.html');
      await writeFile(report, '<html>report</html>');
      const resultPath = path.join(runDirectory, 'execution-result.json');
      if (kind !== 'missing-result') {
        let reportPath = report;
        if (kind === 'outside') reportPath = outside;
        if (kind === 'missing-report') reportPath = path.join(runDirectory, 'missing.html');
        if (kind === 'relative') { reportPath = 'report.html'; expected = await realpath(report); }
        const result = {
          schemaVersion: '0.2', status: kind === 'succeeded' ? 'succeeded' : 'failed',
          sourceYamlPath: path.join(runDirectory, 'resolved-task.yaml'), dryRun: false,
          finishedAt: new Date().toISOString(), error: error.message, reportPath,
        };
        await writeFile(resultPath, kind === 'invalid-result' ? '{' : JSON.stringify(result));
      }
      throw error;
    }), caught => caught === error);
    assert.equal(await failedExecutionReport(error, 'replay'), expected, kind);
  }
  assert.equal(await failedExecutionReport(new Error('未创建运行目录'), 'replay'), undefined);
  assert.equal(await failedExecutionReport('非 Error 异常', 'freeform'), undefined);
});
