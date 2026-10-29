import type { TaskInputDefinition } from '../../../cua/contracts/types.js';
import type { ReviewTaskView, ReviewSkillView, TaskExecutionMode } from '../../shared/types.js';
import { parseStepEditor } from '../../shared/step-editor.js';

export function executionInstruction(skillName: string, mode: TaskExecutionMode): string {
  if (!skillName) return '';
  const reference = `[${skillName}](skill://${skillName})`;
  if (mode === 'task') return `${reference} 请使用严格回放模式执行该任务`;
  return `${reference} 请执行该任务`;
}

export interface ExecutionParameter {
  id: string;
  definition: TaskInputDefinition;
  stepNumber?: number;
  target?: string;
}

export function executionParameters(view: ReviewTaskView | ReviewSkillView): ExecutionParameter[] {
  return Object.entries(view.manifest.inputs).map(([id, definition]) => {
    const index = view.steps.findIndex(step => `${step.id}-input` === id && step.operation === 'input');
    if (index < 0) return { id, definition };
    const editor = parseStepEditor(view.steps[index]);
    return { id, definition, stepNumber: index + 1, ...(!editor.custom && editor.target ? { target: editor.target } : {}) };
  });
}
