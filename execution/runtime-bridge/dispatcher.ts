import type { JsonObject } from '../cua/contracts/types.js';
import type { ExecutionProgressSink } from '../executors/midscene-progress.js';
import {
  runtimeBridgeSchemaVersion,
  type CuaCatalogRequest,
  type CuaExecuteRequest,
  type CuaWorkbenchRequest,
  type RuntimeBridgeMethod,
  type RuntimeBridgeEventFrame,
  type RuntimeBridgeRequest,
  type RuntimeBridgeResponse,
} from './contracts.js';
import { cuaCatalog, cuaExecute, cuaWorkbench } from './tools/index.js';
import { failedExecutionReport } from './failure-report.js';
import { cuaRecord, type CuaRecordRequest } from './tools/record.js';
import type { RecordingProgress } from '../review/shared/recording.js';

export interface RuntimeBridgeHandlers {
  catalog(payload: CuaCatalogRequest): Promise<unknown>;
  execute(payload: CuaExecuteRequest, onProgress?: ExecutionProgressSink): Promise<unknown>;
  workbench(payload: CuaWorkbenchRequest): Promise<unknown>;
  record?(payload: CuaRecordRequest, onProgress?: (event: RecordingProgress) => void, signal?: AbortSignal): Promise<unknown>;
}

const defaultHandlers: RuntimeBridgeHandlers = {
  catalog: cuaCatalog,
  execute: (payload, onProgress) => cuaExecute(payload, {}, onProgress),
  workbench: cuaWorkbench,
  record: cuaRecord,
};

class InvalidRuntimeRequestError extends Error {}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidRuntimeRequestError(`${name} 必须是非空字符串`);
  }
  return value.trim();
}

function requireMethod(value: unknown): RuntimeBridgeMethod {
  if (!['catalog', 'execute', 'workbench', 'record'].includes(String(value))) {
    throw new InvalidRuntimeRequestError(`无法识别 Runtime method：${String(value)}`);
  }
  return value as RuntimeBridgeMethod;
}

export function parseRuntimeBridgeRequest(value: unknown): RuntimeBridgeRequest {
  if (!isObject(value)) throw new InvalidRuntimeRequestError('Runtime request 必须是 JSON object');
  if (value.schemaVersion !== runtimeBridgeSchemaVersion) {
    throw new InvalidRuntimeRequestError(`不支持的 schemaVersion：${String(value.schemaVersion)}`);
  }
  if (!isObject(value.payload)) throw new InvalidRuntimeRequestError('payload 必须是 JSON object');
  return {
    schemaVersion: runtimeBridgeSchemaVersion,
    requestId: requireString(value.requestId, 'requestId'),
    method: requireMethod(value.method),
    payload: value.payload,
  };
}

function requestIdFrom(value: unknown): string {
  return isObject(value) && typeof value.requestId === 'string' && value.requestId.trim()
    ? value.requestId.trim()
    : 'unknown';
}

function jsonObjectFrom(value: unknown): JsonObject {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return {};
  const parsed: unknown = JSON.parse(serialized);
  return isObject(parsed) ? parsed : { value: parsed };
}

function errorDetails(error: unknown): JsonObject {
  if (!(error instanceof Error)) return { value: String(error) };
  return {
    name: error.name,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
    ...(error.cause === undefined ? {} : { cause: jsonObjectFrom(error.cause) }),
  };
}

async function runtimeMethodErrorDetails(request: RuntimeBridgeRequest, error: unknown): Promise<JsonObject> {
  const details = errorDetails(error);
  if (request.method !== 'execute') return details;
  const reportPath = await failedExecutionReport(error, request.payload.strategy);
  if (reportPath !== undefined) details.reportPath = reportPath;
  return details;
}

async function invokeHandler(
  request: RuntimeBridgeRequest, handlers: RuntimeBridgeHandlers,
  onEvent?: (frame: RuntimeBridgeEventFrame) => void, signal?: AbortSignal,
): Promise<unknown> {
  const progress = (event: RuntimeBridgeEventFrame['event']) => onEvent?.({
    schemaVersion: runtimeBridgeSchemaVersion, requestId: request.requestId, type: 'event', event,
  });
  if (request.method === 'catalog') {
    return handlers.catalog(request.payload as unknown as CuaCatalogRequest);
  }
  if (request.method === 'execute') {
    return handlers.execute(request.payload as unknown as CuaExecuteRequest,
      onEvent === undefined ? undefined : progress);
  }
  if (request.method === 'record') {
    if (!handlers.record) throw new Error('Runtime handler 不支持录制');
    return handlers.record(request.payload as unknown as CuaRecordRequest, progress, signal);
  }
  return handlers.workbench(request.payload as unknown as CuaWorkbenchRequest);
}

export async function dispatchRuntimeBridgeRequest(
  value: unknown,
  handlers: RuntimeBridgeHandlers = defaultHandlers,
  onEvent?: (frame: RuntimeBridgeEventFrame) => void,
  signal?: AbortSignal,
): Promise<RuntimeBridgeResponse> {
  let request: RuntimeBridgeRequest;
  try {
    request = parseRuntimeBridgeRequest(value);
  } catch (error) {
    return {
      schemaVersion: runtimeBridgeSchemaVersion,
      requestId: requestIdFrom(value),
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: error instanceof Error ? error.message : String(error),
        details: errorDetails(error),
      },
    };
  }

  try {
    const result = await invokeHandler(request, handlers, onEvent, signal);
    return {
      schemaVersion: runtimeBridgeSchemaVersion,
      requestId: request.requestId,
      ok: true,
      result: jsonObjectFrom(result),
    };
  } catch (error) {
    return {
      schemaVersion: runtimeBridgeSchemaVersion,
      requestId: request.requestId,
      ok: false,
      error: {
        code: 'RUNTIME_METHOD_FAILED',
        message: error instanceof Error ? error.message : String(error),
        details: await runtimeMethodErrorDetails(request, error),
      },
    };
  }
}

export async function dispatchRuntimeBridgeLine(
  line: string,
  handlers: RuntimeBridgeHandlers = defaultHandlers,
  onEvent?: (frame: RuntimeBridgeEventFrame) => void,
  signal?: AbortSignal,
): Promise<string> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    value = { parseError: error instanceof Error ? error.message : String(error) };
  }
  return JSON.stringify(await dispatchRuntimeBridgeRequest(value, handlers, onEvent, signal));
}
