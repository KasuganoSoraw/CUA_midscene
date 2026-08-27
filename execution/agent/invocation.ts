import { randomUUID } from 'node:crypto';
import type {
  CuaAgentDefinition,
  CuaCatalogRequest,
  CuaCatalogResult,
  CuaExecuteRequest,
  CuaExecuteResult,
  CuaSubagentHostResult,
  CuaSubagentInvocationRequest,
  CuaSubagentInvocationResult,
  CuaWorkbenchRequest,
  CuaWorkbenchResult,
} from './contracts.js';
import { cuaAgentDefinition } from './definition/index.js';
import { cuaCatalog, cuaExecute, cuaWorkbench } from './tools/index.js';

export interface CuaSubagentToolset {
  cua_catalog(request: CuaCatalogRequest): Promise<CuaCatalogResult>;
  cua_execute(request: CuaExecuteRequest): Promise<CuaExecuteResult>;
  cua_workbench(request: CuaWorkbenchRequest): Promise<CuaWorkbenchResult>;
}

export interface CuaSubagentHostInvocation {
  invocationId: string;
  task: string;
  definition: CuaAgentDefinition;
  tools: CuaSubagentToolset;
}

export interface CuaSubagentHost {
  invoke(invocation: CuaSubagentHostInvocation): Promise<CuaSubagentHostResult>;
}

export interface CuaSubagentInvocationOptions {
  dataRoot?: string;
  createInvocationId?: () => string;
}

function taskFrom(request: CuaSubagentInvocationRequest): string {
  if (typeof request.task !== 'string' || !request.task.trim()) {
    throw new Error('Subagent task 必须是非空字符串');
  }
  return request.task.trim();
}

function withDataRoot<T extends { dataRoot?: string }>(request: T, dataRoot?: string): T {
  return request.dataRoot === undefined && dataRoot !== undefined
    ? { ...request, dataRoot }
    : request;
}

export function createCuaSubagentToolset(dataRoot?: string): CuaSubagentToolset {
  return Object.freeze({
    cua_catalog: (request: CuaCatalogRequest) => cuaCatalog(withDataRoot(request, dataRoot)),
    cua_execute: (request: CuaExecuteRequest) => cuaExecute(withDataRoot(request, dataRoot)),
    cua_workbench: (request: CuaWorkbenchRequest) => cuaWorkbench(withDataRoot(request, dataRoot)),
  });
}

function requireHostResult(result: CuaSubagentHostResult): CuaSubagentHostResult {
  if (!result || !['completed', 'needs-input', 'failed'].includes(result.status)) {
    throw new Error('Agent Host 返回了无效 status');
  }
  if (typeof result.reply !== 'string' || !result.reply.trim()) {
    throw new Error('Agent Host 返回了空回复');
  }
  if (!Array.isArray(result.toolCalls)) throw new Error('Agent Host 返回了无效 toolCalls');
  return result;
}

export async function invokeCuaSubagent(
  request: CuaSubagentInvocationRequest,
  host: CuaSubagentHost,
  options: CuaSubagentInvocationOptions = {},
): Promise<CuaSubagentInvocationResult> {
  const invocationId = (options.createInvocationId ?? randomUUID)();
  const result = requireHostResult(await host.invoke({
    invocationId,
    task: taskFrom(request),
    definition: cuaAgentDefinition,
    tools: createCuaSubagentToolset(options.dataRoot),
  }));
  return {
    schemaVersion: '0.1',
    invocationId,
    ...result,
  };
}
