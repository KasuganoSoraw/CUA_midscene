import type {
  ExecutorResult,
  JsonObject,
  NativeAiActExecutorResult,
  SceneCatalogItem,
  TaskCatalogItem,
  TaskDescription,
} from '../cua/contracts/types.js';

export const cuaAgentToolNames = ['cua_catalog', 'cua_execute', 'cua_workbench'] as const;
export type CuaAgentToolName = typeof cuaAgentToolNames[number];

interface CuaToolRequestBase {
  dataRoot?: string;
}

export type CuaCatalogRequest =
  | (CuaToolRequestBase & { action: 'list-scenes' })
  | (CuaToolRequestBase & { action: 'list-tasks'; scene: string })
  | (CuaToolRequestBase & { action: 'describe-task'; scene: string; task: string });

export type CuaCatalogResult =
  | { action: 'list-scenes'; scenes: SceneCatalogItem[] }
  | { action: 'list-tasks'; scene: string; tasks: TaskCatalogItem[] }
  | { action: 'describe-task'; scene: string; task: string; description: TaskDescription };

interface CuaRecordedExecutionRequest extends CuaToolRequestBase {
  scene: string;
  task: string;
  inputs?: Record<string, string>;
  dryRun?: boolean;
}

export type CuaExecuteRequest =
  | (CuaRecordedExecutionRequest & { strategy: 'replay' })
  | (CuaRecordedExecutionRequest & { strategy: 'guided' })
  | (CuaToolRequestBase & {
      strategy: 'freeform';
      goal: string;
      displayId?: string;
      dryRun?: boolean;
    });

export interface CuaExecuteResult {
  strategy: CuaExecuteRequest['strategy'];
  status: 'succeeded' | 'failed';
  runDir: string;
  resolvedTaskPath?: string;
  promptPath?: string;
  resultPath?: string;
  executor: ExecutorResult | NativeAiActExecutorResult;
}

export type CuaWorkbenchMode = 'recording' | 'review' | 'execution';

export type CuaWorkbenchRequest =
  | (CuaToolRequestBase & { mode: 'recording' })
  | (CuaToolRequestBase & {
      mode: 'review' | 'execution';
      scene?: string;
      task?: string;
    });

export interface CuaWorkbenchResult {
  mode: CuaWorkbenchMode;
  baseUrl: string;
  url: string;
  reused: boolean;
}

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
