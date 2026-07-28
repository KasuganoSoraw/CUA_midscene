import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { JsonObject, TaskManifest } from '../../cua/contracts/types.js';
import { readTaskManifest, writeJsonFile } from '../../cua/contracts/validation.js';
import { readYamlDocument, writeYamlDocument } from '../../cua/task/yaml-task.js';
import { loadReviewTask } from '../../review/service/review-task.js';
import { applyReviewMutation } from '../../review/service/task-mutations.js';
import {
  ReviewConflictError,
  ReviewReadonlyError,
  saveReviewTask,
} from '../../review/service/task-save.js';
import { createTaskFixture } from '../helpers/task-fixture.js';

const executionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('复核视图组合 builtin 任务与录制证据', async () => {
  const view = await loadReviewTask('browser-demo', 'air-tickets-demo', {
    builtinProjectsRoot: path.join(executionRoot, 'projects'),
  });
  assert.equal(view.origin, 'builtin');
  assert.equal(view.writable, false);
  assert.equal(view.steps.length, 16);
  assert.match(view.steps[0].evidence?.full ?? '', /source\/screenshots\/0\.329s\.jpg$/);
  assert.match(view.steps[0].evidence?.reference ?? '', /source\/screenshots\/0\.329s\.reference\.png$/);
  assert.deepEqual(view.steps[11].referenceImages, [{
    name: 'step-012-target',
    url: 'source/screenshots/26.861s.reference.png',
  }]);
  assert.equal(view.manifest.source.stepBindings?.['step-016'], 16);
});

test('复核视图拒绝越出 source 的本地参考图', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-review-reference-boundary-'));
  const taskRoot = await createTaskFixture(root);
  const document = await readYamlDocument(path.join(taskRoot, 'task.yaml'));
  const click = (document.tasks as JsonObject[])[1];
  click.flow = [{
    aiTap: null,
    locate: {
      prompt: '点击候选项',
      images: [{ name: 'outside', url: 'task.yaml' }],
    },
  }];
  await writeYamlDocument(path.join(taskRoot, 'task.yaml'), document);

  await assert.rejects(
    loadReviewTask('browser-demo', 'search-demo', { builtinProjectsRoot: root }),
    /参考图路径 越出任务 source 目录/,
  );
});

test('无证据步骤不继承其他步骤截图', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-review-no-context-evidence-'));
  const taskRoot = await createTaskFixture(root);
  const manifestPath = path.join(taskRoot, 'task.json');
  const manifest = await readTaskManifest(manifestPath);
  manifest.source.stepBindings = { 'step-001': 1, 'step-002': null };
  await writeJsonFile(manifestPath, manifest);

  const sourceRoot = path.join(taskRoot, 'source');
  const screenshotsRoot = path.join(sourceRoot, 'screenshots');
  await mkdir(screenshotsRoot, { recursive: true });
  await writeJsonFile(path.join(sourceRoot, 'showui-trace.json'), {
    trajectory: [{
      step_idx: 1,
      caption: { operation: { type: 'input', locatePrompt: '搜索框', value: '关键词' } },
    }],
  });
  await writeJsonFile(path.join(sourceRoot, 'processed-log-sc.json'), [{
    timestamp: 1,
    screenshot_full: 'screenshots/full.png',
    screenshot_crop: 'screenshots/crop.png',
  }]);
  await Promise.all([
    writeFile(path.join(screenshotsRoot, 'full.png'), 'full'),
    writeFile(path.join(screenshotsRoot, 'crop.png'), 'crop'),
  ]);

  const view = await loadReviewTask('browser-demo', 'search-demo', { builtinProjectsRoot: root });
  assert.match(view.steps[0].evidence?.crop ?? '', /source\/screenshots\/crop\.png$/);
  assert.equal(view.steps[1].evidence, undefined);
  assert.equal(Object.hasOwn(view.steps[1], 'contextEvidence'), false);
});

