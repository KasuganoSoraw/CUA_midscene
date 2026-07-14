import type { MidsceneFlowStep, ResolvedFlowSnapshot } from './resolved-flow-contract.js';

export const AI_ACT_PROMPT_HEADER = '请严格按以下步骤顺序完成电脑操作：';

function renderInputInstruction(prompt: string, value: string): string {
  if (prompt.includes('{{value}}')) return prompt.replaceAll('{{value}}', value);
  return `${prompt}；输入内容为：${value}`;
}

export function routeInstruction(step: MidsceneFlowStep): string {
  const route = step.route;
  switch (route.strategy) {
    case 'tap':
    case 'act':
      return route.prompt;
    case 'input':
      return renderInputInstruction(route.prompt, route.value);
    case 'keyboard':
      return `按下 \`${route.keyName}\` 键`;
    case 'wait':
      return route.prompt ?? route.condition;
    case 'manual-review':
      throw new Error(`step ${step.id} 需要人工审查，不能组合 aiAct prompt：${route.reason}`);
    default: {
      const strategy = (route as { strategy?: unknown }).strategy;
      throw new Error(`step ${step.id} 包含未知 route：${String(strategy)}`);
    }
  }
}

export function composeAiActPrompt(snapshot: ResolvedFlowSnapshot): string {
  const lines = snapshot.flow.steps.map((step) => `${step.id}: ${routeInstruction(step)}`);
  return [AI_ACT_PROMPT_HEADER, ...lines].join('\n');
}
