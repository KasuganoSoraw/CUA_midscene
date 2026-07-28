import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStepContent,
  inputPreview,
  parseInputPreview,
  parseStepEditor,
} from '../../review/shared/step-editor.js';

test('input 语义表单与 Flow/参数定义双向转换', () => {
  const parsed = parseStepEditor({
    id: 'step-010',
    operation: 'input',
    flow: [
      { sleep: 6425 },
      { KeyboardTypeText: { locate: '目的地输入框', value: '{{step-010-input}}', mode: 'replace' } },
    ],
    input: { type: 'string', label: '目的地', description: '机场或城市', default: 'LOS' },
  });
  assert.equal(parsed.custom, false);
  assert.equal(parsed.delayMs, 6425);
  assert.equal(parsed.target, '目的地输入框');
  assert.equal(parsed.inputDefault, 'LOS');

  parsed.inputLabel = '到达城市';
  parsed.inputDefault = 'LAX';
  const built = buildStepContent(parsed, 'step-010');
  assert.deepEqual(built.flow, [
    { sleep: 6425 },
    { KeyboardTypeText: { locate: '目的地输入框', value: '{{step-010-input}}', mode: 'replace' } },
  ]);
  assert.deepEqual(inputPreview('step-010', built.input), {
    'step-010-input': { type: 'string', label: '到达城市', description: '机场或城市', default: 'LAX' },
  });
});

test('关闭运行时参数后 Flow 使用固定输入值', () => {
  const parsed = parseStepEditor({
    id: 'step-002',
    operation: 'input',
    flow: [{ KeyboardTypeText: { locate: '搜索框', value: '{{step-002-input}}', mode: 'replace' } }],
    input: { type: 'string', label: '关键词', default: 'QATAR' },
  });
  parsed.parameterized = false;
  parsed.inputValue = 'QATAR AIRWAYS';
  const built = buildStepContent(parsed, 'step-002');
  assert.deepEqual(built.flow, [
    { KeyboardTypeText: { locate: '搜索框', value: 'QATAR AIRWAYS', mode: 'replace' } },
  ]);
  assert.equal(built.input, null);
});

test('高级参数 JSON 只接受当前步骤的单个 string 定义', () => {
  assert.deepEqual(parseInputPreview({
    'step-003-input': { type: 'string', label: '关键词', default: 'demo' },
  }, 'step-003'), { type: 'string', label: '关键词', default: 'demo' });
  assert.throws(() => parseInputPreview({ other: { type: 'string', label: 'x', default: '' } }, 'step-003'));
});

test('无法识别的 Flow 保留为自定义结构', () => {
  const flow = [{ sleep: 300 }, { aiTap: '按钮' }, { aiWaitFor: '完成' }];
  const parsed = parseStepEditor({ id: 'step-001', operation: 'click', flow });
  assert.equal(parsed.custom, true);
  assert.deepEqual(buildStepContent(parsed, 'step-001').flow, flow);
});

test('带参考图的点击类 Flow 通过普通表单无损往返', () => {
  const parsed = parseStepEditor({
    id: 'step-012',
    operation: 'click',
    flow: [
      { sleep: 1000 },
      {
        aiTap: null,
        locate: {
          prompt: '点击无文字图标',
          images: [{ name: 'step-012-target', url: 'source/screenshots/target.reference.png' }],
          convertHttpImage2Base64: true,
        },
      },
    ],
  });
  assert.equal(parsed.custom, false);
  assert.equal(parsed.target, '点击无文字图标');
  assert.deepEqual(parsed.referenceImages, [{
    name: 'step-012-target',
    url: 'source/screenshots/target.reference.png',
  }]);

  parsed.target = '点击工具栏中的无文字图标';
  assert.deepEqual(buildStepContent(parsed, 'step-012').flow, [
    { sleep: 1000 },
    {
      aiTap: null,
      locate: {
        prompt: '点击工具栏中的无文字图标',
        images: [{ name: 'step-012-target', url: 'source/screenshots/target.reference.png' }],
        convertHttpImage2Base64: true,
      },
    },
  ]);

  const doubleClick = parseStepEditor({
    id: 'step-003',
    operation: 'doubleClick',
    flow: [{
      aiDoubleClick: null,
      locate: {
        prompt: '双击图标',
        images: [{ name: 'step-003-target', url: 'https://example.com/target.png' }],
      },
    }],
  });
  assert.equal(doubleClick.custom, false);
  assert.equal(doubleClick.referenceImages[0].name, 'step-003-target');
});