test('插入步骤统一重编号并迁移输入与证据绑定', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-review-mutation-'));
  const taskRoot = await createTaskFixture(root);
  const manifest = await readTaskManifest(path.join(taskRoot, 'task.json'));
  manifest.source.stepBindings = { 'step-001': 1, 'step-002': 2 };
  const document = await readYamlDocument(path.join(taskRoot, 'task.yaml'));
  const result = applyReviewMutation({ manifest, document }, {
    type: 'insert',
    index: 0,
    step: { operation: 'click', flow: [{ aiTap: '点击新入口' }] },
  });
  const tasks = result.draft.document.tasks as JsonObject[];
  assert.deepEqual(tasks.map((item) => item.name), ['step-001 | click', 'step-002 | input', 'step-003 | click']);
  assert.equal(((tasks[1].flow as JsonObject[])[0].KeyboardTypeText as JsonObject).value, '{{step-002-input}}');
  assert.match(String(((tasks[2].flow as JsonObject[])[0].aiTap)), /\{\{step-002-input\}\}/);
  assert.deepEqual(Object.keys(result.draft.manifest.inputs), ['step-002-input']);
  assert.deepEqual(result.draft.manifest.source.stepBindings, {
    'step-001': null,
    'step-002': 1,
    'step-003': 2,
  });
});

test('保存用户任务校验 revision，builtin 任务保持只读', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-review-save-'));
  const user = path.join(root, 'projects');
  await createTaskFixture(user);
  const catalog = { builtinProjectsRoot: path.join(executionRoot, 'projects'), userProjectsRoot: user };
  const view = await loadReviewTask('browser-demo', 'search-demo', catalog);
  const document = structuredClone(view.document);
  ((document.tasks as JsonObject[])[1].flow as JsonObject[])[0].aiTap = '点击更新后的候选项';
  const result = await saveReviewTask('browser-demo', 'search-demo', catalog, {
    expectedRevision: view.revision,
    manifest: view.manifest,
    document,
  });
  assert.deepEqual(result.changed, ['task.yaml']);
  await assert.rejects(
    saveReviewTask('browser-demo', 'search-demo', catalog, {
      expectedRevision: view.revision,
      manifest: view.manifest,
      document,
    }),
    ReviewConflictError,
  );
  const builtin = await loadReviewTask('browser-demo', 'air-tickets-demo', catalog);
  await assert.rejects(
    saveReviewTask('browser-demo', 'air-tickets-demo', catalog, {
      expectedRevision: builtin.revision,
      manifest: builtin.manifest,
      document: builtin.document,
    }),
    ReviewReadonlyError,
  );
});

test('联合保存第二个文件失败时回滚已替换的 YAML', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-review-rollback-'));
  const user = path.join(root, 'projects');
  const taskRoot = await createTaskFixture(user);
  const catalog = { builtinProjectsRoot: path.join(executionRoot, 'projects'), userProjectsRoot: user };
  const view = await loadReviewTask('browser-demo', 'search-demo', catalog);
  const originalYaml = await readFile(path.join(taskRoot, 'task.yaml'), 'utf8');
  const document = structuredClone(view.document);
  ((document.tasks as JsonObject[])[1].flow as JsonObject[])[0].aiTap = '触发双文件保存';
  const manifest: TaskManifest = structuredClone(view.manifest);
  manifest.title = '更新标题';
  let calls = 0;
  await assert.rejects(
    saveReviewTask('browser-demo', 'search-demo', catalog, {
      expectedRevision: view.revision,
      manifest,
      document,
    }, {
      replace: async (target, content) => {
        calls += 1;
        if (calls === 2) throw new Error('模拟 task.json 替换失败');
        await writeFile(target, content, 'utf8');
      },
    }),
    /模拟 task\.json 替换失败/,
  );
  assert.equal(await readFile(path.join(taskRoot, 'task.yaml'), 'utf8'), originalYaml);
  assert.equal(calls, 3);
});
