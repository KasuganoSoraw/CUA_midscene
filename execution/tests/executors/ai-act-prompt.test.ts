import assert from 'node:assert/strict';
import { composeAiActPrompt } from '../../executors/ai-act-prompt.js';
import type { ResolvedFlowSnapshot } from '../../executors/resolved-flow-contract.js';

function snapshot(steps: ResolvedFlowSnapshot['flow']['steps']): ResolvedFlowSnapshot {
  return {
    flow: {
      scene: 'scene-with-secret-goal',
      task: 'task-with-secret-goal',
      goal: '不应进入 prompt 的 goal',
      steps,
    },
  };
}

const prompt = composeAiActPrompt(
  snapshot([
    {
      id: 'step-001',
      intent: '不应进入 prompt 的 intent',
      evidence: { observation: '不应进入 prompt 的 evidence' },
      timing: { waitBeforeMs: 8000, waitReason: 'recorded-step-gap' },
      route: { strategy: 'tap', prompt: '点击页面右上角的搜索按钮' },
    },
    {
      id: 'step-002',
      intent: 'input',
      evidence: {},
      route: { strategy: 'input', prompt: '在搜索框输入 {{value}}', locatePrompt: '搜索框', value: 'TOKYO' },
    },
    {
      id: 'step-003',
      intent: 'input-no-placeholder',
      evidence: {},
      route: { strategy: 'input', prompt: '在目的地输入框输入内容', locatePrompt: '目的地输入框', value: 'PARIS' },
    },
    {
      id: 'step-004',
      intent: 'keyboard',
      evidence: {},
      route: { strategy: 'keyboard', keyName: 'Enter' },
    },
    {
      id: 'step-005',
      intent: 'act',
      evidence: {},
      route: { strategy: 'act', prompt: '选择第一条搜索结果' },
    },
    {
      id: 'step-006',
      intent: 'wait',
      evidence: {},
      route: { strategy: 'wait', prompt: '等待订单列表出现', condition: '列表加载完成' },
    },
    {
      id: 'step-007',
      intent: 'wait-condition',
      evidence: {},
      route: { strategy: 'wait', condition: '详情页加载完成' },
    },
  ]),
);

assert.equal(
  prompt,
  [
    '请严格按以下步骤顺序完成电脑操作：',
    'step-001: 点击页面右上角的搜索按钮',
    'step-002: 在搜索框输入 TOKYO',
    'step-003: 在目的地输入框输入内容；输入内容为：PARIS',
    'step-004: 按下 `Enter` 键',
    'step-005: 选择第一条搜索结果',
    'step-006: 等待订单列表出现',
    'step-007: 详情页加载完成',
  ].join('\n'),
);
for (const excluded of ['goal', 'intent', 'evidence', '8000', 'scene-with-secret-goal']) {
  assert.doesNotMatch(prompt, new RegExp(excluded));
}

assert.throws(
  () =>
    composeAiActPrompt(
      snapshot([
        {
          id: 'step-008',
          intent: 'manual',
          evidence: {},
          route: { strategy: 'manual-review', reason: '需要人工确认验证码' },
        },
      ]),
    ),
  /step-008 需要人工审查/,
);

assert.throws(
  () =>
    composeAiActPrompt(
      snapshot([
        {
          id: 'step-009',
          intent: 'unknown',
          evidence: {},
          route: { strategy: 'future-route' } as never,
        },
      ]),
    ),
  /未知 route：future-route/,
);

console.log('aiAct prompt 组合测试通过');
