import type { JsonObject } from '../cua/contracts/types.js';
import type { CuaRuntimeToolName } from '../runtime-bridge/contracts.js';

export { cuaRuntimeToolNames as cuaAgentToolNames } from '../runtime-bridge/contracts.js';
export type {
  CuaCatalogRequest,
  CuaCatalogResult,
  CuaExecuteRequest,
  CuaExecuteResult,
  CuaWorkbenchMode,
  CuaWorkbenchRequest,
  CuaWorkbenchResult,
} from '../runtime-bridge/contracts.js';
export type CuaAgentToolName = CuaRuntimeToolName;

export interface CuaAgentDefinition {
  name: 'Computer-Use';
  invocationMode: 'stateless-task';
  description: string;
  instructions: string;
  tools: readonly CuaAgentToolName[];
}

export interface CuaSubagentInvocationRequest {
  task: string;
}

export type CuaSubagentInvocationStatus = 'completed' | 'needs-input' | 'failed';

export interface CuaSubagentToolTrace {
  callId: string;
  tool: CuaAgentToolName;
  input: JsonObject;
  status: 'succeeded' | 'failed';
  output?: JsonObject;
  error?: string;
}

export interface CuaSubagentHostResult {
  status: CuaSubagentInvocationStatus;
  reply: string;
  toolCalls: CuaSubagentToolTrace[];
}

export interface CuaSubagentInvocationResult extends CuaSubagentHostResult {
  schemaVersion: '0.1';
  invocationId: string;
}

export interface CuaSubagentStatus {
  available: boolean;
  name: CuaAgentDefinition['name'];
  invocationMode: CuaAgentDefinition['invocationMode'];
  tools: readonly CuaAgentToolName[];
  reason?: string;
}
