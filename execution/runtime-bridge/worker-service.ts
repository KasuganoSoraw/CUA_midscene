import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import {
  dispatchRuntimeBridgeLine,
  parseRuntimeBridgeRequest,
  type RuntimeBridgeHandlers,
} from './dispatcher.js';

function frameFromLine(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function cancelRequestId(frame: Record<string, unknown> | undefined): string | undefined {
  if (!frame || frame.schemaVersion !== '1.0' || frame.type !== 'cancel'
    || typeof frame.requestId !== 'string' || !frame.requestId.trim()
    || Object.keys(frame).some(key => !['schemaVersion', 'type', 'requestId'].includes(key))) return undefined;
  return frame.requestId;
}

export async function runRuntimeBridgeWorker(
  input: Readable,
  output: Writable,
  handlers?: RuntimeBridgeHandlers,
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const controllers = new Map<string, AbortController>();
  let pending = Promise.resolve();
  for await (const line of lines) {
    if (!line.trim()) continue;
    const frame = frameFromLine(line);
    const target = cancelRequestId(frame);
    if (target !== undefined) {
      controllers.get(target)?.abort();
      continue;
    }
    let requestId: string | undefined;
    let controller: AbortController | undefined;
    try {
      const request = parseRuntimeBridgeRequest(frame);
      if (request.method === 'execute') {
        requestId = request.requestId;
        controller = new AbortController();
        controllers.set(requestId, controller);
      }
    } catch { /* Dispatcher returns the existing invalid-request response. */ }
    pending = pending.then(async () => {
      try {
        const response = await dispatchRuntimeBridgeLine(
          line, handlers, frame => output.write(`${JSON.stringify(frame)}\n`), controller?.signal,
        );
        output.write(`${response}\n`);
      } finally {
        if (requestId !== undefined) controllers.delete(requestId);
      }
    });
  }
  await pending;
}

