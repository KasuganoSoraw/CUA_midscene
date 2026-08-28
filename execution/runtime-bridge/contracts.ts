import type {
  ExecutorResult,
  JsonObject,
  NativeAiActExecutorResult,
  SceneCatalogItem,
  TaskCatalogItem,
  TaskDescription,
} from '../cua/contracts/types.js';

export const runtimeBridgeSchemaVersion = '1.0' as const;
export const cuaRuntimeToolNames = ['cua_catalog', 'cua_execute', 'cua_workbench'] as const;
export type CuaRuntimeToolName = typeof cuaRuntimeToolNames[number];

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

export type RuntimeBridgeMethod = 'catalog' | 'execute' | 'workbench';

export interface RuntimeBridgeRequest {
  schemaVersion: typeof runtimeBridgeSchemaVersion;
  requestId: string;
  method: RuntimeBridgeMethod;
  payload: JsonObject;
}

export interface RuntimeBridgeError {
  code: 'INVALID_REQUEST' | 'RUNTIME_METHOD_FAILED';
  message: string;
  details?: JsonObject;
}

export type RuntimeBridgeResponse =
  | {
      schemaVersion: typeof runtimeBridgeSchemaVersion;
      requestId: string;
      ok: true;
      result: JsonObject;
    }
  | {
      schemaVersion: typeof runtimeBridgeSchemaVersion;
      requestId: string;
      ok: false;
      error: RuntimeBridgeError;
    };

