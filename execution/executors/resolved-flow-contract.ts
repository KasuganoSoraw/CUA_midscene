import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Ajv2020 as Ajv2020Class } from 'ajv/dist/2020.js';
import type { FormatsPlugin } from 'ajv-formats';

export type MidsceneRoute =
  | { strategy: 'keyboard'; keyName: string }
  | {
      strategy: 'input';
      prompt: string;
      locatePrompt: string;
      value: string;
      mode?: 'replace' | 'append' | 'typeOnly';
    }
  | { strategy: 'tap'; prompt: string }
  | { strategy: 'act'; prompt: string }
  | { strategy: 'wait'; prompt?: string; condition: string; timeoutMs?: number }
  | { strategy: 'manual-review'; reason: string };

export interface MidsceneFlowStep {
  id: string;
  intent: string;
  timing?: {
    waitBeforeMs?: number;
    waitReason?: 'recorded-step-gap';
  };
  evidence: unknown;
  route: MidsceneRoute;
}

export interface ResolvedFlowSnapshot {
  flow: {
    scene: string;
    task: string;
    goal: string;
    steps: MidsceneFlowStep[];
  };
}

const executionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resolvedFlowSchemaPath = path.join(executionRoot, 'schemas', 'resolved-flow.schema.json');
const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020') as typeof Ajv2020Class;
const addFormats = require('ajv-formats') as FormatsPlugin;

export async function readResolvedFlow(snapshotPath: string): Promise<ResolvedFlowSnapshot> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(snapshotPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取 resolved flow 失败：${snapshotPath}\n${message}`);
  }

  const schema = JSON.parse(await readFile(resolvedFlowSchemaPath, 'utf8')) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(parsed)) {
    const details = ajv.errorsText(validate.errors, { separator: '\n' });
    throw new Error(`resolved flow 契约校验失败：${snapshotPath}\n${details}`);
  }
  return parsed as ResolvedFlowSnapshot;
}
