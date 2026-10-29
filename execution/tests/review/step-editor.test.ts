import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceStepsForBinding } from '../../review/shared/step-bindings.js';
import {
  buildStepContent,
  defaultStepEditor,
  inputPreview,
  parseInputPreview,
  parseStepEditor,
  referenceImagesFromFlow,
} from '../../review/shared/step-editor.js';

test('步骤证据绑定支持缺省、单步和多步来源', () => {
  assert.deepEqual(sourceStepsForBinding(undefined), []);
  assert.deepEqual(sourceStepsForBinding(null), []);
  assert.deepEqual(sourceStepsForBinding(3), [3]);
  assert.deepEqual(sourceStepsForBinding([2, 3]), [2, 3]);
});

test('默认编辑提示区分输入、复合操作和其他动作', () => {
  assert.equal(defaultStepEditor('input').target, '描述输入框位置');
  assert.equal(defaultStepEditor('aiAct').target, '描述要完成的电脑操作');
  assert.equal(defaultStepEditor('click').target, '描述要点击的目标');
});

test('自然语言动作可在复核表单中往返编辑并保留参考图', () => {
  const flow = [{ sleep: 500 }, { ai: {
    prompt: '在列表中找到 NE-001 并单击',
    images: [{ name: 'target', url: 'source/screenshots/target.png' }],
  } }];
  const editor = parseStepEditor({ id: 'step-001', operation: 'aiAct', flow });
  assert.equal(editor.custom, false);
  assert.equal(editor.target, '在列表中找到 NE-001 并单击');
  assert.deepEqual(referenceImagesFromFlow(flow, 'aiAct'), editor.referenceImages);
  editor.target = '在列表中找到 NE-002 并单击';
  assert.deepEqual(buildStepContent(editor, 'step-001').flow, [{ sleep: 500 }, { ai: {
    prompt: '在列表中找到 NE-002 并单击', images: [{ name: 'target', url: 'source/screenshots/target.png' }],
  } }]);
  const drag = parseStepEditor({ id: 'step-002', operation: 'aiAct', flow: [{ ai: '按住对象拖动到目标区域并释放' }] });
  assert.equal(drag.custom, false);
  assert.deepEqual(buildStepContent(drag, 'step-002').flow, [{ ai: '按住对象拖动到目标区域并释放' }]);
});

test('动作构建保留双击、按键、等待边界和自定义参数语义', () => {
  const doubleClick = defaultStepEditor('doubleClick', 10.6);
  doubleClick.target = '双击 target';
  doubleClick.referenceImages = [{ name: 'target', url: 'source/target.png' }];
  const clicked = buildStepContent(doubleClick, 'step-001');
  assert.deepEqual(clicked, { flow: [{ sleep: 11 }, { aiDoubleClick: null, locate: { prompt: '双击 target', images: doubleClick.referenceImages } }], input: null });
  (clicked.flow[1].locate as any).images[0].name = 'changed';
  assert.equal(doubleClick.referenceImages[0].name, 'target');

  const keyboard = defaultStepEditor('keyboard', -20);
  keyboard.keyName = 'Control+A';
  assert.deepEqual(buildStepContent(keyboard, 'step-001'), { flow: [{ KeyboardPress: { keyName: 'Control+A' } }], input: null });
  const wait = defaultStepEditor('wait');
  wait.waitCondition = '结果出现';
  for (const [timeoutMs, expected] of [[0, 15000], [-10, 1], [3500.7, 3501]]) {
    wait.timeoutMs = timeoutMs;
    assert.deepEqual(buildStepContent(wait, 'step-001').flow, [{ aiWaitFor: '结果出现', timeout: expected }]);
  }

  const custom = defaultStepEditor('input', 999);
  custom.custom = true;
  custom.customFlow = [{ sleep: 20 }, { aiTap: '保留动作' }];
  custom.inputLabel = '   ';
  custom.inputDescription = '  参数说明  ';
  custom.inputDefault = 'demo';
  const built = buildStepContent(custom, 'step-002');
  assert.deepEqual(built, { flow: custom.customFlow, input: { type: 'string', label: '输入值', description: '参数说明', default: 'demo' } });
  built.flow[1].aiTap = 'changed';
  assert.equal(custom.customFlow[1].aiTap, '保留动作');
  custom.parameterized = false;
  assert.equal(buildStepContent(custom, 'step-002').input, null);
  custom.parameterized = true;
  custom.inputDescription = '  ';
  assert.deepEqual(buildStepContent(custom, 'step-002').input, { type: 'string', label: '输入值', default: 'demo' });
});

test('等待触发条件与最长等待时间分别保留，动作前暂停独立存在', () => {
  const editor = parseStepEditor({ id: 'step-005', operation: 'wait', flow: [
    { sleep: 4010 }, { aiWaitFor: '加载完成', timeout: 12000 },
  ] });
  assert.equal(editor.custom, false);
  assert.equal(editor.delayMs, 4010);
  assert.equal(editor.timeoutMs, 12000);
  editor.waitCondition = '列表出现';
  editor.timeoutMs = 9000;
  assert.deepEqual(buildStepContent(editor, 'step-005').flow, [
    { sleep: 4010 }, { aiWaitFor: '列表出现', timeout: 9000 },
  ]);
});

