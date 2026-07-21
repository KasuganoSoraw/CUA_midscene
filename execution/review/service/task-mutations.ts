import type { JsonObject, TaskInputDefinition } from '../../cua/contracts/types.js';
import type {
  ReviewChange,
  ReviewMutation,
  ReviewMutationResult,
  ReviewOperation,
  ReviewTaskDraft,
} from '../shared/types.js';

const stepNamePattern = /^(step-(\d{3,})) \| (click|doubleClick|input|keyboard|wait)$/;

interface Entry {
  task: JsonObject;
  operation: ReviewOperation;
  oldStepId?: string;
  oldInputId?: string;
  input?: TaskInputDefinition;
  binding: number | null;
  inserted?: boolean;
}

function assertIndex(index: number, length: number, allowEnd = false): void {
  const maximum = allowEnd ? length : length - 1;
  if (!Number.isInteger(index) || index < 0 || index > maximum) throw new Error(`步骤位置越界：${index}`);
}

function replacePlaceholder(value: unknown, replacements: Map<string, string>): unknown {
  if (typeof value === 'string') {
    let result = value;
    for (const [from, to] of replacements) result = result.replaceAll(`{{${from}}}`, `{{${to}}}`);
    return result;
  }
  if (Array.isArray(value)) return value.map((item) => replacePlaceholder(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePlaceholder(item, replacements)]));
  }
  return value;
}

function setInputPlaceholder(flow: JsonObject[], inputId: string): JsonObject[] {
  let found = false;
  const result = structuredClone(flow);
  for (const action of result) {
    const keyboard = action.KeyboardTypeText;
    if (keyboard && typeof keyboard === 'object' && !Array.isArray(keyboard)) {
      (keyboard as JsonObject).value = `{{${inputId}}}`;
      found = true;
      break;
    }
  }
  if (!found) throw new Error('参数化 input 步骤必须包含 KeyboardTypeText action');
  return result;
}

function entriesFromDraft(draft: ReviewTaskDraft): Entry[] {
  const bindings = draft.manifest.source.stepBindings ?? {};
  return (draft.document.tasks as JsonObject[]).map((task, index) => {
    const match = stepNamePattern.exec(String(task.name));
    if (!match) throw new Error(`tasks[${index + 1}].name 不符合录制步骤命名`);
    const [, oldStepId, , operation] = match;
    const oldInputId = `${oldStepId}-input`;
    return {
      task: structuredClone(task),
      operation: operation as ReviewOperation,
      oldStepId,
      ...(draft.manifest.inputs[oldInputId]
        ? { oldInputId, input: structuredClone(draft.manifest.inputs[oldInputId]) }
        : {}),
      binding: bindings[oldStepId] ?? null,
    };
  });
}

function changeFor(mutation: ReviewMutation, affected: number): ReviewChange {
  if (mutation.type === 'insert') return { kind: 'insert', summary: `在第 ${mutation.index + 1} 位插入步骤`, details: [`${affected} 个步骤已按顺序编号`] };
  if (mutation.type === 'remove') return { kind: 'remove', summary: `删除第 ${mutation.index + 1} 个步骤`, details: [`${affected} 个步骤已按顺序编号`] };
  if (mutation.type === 'move') return { kind: 'move', summary: `将第 ${mutation.from + 1} 个步骤移动到第 ${mutation.to + 1} 位`, details: [`${affected} 个步骤已按顺序编号`] };
  return { kind: 'update', summary: `修改第 ${mutation.index + 1} 个步骤`, details: ['步骤内容已更新'] };
}

export function applyReviewMutation(draft: ReviewTaskDraft, mutation: ReviewMutation): ReviewMutationResult {
  const entries = entriesFromDraft(draft);
  if (mutation.type === 'insert') {
    assertIndex(mutation.index, entries.length, true);
    entries.splice(mutation.index, 0, {
      task: { name: '', flow: structuredClone(mutation.step.flow) },
      operation: mutation.step.operation,
      ...(mutation.step.input ? { input: structuredClone(mutation.step.input) } : {}),
      binding: null,
      inserted: true,
    });
  } else if (mutation.type === 'remove') {
    assertIndex(mutation.index, entries.length);
    entries.splice(mutation.index, 1);
  } else if (mutation.type === 'move') {
    assertIndex(mutation.from, entries.length);
    assertIndex(mutation.to, entries.length);
    const [entry] = entries.splice(mutation.from, 1);
    entries.splice(mutation.to, 0, entry);
  } else {
    assertIndex(mutation.index, entries.length);
    const entry = entries[mutation.index];
    if (mutation.step.operation) {
      entry.operation = mutation.step.operation;
      if (mutation.step.operation !== 'input' && mutation.step.input === undefined) {
        delete entry.input;
        delete entry.oldInputId;
      }
    }
    if (mutation.step.flow) entry.task.flow = structuredClone(mutation.step.flow);
    if (mutation.step.input === null) {
      delete entry.input;
      delete entry.oldInputId;
    } else if (mutation.step.input) {
      entry.input = structuredClone(mutation.step.input);
    }
  }

  if (!entries.length) throw new Error('任务必须至少保留一个步骤');
  const replacements = new Map<string, string>();
  const inputs: Record<string, TaskInputDefinition> = {};
  const stepBindings: Record<string, number | null> = {};
  entries.forEach((entry, index) => {
    const stepId = `step-${String(index + 1).padStart(3, '0')}`;
    const inputId = `${stepId}-input`;
    if (entry.oldInputId && entry.input) replacements.set(entry.oldInputId, inputId);
    entry.task.name = `${stepId} | ${entry.operation}`;
    if (entry.input) {
      inputs[inputId] = structuredClone(entry.input);
      if (entry.inserted || !entry.oldInputId) entry.task.flow = setInputPlaceholder(entry.task.flow as JsonObject[], inputId);
    }
    stepBindings[stepId] = entry.binding;
  });
  const tasks = entries.map((entry) => replacePlaceholder(entry.task, replacements) as JsonObject);
  const manifest = structuredClone(draft.manifest);
  manifest.inputs = inputs;
  manifest.source = { ...manifest.source, stepBindings };
  return {
    draft: { manifest, document: { ...structuredClone(draft.document), tasks } },
    change: changeFor(mutation, entries.length),
  };
}
