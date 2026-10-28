import type { JsonObject, TaskInputDefinition } from '../../cua/contracts/types.js';
import type { ReviewOperation, ReviewReferenceImage, ReviewStep } from './types.js';

export type InputMode = 'replace' | 'append';

export interface StepEditorModel {
  operation: ReviewOperation;
  delayMs: number;
  target: string;
  inputValue: string;
  inputMode: InputMode;
  inputAction: 'KeyboardTypeText' | 'aiInput';
  parameterized: boolean;
  inputLabel: string;
  inputDescription: string;
  inputDefault: string;
  keyName: string;
  waitCondition: string;
  timeoutMs: number;
  referenceImages: ReviewReferenceImage[];
  referenceCandidate?: ReviewReferenceImage;
  convertHttpImage2Base64: boolean;
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

function referenceImageList(value: unknown): ReviewReferenceImage[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const images: ReviewReferenceImage[] = [];
  for (const valueItem of value) {
    const item = objectValue(valueItem);
    if (
      !item
      || typeof item.name !== 'string'
      || !item.name.trim()
      || typeof item.url !== 'string'
      || !item.url.trim()
      || !Object.keys(item).every((key) => key === 'name' || key === 'url')
    ) {
      return undefined;
    }
    images.push({ name: item.name, url: item.url });
  }
  return images;
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
    target: operation === 'input' ? '描述输入框位置' : operation === 'aiAct' ? '描述要完成的电脑操作' : '描述要点击的目标',
    inputValue: '',
    inputMode: 'replace',
    inputAction: 'KeyboardTypeText',
    parameterized: operation === 'input',
    inputLabel: '输入值',
    inputDescription: '',
    inputDefault: '',
    keyName: 'Enter',
    waitCondition: '描述需要等待出现的状态',
    timeoutMs: 15_000,
    referenceImages: [],
    convertHttpImage2Base64: false,
    custom: false,
    customFlow: [],
  };
}

function parseClickAction(
  action: JsonObject,
  operation: 'click' | 'doubleClick' | 'rightClick',
): { target: string; referenceImages: ReviewReferenceImage[]; convertHttpImage2Base64: boolean } | undefined {
  const key = { click: 'aiTap', doubleClick: 'aiDoubleClick', rightClick: 'aiRightClick' }[operation];
  if (typeof action[key] === 'string' && Object.keys(action).length === 1) {
    return {
      target: action[key] as string,
      referenceImages: [],
      convertHttpImage2Base64: false,
    };
  }

  const locate = objectValue(action.locate);
  if (
    (action[key] !== null && action[key] !== undefined)
    || !Object.hasOwn(action, key)
    || !locate
    || typeof locate.prompt !== 'string'
    || !locate.prompt.trim()
    || !Object.keys(action).every((name) => name === key || name === 'locate')
    || !Object.keys(locate).every((name) => name === 'prompt' || name === 'images' || name === 'convertHttpImage2Base64')
    || (locate.convertHttpImage2Base64 !== undefined && typeof locate.convertHttpImage2Base64 !== 'boolean')
  ) {
    return undefined;
  }
  const referenceImages = referenceImageList(locate.images);
  if (!referenceImages) return undefined;
  const suffix = referencePromptSuffix(referenceImages);
  return {
    target: locate.prompt.endsWith(suffix) ? locate.prompt.slice(0, -suffix.length) : locate.prompt,
    referenceImages,
    convertHttpImage2Base64: locate.convertHttpImage2Base64 === true,
  };
}

function referencePromptSuffix(images: ReviewReferenceImage[]): string {
  return `\n参考定位图：${images.map(image => image.name).join('、')}`;
}

export function referenceImagesFromFlow(
  flow: JsonObject[],
  operation: ReviewOperation,
): ReviewReferenceImage[] {
  if (operation !== 'click' && operation !== 'doubleClick' && operation !== 'rightClick' && operation !== 'aiAct') return [];
  const { action, standard } = splitFlow(flow);
  if (!standard || !action) return [];
  if (operation === 'aiAct') return clone(parseAiActAction(action)?.referenceImages ?? []);
  return clone(parseClickAction(action, operation)?.referenceImages ?? []);
}

