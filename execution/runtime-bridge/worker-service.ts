import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { dispatchRuntimeBridgeLine, type RuntimeBridgeHandlers } from './dispatcher.js';

export async function runRuntimeBridgeWorker(
  input: Readable,
  output: Writable,
  handlers?: RuntimeBridgeHandlers,
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const response = handlers === undefined
      ? await dispatchRuntimeBridgeLine(line, undefined, (frame) => output.write(`${JSON.stringify(frame)}\n`))
      : await dispatchRuntimeBridgeLine(line, handlers, (frame) => output.write(`${JSON.stringify(frame)}\n`));
    output.write(`${response}\n`);
  }
}

