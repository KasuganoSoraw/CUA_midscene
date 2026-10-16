import type { TaskInputDefinition } from '../../../cua/contracts/types.js';
import type { ReviewTaskView, TaskExecutionMode } from '../../shared/types.js';
import { parseStepEditor } from '../../shared/step-editor.js';

export function executionInstruction(task: string, mode: TaskExecutionMode): string {
  if (!task) return '';
  return `[电脑操控](plugin://computer-use@buildin_extension) 运行录制任务 ${task} ${mode === 'act' ? '自适应运行' : '按步骤运行'}`;
}

export interface ExecutionParameter {
  id: string;
  definition: TaskInputDefinition;
  stepNumber?: number;
  target?: string;
}

export function executionParameters(view: ReviewTaskView): ExecutionParameter[] {
  return Object.entries(view.manifest.inputs).map(([id, definition]) => {
    const index = view.steps.findIndex(step => `${step.id}-input` === id && step.operation === 'input');
    if (index < 0) return { id, definition };
    const editor = parseStepEditor(view.steps[index]);
    return { id, definition, stepNumber: index + 1, ...(!editor.custom && editor.target ? { target: editor.target } : {}) };
  });
}