function parseAiActAction(action: JsonObject): {
  target: string; referenceImages: ReviewReferenceImage[]; convertHttpImage2Base64: boolean;
} | undefined {
  if (Object.keys(action).length !== 1) return undefined;
  if (typeof action.ai === 'string' && action.ai.trim()) {
    return { target: action.ai, referenceImages: [], convertHttpImage2Base64: false };
  }
  const ai = objectValue(action.ai);
  const images = referenceImageList(ai?.images);
  if (!ai || typeof ai.prompt !== 'string' || !ai.prompt.trim() || !images
    || !Object.keys(ai).every(key => ['prompt', 'images', 'convertHttpImage2Base64'].includes(key))
    || (ai.convertHttpImage2Base64 !== undefined && typeof ai.convertHttpImage2Base64 !== 'boolean')) return undefined;
  return { target: ai.prompt, referenceImages: images, convertHttpImage2Base64: ai.convertHttpImage2Base64 === true };
}

export function parseStepEditor(step: Pick<ReviewStep, 'id' | 'operation' | 'flow' | 'input'>): StepEditorModel {
  const result = defaultStepEditor(step.operation);
  const { delayMs, action, standard } = splitFlow(step.flow);
  result.delayMs = delayMs;
  result.parameterized = Boolean(step.input);
  result.inputLabel = step.input?.label ?? '输入值';
  result.inputDescription = step.input?.description ?? '';
  result.inputDefault = step.input?.default ?? '';
  if (step.operation === 'input' && parsePasteEditor(result, step)) return result;
  if (!standard || !action) {
    return customStepEditor(result, step.flow);
  }

  if (step.operation === 'click' || step.operation === 'doubleClick' || step.operation === 'rightClick') {
    return parseClickEditor(result, action, step);
  }
  if (step.operation === 'input') {
    return parseInputEditor(result, action, step);
  }
  if (step.operation === 'aiAct') {
    const parsed = parseAiActAction(action);
    if (!parsed) return customStepEditor(result, step.flow);
    result.target = parsed.target;
    result.referenceImages = clone(parsed.referenceImages);
    result.convertHttpImage2Base64 = parsed.convertHttpImage2Base64;
    return result;
  }
  if (step.operation === 'keyboard') {
    return parseKeyboardEditor(result, action, step.flow);
  }
  if (typeof action.aiWaitFor !== 'string' || !Object.keys(action).every((key) => key === 'aiWaitFor' || key === 'timeout')) {
    return customStepEditor(result, step.flow);
  }
  result.waitCondition = action.aiWaitFor;
  result.timeoutMs = numberValue(action.timeout, 15_000);
  return result;
}

function parsePasteEditor(
  result: StepEditorModel,
  step: Pick<ReviewStep, 'id' | 'flow'>,
): boolean {
  const actions = Object.hasOwn(step.flow[0] ?? {}, 'sleep') ? step.flow.slice(1) : step.flow;
  if (actions.length !== 2) return false;
  const focus = objectValue(actions[0].KeyboardPress);
  const paste = actions[1];
  const focusLocate = objectValue(focus?.locate);
  if (
    !focus || focus.keyName !== 'End' || typeof focusLocate?.prompt !== 'string'
    || !Object.keys(focusLocate).every((key) => key === 'prompt')
    || Object.keys(actions[0]).length !== 1
    || !Object.keys(focus).every((key) => key === 'keyName' || key === 'locate')
    || paste.aiInput !== null || paste.mode !== 'typeOnly'
    || !Object.keys(paste).every((key) => ['aiInput', 'value', 'mode'].includes(key))
  ) return false;
  result.inputAction = 'aiInput';
  result.inputMode = 'append';
  result.target = focusLocate.prompt;
  const value = stringValue(paste.value);
  result.inputValue = value === `{{${step.id}-input}}` ? result.inputDefault : value;
  return true;
}

function customStepEditor(result: StepEditorModel, flow: JsonObject[]): StepEditorModel {
  return { ...result, custom: true, customFlow: clone(flow) };
}

function parseClickEditor(
  result: StepEditorModel, action: JsonObject,
  step: Pick<ReviewStep, 'operation' | 'flow'>,
): StepEditorModel {
  const parsed = parseClickAction(action, step.operation as 'click' | 'doubleClick' | 'rightClick');
  if (!parsed) return customStepEditor(result, step.flow);
  result.target = parsed.target;
  result.referenceImages = clone(parsed.referenceImages);
  result.convertHttpImage2Base64 = parsed.convertHttpImage2Base64;
  return result;
}

