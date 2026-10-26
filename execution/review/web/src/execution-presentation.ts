import type { TaskInputDefinition } from '../../../cua/contracts/types.js';
import type { ReviewTaskView, ReviewSkillView, TaskExecutionMode } from '../../shared/types.js';
import { parseStepEditor } from '../../shared/step-editor.js';

export function executionInstruction(task: string, mode: TaskExecutionMode): string {
  if (!task) return '';
  return `[电脑操控](plugin://computer-use@buildin_extension) 执行 Skill ${task}（skillName=${task}，strategy=${mode === 'act' ? 'guided' : 'replay'}）`;
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
