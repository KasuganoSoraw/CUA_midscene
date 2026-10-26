import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cuaExecute } from '../../runtime-bridge/tools/execute.js';
import { cuaCatalog } from '../../runtime-bridge/tools/catalog.js';
import { dataPaths } from '../../cua/data-paths.js';
import { runRecordedTaskAiAct, runTask } from '../../cua/task/execution.js';
import { runCliCommand } from '../../cua/cli/main.js';
import { createSkillFixture } from '../helpers/skill-fixture.js';
import { dispatchRuntimeBridgeRequest } from '../../runtime-bridge/dispatcher.js';
import { writeJsonFile } from '../../cua/contracts/validation.js';

test('Skill 执行默认 guided，显式 replay 与自由目标使用各自引擎', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skill-execute-'));
  const skillsRoot = path.join(root, 'skills');
  const data = dataPaths(path.join(root, 'data'));
  const calls: string[] = [];
  const executor = async (options: { yamlPath: string }) => {
    calls.push(path.basename(options.yamlPath));
    return { schemaVersion: '0.2' as const, status: 'succeeded' as const, sourceYamlPath: options.yamlPath,
      dryRun: true, finishedAt: new Date().toISOString() };
  };
  const dependencies = {
    resolveRuntimeLayout: async () => ({ catalog: {}, data, skillsRoot }),
    runTask: (options: Parameters<typeof runTask>[0]) => runTask({ ...options, executor }),
    runRecordedTaskAiAct: (options: Parameters<typeof runRecordedTaskAiAct>[0]) => runRecordedTaskAiAct({ ...options, executor }),
  };
  try {
    await createSkillFixture(skillsRoot);
    assert.equal((await cuaExecute({ skillName: 'alarm-query' }, dependencies)).strategy, 'guided');
    assert.equal((await cuaExecute({ skillName: 'alarm-query', strategy: 'replay' }, dependencies)).strategy, 'replay');
    assert.deepEqual(calls, ['ai-act-task.yaml', 'resolved-task.yaml']);
    const catalog = await cuaCatalog({ action: 'list-skills' }, { resolveRuntimeLayout: dependencies.resolveRuntimeLayout });
    assert.equal(catalog.action, 'list-skills');
    if (catalog.action === 'list-skills') assert.equal(catalog.skills[0].skillName, 'alarm-query');
    await mkdir(path.join(skillsRoot, 'ordinary'));
    await writeFile(path.join(skillsRoot, 'ordinary', 'SKILL.md'), 'ordinary');
    await assert.rejects(cuaExecute({ skillName: 'ordinary' }, dependencies));
    await assert.rejects(cuaExecute({ skillName: '../escape' }, dependencies), /skillName/);
    await assert.rejects(cuaExecute({ skillName: 'alarm-query', inputs: { unexpected: 'x' } }, dependencies), /未知输入/);
    assert.equal(calls.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('未配置 Skill 根拒绝绑定执行，但 freeform 不需要 Skill 根或 Catalog', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skill-freeform-'));
  const data = dataPaths(root);
  let freeformCalled = false;
  const dependencies = {
    resolveRuntimeLayout: async () => ({ catalog: {}, data }),
    runNaturalLanguageAiAct: async () => {
      freeformCalled = true;
      return { runDirectory: root, promptPath: 'prompt', resultPath: 'result', executorResult: {
        schemaVersion: '0.1' as const, status: 'succeeded' as const, sourcePromptPath: 'prompt', dryRun: true, finishedAt: new Date().toISOString(),
      } };
    },
  };
  try {
    await assert.rejects(cuaExecute({ skillName: 'alarm-query' }, dependencies), /CUA_SKILLS_ROOT/);
    assert.equal((await cuaExecute({ strategy: 'freeform', goal: '打开系统' }, dependencies)).status, 'succeeded');
    assert.equal(freeformCalled, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Skill CLI 验证和 dry-run 使用正式资产，缺省策略为 guided', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skill-cli-'));
  const previous = process.env.CUA_SKILLS_ROOT;
  try {
    process.env.CUA_SKILLS_ROOT = path.join(root, 'skills');
    await createSkillFixture(process.env.CUA_SKILLS_ROOT);
    const validation = JSON.parse(await runCliCommand(['skill', 'validate', '--skill-name', 'alarm-query']));
    assert.equal(validation.valid, true);
    const result = JSON.parse(await runCliCommand(['skill', 'run', '--skill-name', 'alarm-query', '--data-root', path.join(root, 'data'), '--dry-run']));
    assert.equal(result.strategy, 'guided');
    assert.equal(result.executor.dryRun, true);
    assert.match(await readFile(result.promptPath, 'utf8'), /查询/);
  } finally {
    if (previous === undefined) delete process.env.CUA_SKILLS_ROOT; else process.env.CUA_SKILLS_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('省略 guided 的绑定执行失败仍返回真实报告，不替换 Skill', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skill-report-'));
  const skillsRoot = path.join(root, 'skills');
  const data = dataPaths(path.join(root, 'data'));
  try {
    await createSkillFixture(skillsRoot);
    const result = await dispatchRuntimeBridgeRequest({
      schemaVersion: '1.0', requestId: 'skill-failed', method: 'execute', payload: { skillName: 'alarm-query' },
    }, {
      catalog: async () => { throw new Error('no catalog'); }, workbench: async () => { throw new Error('no workbench'); },
      execute: request => cuaExecute(request, {
        resolveRuntimeLayout: async () => ({ catalog: {}, data, skillsRoot }),
        runRecordedTaskAiAct: options => runRecordedTaskAiAct({ ...options, executor: async options => {
          const reportPath = path.join(options.runDirectory, 'execution-report.html');
          await writeFile(reportPath, '<!doctype html><html><body>Midscene report</body></html>');
          await writeJsonFile(options.resultPath, { schemaVersion: '0.2', status: 'failed', sourceYamlPath: options.yamlPath,
            dryRun: false, finishedAt: new Date().toISOString(), error: 'timeout', reportPath });
          throw new Error('timeout');
        } }),
      }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(String(result.error.details?.reportPath), /execution-report\.html$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
