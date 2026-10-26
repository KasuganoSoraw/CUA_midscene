import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as vue from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import * as stepEditor from '../../review/shared/step-editor.js';
import * as evidenceMode from '../../review/web/src/evidence-mode.js';
import * as referenceUpload from '../../review/shared/reference-upload.js';
import { ApiError } from '../../review/web/src/api.js';
import { ReviewDraftStorage } from '../../review/web/src/draft-storage.js';
import { translate, type MessageKey, type TranslationParams } from '../../review/web/src/i18n.js';
import type { ReviewMutation, ReviewSkillView } from '../../review/shared/types.js';
import { applyReviewMutation } from '../../review/service/task-mutations.js';

const appFile = new URL('../../review/web/src/App.vue', import.meta.url);
let compiledApp: string;

async function setupApp() {
  if (!compiledApp) {
    const { descriptor } = parse(await readFile(appFile, 'utf8'));
    const script = compileScript(descriptor, { id: 'app-safety' });
    compiledApp = transpileModule(script.content, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  }
  let uploadCalls = 0;
  let failMutation = true;
  const mutations: ReviewMutation[] = [];
  const api = {
    mutateSkill: async (_name: string, draft: any, mutation: ReviewMutation) => {
      mutations.push(mutation);
      if (failMutation) throw new Error('mutation failed');
      return applyReviewMutation(JSON.parse(JSON.stringify(draft)), mutation);
    },
    uploadSkillReferenceImage: async () => { uploadCalls++; throw new Error('upload should not run'); },
  };
  const require = createRequire(appFile);
  const load = (id: string) => {
    if (id === 'vue') return { ...vue, onMounted() {} };
    if (id === './api') return { ApiError, api };
    if (id.endsWith('/step-editor')) return stepEditor;
    if (id === './draft-storage') return { ReviewDraftStorage };
    if (id === './evidence-mode') return evidenceMode;
    if (id.endsWith('/reference-upload')) return referenceUpload;
    if (id === './i18n') return { useI18n: () => ({
      locale: vue.ref('zh-CN'), t: (key: MessageKey, params?: TranslationParams) => translate('zh-CN', key, params), setLocale() {},
    }) };
    if (id.endsWith('.vue') || id.endsWith('.svg')) return { default: {} };
    return require(id);
  };
  const exports: { default?: { setup: (props: object, context: object) => any } } = {};
  new Function('require', 'exports', 'window', compiledApp)(load, exports, { location: { search: '', href: 'http://127.0.0.1:47831/' }, history: { replaceState() {} } });
  const scope = vue.effectScope();
  const app = scope.run(() => exports.default!.setup({}, { expose() {} }))!;
  const manifest = {
    schemaVersion: '0.3', skillName: 'task', title: '任务', description: '', goal: '',
    source: { tracePath: 'source/trace.json', processedLogPath: 'source/processed.json', conversionCommand: '' }, inputs: {},
  };
  const view = {
    skillName: 'task', title: '任务', description: '', origin: 'user', writable: true, revision: 'revision',
    manifest, document: { tasks: [
      { name: 'step-001 | click', flow: [{ aiTap: '第一个按钮' }] },
      { name: 'step-002 | click', flow: [{ aiTap: '第二个按钮' }] },
    ] }, steps: [],
  } as unknown as ReviewSkillView;
  app.skillName.value = 'task';
  app.view.value = view;
  app.draft.value = structuredClone({ manifest, document: view.document });
  app.rebuildSteps();
  app.populateEditor();
  return { app, mutations, uploadCalls: () => uploadCalls, succeed: () => { failMutation = false; }, stop: () => scope.stop() };
}

function snapshot(app: any) {
  return structuredClone(JSON.parse(JSON.stringify({ draft: app.draft.value, steps: app.steps.value, selected: app.selected.value, changes: app.changes.value })));
}

test('冲突时禁用参考图上传和绑定，并且直接调用操作不能修改编辑状态', async () => {
  const setup = await setupApp();
  try {
    const { app } = setup;
    app.editor.referenceCandidate = { name: 'target', url: 'source/target.png' };
    app.conflict.value = true;
    assert.equal(app.referenceUploadDisabled.value, true);
    assert.equal(app.referenceBindingDisabledReason.value, translate('zh-CN', 'review.referenceConflict'));
    const before = snapshot(app);
    app.bindReferenceImage();
    await app.uploadReference({ target: { files: [{ type: 'image/png', size: 10 }], value: 'file' } });
    assert.deepEqual(snapshot(app), before);
    assert.equal(setup.uploadCalls(), 0);
    assert.deepEqual(app.editor.referenceImages, []);
    app.conflict.value = false;
    app.bindReferenceImage();
    assert.equal(app.editor.referenceImages.length, 1);
    app.conflict.value = true;
    const bound = snapshot(app);
    app.unbindReferenceImage();
    assert.equal(app.editor.referenceImages.length, 1);
    assert.deepEqual(snapshot(app), bound);
    app.conflict.value = false;
    app.unbindReferenceImage();
    assert.deepEqual(app.editor.referenceImages, []);
  } finally { setup.stop(); }
});

test('没有参考图仍允许上传，绑定限制不会误用为上传限制', async () => {
  const setup = await setupApp();
  try {
    assert.equal(setup.app.referenceUploadDisabled.value, false);
    assert.equal(setup.app.referenceBindingDisabledReason.value, translate('zh-CN', 'review.referenceMissing'));
    setup.app.editor.operation = 'input';
    assert.equal(setup.app.referenceUploadDisabled.value, true);
  } finally { setup.stop(); }
});

test('只读、忙碌、高级编辑和多图状态保留各自参考图操作限制', async () => {
  const setup = await setupApp();
  try {
    const { app } = setup;
    app.editor.referenceCandidate = { name: 'target', url: 'source/target.png' };
    app.view.value.writable = false;
    assert.equal(app.referenceUploadDisabled.value, true);
    app.bindReferenceImage();
    assert.deepEqual(app.editor.referenceImages, []);
    app.view.value.writable = true;
    for (const flag of [app.busy, app.advancedEditing]) {
      flag.value = true;
      assert.equal(app.referenceUploadDisabled.value, true);
      app.bindReferenceImage();
      assert.deepEqual(app.editor.referenceImages, []);
      flag.value = false;
    }
    app.editor.referenceImages = [{ name: 'a', url: 'source/a.png' }, { name: 'b', url: 'source/b.png' }];
    assert.equal(app.referenceUploadDisabled.value, true);
    const before = snapshot(app);
    app.unbindReferenceImage();
    assert.deepEqual(snapshot(app), before);
  } finally { setup.stop(); }
});

test('最后一步后插入失败不改变步骤、草稿或选中下标', async () => {
  const setup = await setupApp();
  try {
    setup.app.selected.value = 1;
    const before = snapshot(setup.app);
    await setup.app.insertStep();
    assert.deepEqual(snapshot(setup.app), before);
    assert.equal(setup.app.current.value.id, 'step-002');
    assert.match(setup.app.status.value(), /mutation failed/);
  } finally { setup.stop(); }
});

test('拖动和删除失败保留原选中步骤，mutation 明确返回失败', async () => {
  const setup = await setupApp();
  try {
    const before = snapshot(setup.app);
    setup.app.dragIndex.value = 0;
    await setup.app.dropStep(1);
    assert.deepEqual(snapshot(setup.app), before);
    await setup.app.removeStep(1);
    assert.deepEqual(snapshot(setup.app), before);
    assert.equal(await setup.app.mutate({ type: 'remove', index: 0 }), false);
    assert.deepEqual(snapshot(setup.app), before);
    setup.app.draft.value = undefined;
    assert.equal(await setup.app.mutate({ type: 'remove', index: 0 }), false);
  } finally { setup.stop(); }
});

test('成功的插入、拖动和删除更新到合法的目标选中步骤', async () => {
  const setup = await setupApp();
  try {
    const { app } = setup;
    setup.succeed();
    app.selected.value = 1;
    await app.insertStep();
    assert.equal(app.steps.value.length, 3);
    assert.equal(app.selected.value, 2);
    assert.equal(app.current.value.id, 'step-003');
    await app.removeStep(2);
    assert.equal(app.steps.value.length, 2);
    assert.equal(app.selected.value, 1);
    app.dragIndex.value = 1;
    await app.dropStep(0);
    assert.equal(app.selected.value, 0);
    assert.deepEqual(app.current.value.flow, [{ aiTap: '第二个按钮' }]);
    app.busy.value = true;
    const before = snapshot(app);
    assert.equal(await app.mutate({ type: 'remove', index: 0 }), false);
    assert.deepEqual(snapshot(app), before);
  } finally { setup.stop(); }
});

test('参考图冲突提示提供重新载入入口，使用已有草稿丢弃确认', async () => {
  const source = await readFile(appFile, 'utf8');
  const section = source.slice(source.indexOf('<section v-if="current" class="step-evidence">'), source.indexOf('class="action-config-title"'));
  assert.match(section, /review.referenceConflict/);
  assert.match(section, /@click="draftDiscardOpen = true"/);
  assert.ok(translate('en-US', 'review.referenceConflict').includes('reload'));
});