function parseInputEditor(
  result: StepEditorModel, action: JsonObject,
  step: Pick<ReviewStep, 'id' | 'flow'>,
): StepEditorModel {
  const keyboard = objectValue(action.KeyboardTypeText);
  const paste = Object.hasOwn(action, 'aiInput') && action.aiInput === null
    && Object.keys(action).every((key) => ['aiInput', 'locate', 'value', 'mode'].includes(key));
  if ((!keyboard || Object.keys(action).length !== 1) && !paste) return customStepEditor(result, step.flow);
  const parameters = paste ? action : keyboard!;
  result.inputAction = paste ? 'aiInput' : 'KeyboardTypeText';
  result.target = stringValue(parameters.locate);
  result.inputMode = parameters.mode === 'append' || parameters.mode === 'typeOnly' ? 'append' : 'replace';
  const value = stringValue(parameters.value);
  result.inputValue = value === `{{${step.id}-input}}` ? result.inputDefault : value;
  return result;
}

function parseKeyboardEditor(result: StepEditorModel, action: JsonObject, flow: JsonObject[]): StepEditorModel {
  const keyboard = objectValue(action.KeyboardPress);
  if (!keyboard || Object.keys(action).length !== 1) return customStepEditor(result, flow);
  result.keyName = stringValue(keyboard.keyName);
  return result;
}

function buildStepInput(model: StepEditorModel): TaskInputDefinition | null {
  if (model.operation !== 'input' || !model.parameterized) return null;
  return {
    type: 'string',
    label: model.inputLabel.trim() || '输入值',
    ...(model.inputDescription.trim() ? { description: model.inputDescription.trim() } : {}),
    default: model.inputDefault,
  };
}

function buildClickAction(model: StepEditorModel): JsonObject {
  const key = { click: 'aiTap', doubleClick: 'aiDoubleClick', rightClick: 'aiRightClick' }[model.operation as 'click' | 'doubleClick' | 'rightClick'];
  if (!model.referenceImages.length) return { [key]: model.target };
  return {
    [key]: null,
    locate: {
      prompt: model.referenceImages.every(image => model.target.includes(image.name))
        ? model.target : `${model.target}${referencePromptSuffix(model.referenceImages)}`,
      images: clone(model.referenceImages),
      ...(model.convertHttpImage2Base64 ? { convertHttpImage2Base64: true } : {}),
    },
  };
}

function buildStepAction(model: StepEditorModel, stepId: string): JsonObject {
  if (model.operation === 'click' || model.operation === 'doubleClick' || model.operation === 'rightClick') return buildClickAction(model);
  if (model.operation === 'aiAct') return { ai: model.referenceImages.length ? {
    prompt: model.target,
    images: clone(model.referenceImages),
    ...(model.convertHttpImage2Base64 ? { convertHttpImage2Base64: true } : {}),
  } : model.target };
  if (model.operation === 'input') {
    if (model.inputAction === 'aiInput') {
      return {
        aiInput: null,
        locate: model.target,
        value: model.parameterized ? `{{${stepId}-input}}` : model.inputValue,
        mode: model.inputMode === 'append' ? 'typeOnly' : 'replace',
      };
    }
    return {
      KeyboardTypeText: {
        locate: model.target,
        value: model.parameterized ? `{{${stepId}-input}}` : model.inputValue,
        mode: model.inputMode,
      },
    };
  }
  if (model.operation === 'keyboard') return { KeyboardPress: { keyName: model.keyName } };
  return { aiWaitFor: model.waitCondition, timeout: Math.max(1, Math.round(model.timeoutMs || 15_000)) };
}

export function buildStepContent(model: StepEditorModel, stepId: string): BuiltStepContent {
  const input = buildStepInput(model);
  if (model.custom) return { flow: clone(model.customFlow), input };
  const flow: JsonObject[] = [];
  const delayMs = Math.max(0, Math.round(model.delayMs || 0));
  if (delayMs) flow.push({ sleep: delayMs });
  if (model.operation === 'input' && model.inputAction === 'aiInput' && model.inputMode === 'append') {
    flow.push({ KeyboardPress: { keyName: 'End', locate: { prompt: model.target } } });
    flow.push({
      aiInput: null,
      value: model.parameterized ? `{{${stepId}-input}}` : model.inputValue,
      mode: 'typeOnly',
    });
    return { flow, input };
  }
  flow.push(buildStepAction(model, stepId));
  return { flow, input };
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
