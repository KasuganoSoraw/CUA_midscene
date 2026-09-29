import type { JsonObject } from '../contracts/types.js';
import { validateYamlDocument } from './yaml-task.js';

export interface RecordedTaskAiActPrompt {
  prompt: string;
  images: Array<{ name: string; url: string }>;
  convertHttpImage2Base64?: boolean;
}

function requiredString(value: unknown, field: string, context: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${context} 的 ${field} 必须是非空字符串`);
  return value.trim();
}

function readUserPrompt(value: unknown, field: string, context: string): RecordedTaskAiActPrompt {
  if (typeof value === 'string') return { prompt: requiredString(value, field, context), images: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} 的 ${field} 必须是非空字符串或 Midscene 图片 prompt`);
  }
  const userPrompt = value as JsonObject;
  const allowed = new Set(['prompt', 'images', 'convertHttpImage2Base64']);
  const unexpected = Object.keys(userPrompt).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`${context} 的 ${field} 包含无法解释的字段：${unexpected.sort().join(', ')}`);
  if (!Array.isArray(userPrompt.images) || userPrompt.images.length === 0) {
    throw new Error(`${context} 的 ${field}.images 必须是非空数组`);
  }
  const images = userPrompt.images.map((image, index) => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      throw new Error(`${context} 的 ${field}.images[${index}] 必须是对象`);
    }
    const item = image as JsonObject;
    return {
      name: requiredString(item.name, `${field}.images[${index}].name`, context),
      url: requiredString(item.url, `${field}.images[${index}].url`, context),
    };
  });
  if (userPrompt.convertHttpImage2Base64 !== undefined && typeof userPrompt.convertHttpImage2Base64 !== 'boolean') {
    throw new Error(`${context} 的 ${field}.convertHttpImage2Base64 必须是布尔值`);
  }
  return {
    prompt: requiredString(userPrompt.prompt, `${field}.prompt`, context),
    images,
    ...(userPrompt.convertHttpImage2Base64 === true ? { convertHttpImage2Base64: true } : {}),
  };
}

function renderAction(action: JsonObject, context: string): RecordedTaskAiActPrompt | undefined {
  if (Object.hasOwn(action, 'sleep')) {
    if (Object.keys(action).length !== 1) throw new Error(`${context} 的 sleep 不能与其他字段组合`);
    if (!Number.isInteger(action.sleep)) throw new Error(`${context} 的 sleep 必须是整数`);
    return undefined;
  }
  const supported = ['ai', 'aiDoubleClick', 'aiTap', 'aiWaitFor', 'KeyboardPress', 'KeyboardTypeText'];
  const names = supported.filter((name) => Object.hasOwn(action, name));
  if (names.length !== 1) {
    throw new Error(`${context} 必须且只能包含一个受支持动作，当前字段：${Object.keys(action).sort().join(', ') || '空动作'}`);
  }
  const name = names[0];
  const allowed = new Set([name]);
  if (name === 'aiWaitFor') allowed.add('timeout');
  if (name === 'aiTap' || name === 'aiDoubleClick') allowed.add('locate');
  const unexpected = Object.keys(action).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`${context} 包含无法解释的字段：${unexpected.sort().join(', ')}`);
  const value = action[name];
  if (name === 'aiTap' || name === 'aiDoubleClick') {
    const hasLocate = Object.hasOwn(action, 'locate');
    if (hasLocate && value !== null && value !== undefined) {
      throw new Error(`${context} 使用 locate 时 ${name} 的值必须为空`);
    }
    const locatedPrompt = readUserPrompt(hasLocate ? action.locate : value, hasLocate ? 'locate' : name, context);
    return {
      ...locatedPrompt,
      prompt: name === 'aiTap'
        ? locatedPrompt.prompt
        : `双击以下描述对应的目标：${JSON.stringify(locatedPrompt.prompt)}`,
    };
  }
  if (name === 'ai') return readUserPrompt(value, name, context);
  if (name === 'aiWaitFor') return { prompt: requiredString(value, name, context), images: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} 的 ${name} 必须是对象`);
  const parameters = value as JsonObject;
  if (name === 'KeyboardPress') {
    return {
      prompt: `按下 ${JSON.stringify(requiredString(parameters.keyName, 'KeyboardPress.keyName', context))} 键`,
      images: [],
    };
  }
  const locate = requiredString(parameters.locate, 'locate', context);
  if (typeof parameters.value !== 'string') throw new Error(`${context} 的 KeyboardTypeText.value 必须是字符串`);
  const mode = parameters.mode ?? 'replace';
  if (!['replace', 'append', 'typeOnly', 'clear'].includes(String(mode))) {
    throw new Error(`${context} 的 KeyboardTypeText.mode 不受支持：${String(mode)}`);
  }
  if (mode === 'clear') return { prompt: `使用 KeyboardTypeText 清空 ${JSON.stringify(locate)}`, images: [] };
  const modeText = { replace: '替换输入', append: '追加输入', typeOnly: '直接输入' }[mode as 'replace'];
  return {
    prompt: `使用 KeyboardTypeText 在 ${JSON.stringify(locate)} 中${modeText} ${JSON.stringify(parameters.value)}`,
    images: [],
  };
}

export function buildRecordedTaskAiActPrompt(document: JsonObject): RecordedTaskAiActPrompt {
  validateYamlDocument(document, 'recorded task aiAct prompt');
  const lines = ['请严格按以下步骤顺序完成电脑操作：'];
  const images = new Map<string, string>();
  let convertHttpImage2Base64 = false;
  for (const task of document.tasks as JsonObject[]) {
    const taskName = String(task.name).trim();
    const rendered = (task.flow as JsonObject[])
      .map((action, index) => renderAction(action, `${taskName} 的 flow[${index + 1}]`))
      .filter((value): value is RecordedTaskAiActPrompt => value !== undefined);
    if (!rendered.length) throw new Error(`${taskName} 没有可用于整体 aiAct 的执行动作`);
    for (const item of rendered) {
      convertHttpImage2Base64 ||= item.convertHttpImage2Base64 === true;
      for (const image of item.images) {
        const existing = images.get(image.name);
        if (existing !== undefined && existing !== image.url) {
          throw new Error(`整体 aiAct 参考图名称冲突：${image.name} 同时指向 ${existing} 和 ${image.url}`);
        }
        images.set(image.name, image.url);
      }
    }
    lines.push(`${taskName}:`, ...rendered.map((item, index) => `  ${index + 1}. ${item.prompt}`));
  }
  return {
    prompt: `${lines.join('\n')}\n`,
    images: [...images].map(([name, url]) => ({ name, url })),
    ...(convertHttpImage2Base64 ? { convertHttpImage2Base64: true } : {}),
  };
}
