import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileScript, parse } from 'vue/compiler-sfc';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import type { VNode } from 'vue';
import { translate } from '../../review/web/src/i18n.js';

const webRoot = new URL('../../review/web/src/', import.meta.url);

test('工作台统一使用系统微软雅黑，不加载字体包', async () => {
  const css = await readFile(new URL('style.css', webRoot), 'utf8');
  assert.ok(/--cua-font-family:\s*"Microsoft YaHei", "微软雅黑", sans-serif/.test(css));
  assert.ok(/font-family:\s*var\(--cua-font-family\)/.test(css));
  assert.ok(!/ui-monospace|SFMono-Regular|Consolas|@font-face/.test(css));
});

test('录制截图按比例显示，仅缺图占位使用固定底框', async () => {
  const app = await readFile(new URL('App.vue', webRoot), 'utf8');
  const css = await readFile(new URL('review.css', webRoot), 'utf8');
  const frame = css.match(/\.review-layout \.recorded-image-frame\s*\{([^}]+)\}/)?.[1] ?? '';
  const image = css.match(/\.recorded-image-frame > img\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.ok(/width:\s*fit-content/.test(frame));
  assert.ok(!/(?:^|;)\s*(?:height|background|border):/.test(frame));
  assert.ok(/height:\s*auto/.test(image));
  assert.ok(/max-height:\s*228px/.test(image));
  assert.ok(/\.recorded-image-frame\.is-placeholder\s*\{[^}]*height:\s*228px/.test(css));
  assert.ok(/:class="\{ 'is-placeholder': !evidencePath\(current\) \}"/.test(app));
});

test('动作配置标题与图片区域保留独立的垂直间距', async () => {
  const css = await readFile(new URL('review.css', webRoot), 'utf8');
  const rule = css.match(/\.review-layout \.action-config-title\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.ok(/padding-top:\s*28px/.test(rule));
  assert.ok(/margin:\s*0 0 16px/.test(rule));
});

test('等待配置以两列展示条件和最长等待时间', async () => {
  const app = await readFile(new URL('App.vue', webRoot), 'utf8');
  const css = await readFile(new URL('review.css', webRoot), 'utf8');
  assert.match(app, /class="wait-fields wide"/);
  assert.match(app, /v-model\.number="editor\.timeoutMs"[^>]*min="1"/);
  assert.match(css, /\.wait-fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.equal(translate('zh-CN', 'review.waitCondition'), '等待触发条件');
  assert.equal(translate('zh-CN', 'review.timeout'), '等待时长（毫秒）');
});

test('等待配置使用 UCD 信息图标与选择箭头', async () => {
  const app = await readFile(new URL('App.vue', webRoot), 'utf8');
  const select = await readFile(new URL('components/ReviewSelect.vue', webRoot), 'utf8');
  assert.match(app, /assets\/ucd\/action-info\.svg/);
  assert.match(app, /assets\/ucd\/wait-info\.svg/);
  assert.match(select, /assets\/ucd\/select-arrow\.svg/);
});

interface SwitchProps { modelValue: boolean; disabled?: boolean; label: string }

async function renderSwitch(props: SwitchProps, onUpdate: (value: boolean) => void): Promise<() => VNode> {
  const source = await readFile(new URL('components/ReviewSwitch.vue', webRoot), 'utf8');
  const { descriptor } = parse(source);
  const compiled = compileScript(descriptor, { id: 'review-switch-test', inlineTemplate: true });
  const { outputText } = transpileModule(compiled.content, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  });
  const exports: { default?: { setup: (props: SwitchProps, context: unknown) => (ctx: unknown, cache: unknown[]) => VNode } } = {};
  new Function('require', 'exports', outputText)(createRequire(import.meta.url), exports);
  const render = exports.default!.setup(props, {
    expose() {},
    emit(event: string, value: boolean) {
      assert.equal(event, 'update:modelValue');
      onUpdate(value);
    },
  });
  return () => render(props, []);
}

test('运行时输入区域绑定开关并保持编辑权限约束', async () => {
  const app = await readFile(new URL('App.vue', webRoot), 'utf8');
  assert.ok(/<ReviewSwitch\s+v-model="editor.parameterized"\s+:label="t\('review.parameterized'\)"\s+:disabled="busy \|\| !writable \|\| advancedEditing"/.test(app));
  assert.ok(!/<input[^>]*v-model="editor.parameterized"/.test(app));
});

test('实际开关组件支持两态、可访问名称和点击更新', async () => {
  const props = { modelValue: false, label: '允许运行时输入' };
  const updates: boolean[] = [];
  const render = await renderSwitch(props, value => { updates.push(value); props.modelValue = value; });
  const off = render();
  assert.equal(off.type, 'button');
  assert.equal(off.props?.type, 'button');
  assert.equal(off.props?.role, 'switch');
  assert.equal(off.props?.['aria-label'], props.label);
  assert.equal(off.props?.['aria-checked'], false);
  off.props!.onClick();
  const on = render();
  assert.equal(on.props?.['aria-checked'], true);
  on.props!.onClick();
  assert.deepEqual(updates, [true, false]);
  assert.equal(render().props?.['aria-checked'], false);
});

test('禁用的实际开关组件不发出更新事件', async () => {
  const updates: boolean[] = [];
  const render = await renderSwitch({ modelValue: true, disabled: true, label: 'Allow input at run time' }, value => updates.push(value));
  const button = render();
  assert.equal(button.props?.disabled, true);
  button.props!.onClick();
  assert.deepEqual(updates, []);
  assert.equal(render().props?.['aria-checked'], true);
});
