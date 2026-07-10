import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ParsedTaskArgs {
  values: Map<string, string>;
  flags: Set<string>;
  inputAssignments: string[];
}

export function parseTaskArgs(argv: string[], booleanFlags: string[] = []): ParsedTaskArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const inputAssignments: string[] = [];
  const knownBooleanFlags = new Set(booleanFlags);

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith('--')) {
      throw new Error(`无法识别参数：${current}`);
    }

    const key = current.slice(2);
    if (knownBooleanFlags.has(key)) {
      flags.add(key);
      continue;
    }

    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`参数 --${key} 缺少值`);
    }

    if (key === 'input') {
      inputAssignments.push(value);
    } else {
      if (values.has(key)) {
        throw new Error(`参数 --${key} 不能重复提供`);
      }
      values.set(key, value);
    }
    i += 1;
  }

  return { values, flags, inputAssignments };
}

function parseInputAssignment(assignment: string): [string, string] {
  const separator = assignment.indexOf('=');
  if (separator <= 0) {
    throw new Error(`输入参数必须使用 key=value 格式：${assignment}`);
  }

  return [assignment.slice(0, separator), assignment.slice(separator + 1)];
}

function addInput(target: Record<string, string>, key: string, value: unknown, source: string): void {
  if (typeof value !== 'string') {
    throw new Error(`输入 ${key} 在 ${source} 中必须是字符串`);
  }
  if (Object.hasOwn(target, key)) {
    throw new Error(`输入 ${key} 被重复提供`);
  }
  target[key] = value;
}

export async function loadRuntimeInputs(args: ParsedTaskArgs, cwd = process.cwd()): Promise<Record<string, string>> {
  const inputs: Record<string, string> = {};
  const inputsFile = args.values.get('inputs');
  if (inputsFile) {
    const filePath = path.resolve(cwd, inputsFile);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`读取输入文件失败：${filePath}\n${message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`输入文件必须是 JSON 对象：${filePath}`);
    }
    for (const [key, value] of Object.entries(parsed)) {
      addInput(inputs, key, value, filePath);
    }
  }

  for (const assignment of args.inputAssignments) {
    const [key, value] = parseInputAssignment(assignment);
    addInput(inputs, key, value, '--input');
  }

  return inputs;
}
