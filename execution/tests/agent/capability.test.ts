import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  cuaAgentDefinition,
  cuaCatalog,
  cuaExecute,
  cuaWorkbench,
  invokeCuaSubagent,
  type CuaCatalogDependencies,
  type CuaExecuteDependencies,
  type CuaWorkbenchDependencies,
} from '../../agent/index.js';
import type {
  NativeAiActExecutorResult,
  TaskCatalogItem,
} from '../../cua/contracts/types.js';

const executionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const data = {
  root: 'C:\\cua-data',
  projectsRoot: 'C:\\cua-data\\projects',
  runsRoot: 'C:\\cua-data\\runs',
  cacheRoot: 'C:\\cua-data\\cache',
};
const layout = {
  catalog: { builtinProjectsRoot: 'C:\\builtin', userProjectsRoot: data.projectsRoot },
  data,
};

test('canonical Agent definition 从发布 Markdown 资产加载并固定 Tool 集合', async () => {
  assert.equal(cuaAgentDefinition.name, 'Computer-Use');
  assert.equal(cuaAgentDefinition.invocationMode, 'stateless-task');
  assert.deepEqual(cuaAgentDefinition.tools, ['cua_catalog', 'cua_execute', 'cua_workbench']);
  assert.match(cuaAgentDefinition.description, /Windows|Computer Use/);
  assert.match(cuaAgentDefinition.instructions, /replay/);
  assert.match(cuaAgentDefinition.instructions, /freeform/);
  assert.match(cuaAgentDefinition.instructions, /不自动重试/);
  assert.match(cuaAgentDefinition.instructions, /不请求、读取、保存或恢复/);
  assert.match(cuaAgentDefinition.instructions, /Midscene 独立管理/);

  const packageJson = JSON.parse(await readFile(path.join(executionRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.exports['./agent'], './dist/agent/index.js');
  assert.ok(packageJson.files.includes('agent'));
});

test('cua_catalog 复用 catalog API 并保留 ready/error 任务', async () => {
  const tasks = [
    { status: 'ready', scene: 'ems', task: 'query-alarm', title: '查询告警' },
    { status: 'error', scene: 'ems', task: 'broken', title: 'broken', error: 'YAML 错误' },
  ] as TaskCatalogItem[];
  const dependencies = {
    resolveRuntimeLayout: async () => layout,
    listTasks: async (scene: string) => {
      assert.equal(scene, 'ems');
      return tasks;
    },
  } as unknown as Partial<CuaCatalogDependencies>;

  const result = await cuaCatalog({ action: 'list-tasks', scene: 'ems' }, dependencies);
  assert.equal(result.action, 'list-tasks');
  assert.deepEqual(result.tasks, tasks);
});

test('cua_execute 将三种显式策略映射到唯一底层 API', async () => {
  const calls: string[] = [];
  const yamlExecutor = {
    schemaVersion: '0.2',
    status: 'succeeded',
    sourceYamlPath: 'C:\\cua-data\\runs\\1\\resolved-task.yaml',
    dryRun: true,
    finishedAt: '2026-08-27T00:00:00.000Z',
  } as const;
  const nativeExecutor: NativeAiActExecutorResult = {
    schemaVersion: '0.1',
    status: 'succeeded',
    sourcePromptPath: 'C:\\cua-data\\runs\\3\\ai-act-prompt.txt',
    dryRun: true,
    finishedAt: '2026-08-27T00:00:00.000Z',
  };
  const dependencies = {
    resolveRuntimeLayout: async () => layout,
    requireDataPaths: async () => data,
    runTask: async (options: { scene: string; task: string; inputs?: Record<string, string> }) => {
      calls.push('replay');
      assert.equal(options.scene, 'ems');
      assert.equal(options.task, 'query-alarm');
      assert.deepEqual(options.inputs, { ne: 'NE001' });
      return {
        resolved: {},
        resolvedTaskPath: 'C:\\cua-data\\runs\\1\\resolved-task.yaml',
        executorResult: yamlExecutor,
      };
    },
    runRecordedTaskAiAct: async () => {
      calls.push('guided');
      return {
        resolved: {},
        resolvedTaskPath: 'C:\\cua-data\\runs\\2\\resolved-task.yaml',
        promptPath: 'C:\\cua-data\\runs\\2\\ai-act-prompt.txt',
        aiActYamlPath: 'C:\\cua-data\\runs\\2\\ai-act-task.yaml',
        executorResult: yamlExecutor,
      };
    },
    runNaturalLanguageAiAct: async (options: { prompt: string }) => {
      calls.push('freeform');
      assert.equal(options.prompt, '打开 Chrome');
      return {
        runDirectory: 'C:\\cua-data\\runs\\3',
        promptPath: 'C:\\cua-data\\runs\\3\\ai-act-prompt.txt',
        resultPath: 'C:\\cua-data\\runs\\3\\ai-act-result.json',
        executorResult: nativeExecutor,
      };
    },
  } as unknown as Partial<CuaExecuteDependencies>;

  const replay = await cuaExecute({
    strategy: 'replay', scene: 'ems', task: 'query-alarm', inputs: { ne: 'NE001' }, dryRun: true,
  }, dependencies);
  const guided = await cuaExecute({
    strategy: 'guided', scene: 'ems', task: 'query-alarm', dryRun: true,
  }, dependencies);
  const freeform = await cuaExecute({
    strategy: 'freeform', goal: '打开 Chrome', dryRun: true,
  }, dependencies);

  assert.deepEqual(calls, ['replay', 'guided', 'freeform']);
  assert.equal(replay.strategy, 'replay');
  assert.equal(guided.promptPath, 'C:\\cua-data\\runs\\2\\ai-act-prompt.txt');
  assert.equal(freeform.runDir, 'C:\\cua-data\\runs\\3');
});

test('cua_execute 保留底层错误且不调用其他策略', async () => {
  const calls: string[] = [];
  const dependencies = {
    resolveRuntimeLayout: async () => layout,
    requireDataPaths: async () => data,
    runTask: async () => {
      calls.push('replay');
      throw new Error('runner failed');
    },
    runRecordedTaskAiAct: async () => { calls.push('guided'); throw new Error('不应调用'); },
    runNaturalLanguageAiAct: async () => { calls.push('freeform'); throw new Error('不应调用'); },
  } as unknown as Partial<CuaExecuteDependencies>;

  await assert.rejects(
    cuaExecute({ strategy: 'replay', scene: 'ems', task: 'query-alarm' }, dependencies),
    /runner failed/,
  );
  assert.deepEqual(calls, ['replay']);
});

test('cua_workbench 返回 Host 可展示的深链接且不打开系统浏览器', async () => {
  let starts = 0;
  const dependencies = {
    startReviewServer: async () => {
      starts += 1;
      return {
        url: 'http://127.0.0.1:47831/',
        reused: true,
        close: async () => undefined,
      };
    },
  } as unknown as Partial<CuaWorkbenchDependencies>;

  const result = await cuaWorkbench({
    mode: 'review', scene: 'ems', task: 'query-alarm', dataRoot: 'C:\\cua-data',
  }, dependencies);
  const url = new URL(result.url);
  assert.equal(starts, 1);
  assert.equal(result.reused, true);
  assert.equal(url.searchParams.get('mode'), 'review');
  assert.equal(url.searchParams.get('scene'), 'ems');
  assert.equal(url.searchParams.get('task'), 'query-alarm');

  await assert.rejects(
    cuaWorkbench({ mode: 'execution', task: 'query-alarm' }, dependencies),
    /同时提供 scene/,
  );
  await assert.rejects(
    cuaWorkbench({ mode: 'invalid' } as never, dependencies),
    /无法识别 cua_workbench mode/,
  );
  assert.equal(starts, 1);
});

test('统一 Subagent invocation 向不同 Host 提供相同 definition 与 Tool 集合', async () => {
  let calls = 0;
  const result = await invokeCuaSubagent(
    { task: '  查询 NE001 当前告警  ' },
    {
      invoke: async (invocation) => {
        calls += 1;
        assert.equal(invocation.invocationId, 'invoke-001');
        assert.equal(invocation.task, '查询 NE001 当前告警');
        assert.equal(invocation.definition, cuaAgentDefinition);
        assert.deepEqual(Object.keys(invocation.tools), ['cua_catalog', 'cua_execute', 'cua_workbench']);
        return {
          status: 'completed',
          reply: '查询完成。',
          toolCalls: [{
            callId: 'call-001',
            tool: 'cua_catalog',
            input: { action: 'list-scenes' },
            status: 'succeeded',
            output: { scenes: [] },
          }],
        };
      },
    },
    { dataRoot: 'C:\\cua-data', createInvocationId: () => 'invoke-001' },
  );

  assert.equal(calls, 1);
  assert.equal(result.schemaVersion, '0.1');
  assert.equal(result.invocationId, 'invoke-001');
  assert.equal(result.reply, '查询完成。');
  assert.equal(result.toolCalls[0]?.tool, 'cua_catalog');

  await assert.rejects(
    invokeCuaSubagent({ task: '   ' }, { invoke: async () => { throw new Error('不应调用'); } }),
    /非空字符串/,
  );
});
