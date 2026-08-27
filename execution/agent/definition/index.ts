import { readFileSync } from 'node:fs';
import path from 'node:path';
import { packageRoot } from '../../cua/package-root.js';
import { cuaAgentToolNames, type CuaAgentDefinition } from '../contracts.js';

function readDefinitionAsset(name: 'description.md' | 'instructions.md'): string {
  const file = path.join(packageRoot, 'agent', 'definition', name);
  const value = readFileSync(file, 'utf8').trim();
  if (!value) throw new Error(`CUA Agent definition 不能为空：${file}`);
  return value;
}

export const cuaAgentDefinition: CuaAgentDefinition = Object.freeze({
  name: 'Computer-Use',
  invocationMode: 'stateless-task',
  description: readDefinitionAsset('description.md'),
  instructions: readDefinitionAsset('instructions.md'),
  tools: cuaAgentToolNames,
});
