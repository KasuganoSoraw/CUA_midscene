import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cuaCatalog,
  cuaExecute,
  cuaWorkbench,
  type CuaCatalogDependencies,
  type CuaExecuteDependencies,
  type CuaWorkbenchDependencies,
} from '../../runtime-bridge/index.js';
import type {
  NativeAiActExecutorResult,
  TaskCatalogItem,
} from '../../cua/contracts/types.js';

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

test('Runtime catalog 保留 ready/error 任务', async () => {
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

test('Runtime execute 将三种策略映射到唯一底层 API', async () => {
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

test('Runtime execute 保留底层错误且不调用其他策略', async () => {
  const calls: string[] = [];
  const dependencies = {
    resolveRuntimeLayout: async () => layout,
    requireDataPaths: async () => data,
    runTask: async () => {
      calls.push('replay');
      throw new Error('runner failed');
    },
    runRecordedTaskAiAct: async () => {
      calls.push('guided');
      throw new Error('不应调用');
    },
    runNaturalLanguageAiAct: async () => {
      calls.push('freeform');
      throw new Error('不应调用');
    },
  } as unknown as Partial<CuaExecuteDependencies>;

  await assert.rejects(
    cuaExecute({ strategy: 'replay', scene: 'ems', task: 'query-alarm' }, dependencies),
    /runner failed/,
  );
  assert.deepEqual(calls, ['replay']);
});

test('Runtime workbench 返回深链接且不打开系统浏览器', async () => {
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
  assert.equal(starts, 1);
});