test('上传图的名称进入定位 prompt，语义编辑保留目标描述并支持停用', () => {
  const editor = parseStepEditor({ id: 'step-001', operation: 'click', flow: [{ aiTap: '点击保存按钮' }] });
  editor.referenceImages = [{ name: 'reference-image', url: 'source/reference-images/example.png' }];
  const content = buildStepContent(editor, 'step-001');
  assert.equal((content.flow[0].locate as any).prompt, '点击保存按钮\n参考定位图：reference-image');
  const reopened = parseStepEditor({ id: 'step-001', operation: 'click', flow: content.flow });
  assert.equal(reopened.target, '点击保存按钮');
  reopened.referenceCandidate = reopened.referenceImages[0];
  reopened.referenceImages = [];
  assert.deepEqual(buildStepContent(reopened, 'step-001').flow, [{ aiTap: '点击保存按钮' }]);
});

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

test('右键点击和粘贴输入在复核表单中无损往返', () => {
  const right = parseStepEditor({
    id: 'step-001', operation: 'rightClick', flow: [{ aiRightClick: '文件行' }],
  });
  assert.equal(right.custom, false);
  assert.deepEqual(buildStepContent(right, 'step-001').flow, [{ aiRightClick: '文件行' }]);

  const paste = parseStepEditor({
    id: 'step-002', operation: 'input',
    flow: [
      { KeyboardPress: { keyName: 'End', locate: { prompt: '搜索框' } } },
      { aiInput: null, value: '{{step-002-input}}', mode: 'typeOnly' },
    ],
    input: { type: 'string', label: '搜索框', default: '中文 text' },
  });
  assert.equal(paste.custom, false);
  assert.equal(paste.inputMode, 'append');
  assert.equal(paste.inputDefault, '中文 text');
  assert.deepEqual(buildStepContent(paste, 'step-002').flow, [
    { KeyboardPress: { keyName: 'End', locate: { prompt: '搜索框' } } },
    { aiInput: null, value: '{{step-002-input}}', mode: 'typeOnly' },
  ]);
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

test('运行时输入开关往返切换保留标签、默认值和说明', () => {
  const editor = parseStepEditor({
    id: 'step-002', operation: 'input',
    flow: [{ KeyboardTypeText: { locate: '搜索框', value: '{{step-002-input}}', mode: 'append' } }],
    input: { type: 'string', label: '关键词', default: 'demo', description: '搜索内容' },
  });
  const parameterized = buildStepContent(editor, 'step-002');
  editor.parameterized = false;
  editor.inputValue = 'fixed';
  assert.equal(buildStepContent(editor, 'step-002').input, null);
  editor.parameterized = true;
  assert.deepEqual(buildStepContent(editor, 'step-002'), parameterized);
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
        prompt: '点击工具栏中的无文字图标\n参考定位图：step-012-target',
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

test('点击步骤绑定和解绑单张定位参考图时保留语义字段', () => {
  const parsed = parseStepEditor({
    id: 'step-006',
    operation: 'click',
    flow: [{ sleep: 850 }, { aiTap: '点击右上角的个人头像' }],
  });

  parsed.referenceImages = [{
    name: 'step-006-reference',
    url: 'source/screenshots/step-006.reference.png',
  }];
  const bound = buildStepContent(parsed, 'step-006');
  assert.deepEqual(bound.flow, [
    { sleep: 850 },
    {
      aiTap: null,
      locate: {
        prompt: '点击右上角的个人头像\n参考定位图：step-006-reference',
        images: [{
          name: 'step-006-reference',
          url: 'source/screenshots/step-006.reference.png',
        }],
      },
    },
  ]);

  const rebound = parseStepEditor({
    id: 'step-006',
    operation: 'click',
    flow: bound.flow,
  });
  rebound.referenceImages = [];
  assert.deepEqual(buildStepContent(rebound, 'step-006').flow, [
    { sleep: 850 },
    { aiTap: '点击右上角的个人头像' },
  ]);
});

test('多张定位参考图在普通字段更新时保持顺序和内容', () => {
  const flow = [{
    aiTap: null,
    locate: {
      prompt: '点击工具栏图标',
      images: [
        { name: 'dark-theme', url: 'source/screenshots/dark.png' },
        { name: 'light-theme', url: 'source/screenshots/light.png' },
      ],
      convertHttpImage2Base64: true,
    },
  }];
  const parsed = parseStepEditor({
    id: 'step-009',
    operation: 'click',
    flow,
  });
  parsed.target = '点击工具栏中的目标图标';

  const built = buildStepContent(parsed, 'step-009');
  assert.deepEqual((built.flow[0].locate as Record<string, unknown>).images, [
    { name: 'dark-theme', url: 'source/screenshots/dark.png' },
    { name: 'light-theme', url: 'source/screenshots/light.png' },
  ]);
  assert.equal(
    (built.flow[0].locate as Record<string, unknown>).convertHttpImage2Base64,
    true,
  );
});
