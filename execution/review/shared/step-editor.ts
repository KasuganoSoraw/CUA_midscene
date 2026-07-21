import type { JsonObject, TaskInputDefinition } from '../../cua/contracts/types.js';
import type { ReviewOperation, ReviewStep } from './types.js';

export type InputMode = 'replace' | 'append';

export interface StepEditorModel {
  operation: ReviewOperation;
  delayMs: number;
  target: string;
  inputValue: string;
  inputMode: InputMode;
  parameterized: boolean;
  inputLabel: string;
  inputDescription: string;
  inputDefault: string;
  keyName: string;
  waitCondition: string;
  timeoutMs: number;
  custom: boolean;
  customFlow: JsonObject[];
}

export interface BuiltStepContent {
  flow: JsonObject[];
  input?: TaskInputDefinition | null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function splitFlow(flow: JsonObject[]): { delayMs: number; action?: JsonObject; standard: boolean } {
  const copied = clone(flow);
  let delayMs = 0;
  if (copied.length && typeof copied[0].sleep === 'number') {
    delayMs = Math.max(0, Math.round(copied.shift()!.sleep as number));
  }
  return { delayMs, action: copied[0], standard: copied.length === 1 };
}

export function defaultStepEditor(operation: ReviewOperation, delayMs = 0): StepEditorModel {
  return {
    operation,
    delayMs,
    target: operation === 'input' ? '描述输入框位置' : '描述要点击的目标',
    inputValue: '',
    inputMode: 'replace',
    parameterized: operation === 'input',
    inputLabel: '输入值',
    inputDescription: '',
    inputDefault: '',
    keyName: 'Enter',
    waitCondition: '描述需要等待出现的状态',
    timeoutMs: 15_000,
    custom: false,
    customFlow: [],
  };
}

export function parseStepEditor(step: Pick<ReviewStep, 'id' | 'operation' | 'flow' | 'input'>): StepEditorModel {
  const result = defaultStepEditor(step.operation);
  const { delayMs, action, standard } = splitFlow(step.flow);
  result.delayMs = delayMs;
  result.parameterized = Boolean(step.input);
  result.inputLabel = step.input?.label ?? '输入值';
  result.inputDescription = step.input?.description ?? '';
  result.inputDefault = step.input?.default ?? '';
  if (!standard || !action) {
    return { ...result, custom: true, customFlow: clone(step.flow) };
  }

  if (step.operation === 'click' || step.operation === 'doubleClick') {
    const key = step.operation === 'click' ? 'aiTap' : 'aiDoubleClick';
    if (typeof action[key] !== 'string' || Object.keys(action).length !== 1) {
      return { ...result, custom: true, customFlow: clone(step.flow) };
    }
    result.target = action[key] as string;
    return result;
  }
  if (step.operation === 'input') {
    const keyboard = objectValue(action.KeyboardTypeText);
    if (!keyboard || Object.keys(action).length !== 1) {
      return { ...result, custom: true, customFlow: clone(step.flow) };
    }
    result.target = stringValue(keyboard.locate);
    result.inputMode = keyboard.mode === 'append' ? 'append' : 'replace';
    const value = stringValue(keyboard.value);
    result.inputValue = value === `{{${step.id}-input}}` ? result.inputDefault : value;
    return result;
  }
  if (step.operation === 'keyboard') {
    const keyboard = objectValue(action.KeyboardPress);
    if (!keyboard || Object.keys(action).length !== 1) {
      return { ...result, custom: true, customFlow: clone(step.flow) };
    }
    result.keyName = stringValue(keyboard.keyName);
    return result;
  }
  if (typeof action.aiWaitFor !== 'string' || !Object.keys(action).every((key) => key === 'aiWaitFor' || key === 'timeout')) {
    return { ...result, custom: true, customFlow: clone(step.flow) };
  }
  result.waitCondition = action.aiWaitFor;
  result.timeoutMs = numberValue(action.timeout, 15_000);
  return result;
}

export function buildStepContent(model: StepEditorModel, stepId: string): BuiltStepContent {
  if (model.custom) {
    return {
      flow: clone(model.customFlow),
      ...(model.operation === 'input' && model.parameterized
        ? {
            input: {
              type: 'string' as const,
              label: model.inputLabel.trim() || '输入值',
              ...(model.inputDescription.trim() ? { description: model.inputDescription.trim() } : {}),
              default: model.inputDefault,
            },
          }
        : { input: null }),
    };
  }
  const flow: JsonObject[] = [];
  const delayMs = Math.max(0, Math.round(model.delayMs || 0));
  if (delayMs) flow.push({ sleep: delayMs });
  if (model.operation === 'click') flow.push({ aiTap: model.target });
  else if (model.operation === 'doubleClick') flow.push({ aiDoubleClick: model.target });
  else if (model.operation === 'input') {
    flow.push({
      KeyboardTypeText: {
        locate: model.target,
        value: model.parameterized ? `{{${stepId}-input}}` : model.inputValue,
        mode: model.inputMode,
      },
    });
  } else if (model.operation === 'keyboard') {
    flow.push({ KeyboardPress: { keyName: model.keyName } });
  } else {
    flow.push({ aiWaitFor: model.waitCondition, timeout: Math.max(1, Math.round(model.timeoutMs || 15_000)) });
  }
  if (model.operation === 'input' && model.parameterized) {
    return {
      flow,
      input: {
        type: 'string',
        label: model.inputLabel.trim() || '输入值',
        ...(model.inputDescription.trim() ? { description: model.inputDescription.trim() } : {}),
        default: model.inputDefault,
      },
    };
  }
  return { flow, input: null };
}

export function inputPreview(stepId: string, input: TaskInputDefinition | null | undefined): JsonObject {
  return input ? { [`${stepId}-input`]: clone(input) } : {};
}

export function parseInputPreview(value: unknown, stepId: string): TaskInputDefinition | null {
  const record = objectValue(value);
  if (!record) throw new Error('参数 JSON 必须是对象');
  const keys = Object.keys(record);
  if (!keys.length) return null;
  const inputId = `${stepId}-input`;
  if (keys.length !== 1 || keys[0] !== inputId) throw new Error(`参数 JSON 只能包含 ${inputId}`);
  const definition = objectValue(record[inputId]);
  if (!definition || definition.type !== 'string' || typeof definition.label !== 'string' || typeof definition.default !== 'string') {
    throw new Error('参数定义必须包含 type: string、label 和 default');
  }
  if (definition.description !== undefined && definition.description !== null && typeof definition.description !== 'string') {
    throw new Error('参数 description 必须是字符串或 null');
  }
  return {
    type: 'string',
    label: definition.label,
    ...(definition.description !== undefined ? { description: definition.description as string | null } : {}),
    default: definition.default,
  };
}
