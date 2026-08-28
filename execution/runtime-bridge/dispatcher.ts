import type { JsonObject } from '../cua/contracts/types.js';
import {
  runtimeBridgeSchemaVersion,
  type CuaCatalogRequest,
  type CuaExecuteRequest,
  type CuaWorkbenchRequest,
  type RuntimeBridgeMethod,
  type RuntimeBridgeRequest,
  type RuntimeBridgeResponse,
} from './contracts.js';
import { cuaCatalog, cuaExecute, cuaWorkbench } from './tools/index.js';

export interface RuntimeBridgeHandlers {
  catalog(payload: CuaCatalogRequest): Promise<unknown>;
  execute(payload: CuaExecuteRequest): Promise<unknown>;
  workbench(payload: CuaWorkbenchRequest): Promise<unknown>;
}

const defaultHandlers: RuntimeBridgeHandlers = {
  catalog: cuaCatalog,
  execute: cuaExecute,
  workbench: cuaWorkbench,
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
  if (!['catalog', 'execute', 'workbench'].includes(String(value))) {
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

export async function dispatchRuntimeBridgeRequest(
  value: unknown,
  handlers: RuntimeBridgeHandlers = defaultHandlers,
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
    const result = request.method === 'catalog'
      ? await handlers.catalog(request.payload as unknown as CuaCatalogRequest)
      : request.method === 'execute'
        ? await handlers.execute(request.payload as unknown as CuaExecuteRequest)
        : await handlers.workbench(request.payload as unknown as CuaWorkbenchRequest);
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
        details: errorDetails(error),
      },
    };
  }
}

export async function dispatchRuntimeBridgeLine(
  line: string,
  handlers: RuntimeBridgeHandlers = defaultHandlers,
): Promise<string> {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    value = { parseError: error instanceof Error ? error.message : String(error) };
  }
  return JSON.stringify(await dispatchRuntimeBridgeRequest(value, handlers));
}
