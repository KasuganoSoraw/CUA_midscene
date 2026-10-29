import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as vue from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { translate, useI18n } from '../../review/web/src/i18n.js';

async function recordingSetup() {
  const file = new URL('../../review/web/src/components/RecordingWorkspace.vue', import.meta.url);
  const source = await readFile(file, 'utf8');
  const compiled = compileScript(parse(source).descriptor, { id: 'skill-recording' });
  const output = transpileModule(compiled.content, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const calls: unknown[][] = [];
  const events: unknown[][] = [];
  const api = { createRecordingSkill: async (...args: unknown[]) => {
    calls.push(args); return { phase: 'running', recording: 'Recording_1' };
  } };
  const realRequire = createRequire(file);
  const load = (id: string) => {
    if (id === 'vue') return { ...vue, onMounted() {}, onUnmounted() {} };
    if (id === '../api') return { api };
    if (id === '../i18n') return { useI18n };
    if (id === '../recording-display') return { shouldDetectDisplays: () => false };
    if (id.endsWith('.vue') || id.endsWith('.svg')) return { default: {} };
    return realRequire(id);
  };
  const exports: { default?: { setup: (props: object, context: object) => any } } = {};
  new Function('require', 'exports', output)(load, exports);
  const scope = vue.effectScope();
  const app = scope.run(() => exports.default!.setup({ skillsConfigured: true }, { expose() {}, emit: (...args: unknown[]) => events.push(args) }))!;
  app.catalog.value = { configured: true, envName: 'CUA_RECORDINGS_ROOT', recordings: [{ id: 'Recording_1', ready: true, errors: [] }] };
  app.selectedId.value = 'Recording_1';
  return { app, calls, events, source, stop: () => scope.stop() };
}

test('实际录制页面无需命名表单发起生成，完成时导航到新 Skill', async () => {
  useI18n().setLocale('zh-CN');
  const setup = await recordingSetup();
  try {
    assert.equal(setup.app.canCreate.value, true);
    assert.doesNotMatch(setup.source, /sceneId|taskId|v-model="goal"|createRecordingTask/);
    await setup.app.createTask();
    assert.deepEqual(setup.calls, [['Recording_1', 'zh-CN']]);
    assert.equal(setup.app.generation.value.phase, 'running');
    const result = { created: true, valid: true, skillName: 'alarm-query', goal: '查询告警' };
    setup.app.applyGeneration({ phase: 'succeeded', recording: 'Recording_1', result });
    assert.deepEqual(setup.events, [['created', result]]);
    setup.app.applyGeneration({ phase: 'succeeded', recording: 'Recording_1', result }, true);
    assert.equal(setup.events.length, 1);
  } finally { setup.stop(); }
});

test('录制页面按点击生成时选中的界面语言发起请求', async () => {
  const language = useI18n();
  const setup = await recordingSetup();
  try {
    language.setLocale('en-US');
    await setup.app.createTask();
    assert.deepEqual(setup.calls, [['Recording_1', 'en-US']]);
  } finally {
    language.setLocale('zh-CN');
    setup.stop();
  }
});

test('任务目录使用 Skill 身份平铺，不读取场景目录 API', async () => {
  const source = await readFile(new URL('../../review/web/src/components/TaskCatalog.vue', import.meta.url), 'utf8');
  assert.match(source, /v-for="entry in visibleSkills"/);
  assert.match(source, /emit\('select', entry.skillName\)/);
  assert.doesNotMatch(source, /SceneCatalogItem|TaskCatalogItem|api\.tasks|scene-group/);
});

test('中英文任务提示使用 Skill 名称，不添加产品前缀', () => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    for (const key of ['recording.skillAutoSummary', 'review.emptyHelp', 'review.catalog'] as const) {
      assert.match(translate(locale, key), /Skill/);
      assert.doesNotMatch(translate(locale, key), /CUA/);
    }
  }
});
