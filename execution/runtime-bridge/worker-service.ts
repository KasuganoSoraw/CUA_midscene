import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { dispatchRuntimeBridgeLine, type RuntimeBridgeHandlers } from './dispatcher.js';

export async function runRuntimeBridgeWorker(
  input: Readable,
  output: Writable,
  handlers?: RuntimeBridgeHandlers,
): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  input.once('end', cancel);
  input.once('close', cancel);
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const response = await dispatchRuntimeBridgeLine(line, handlers,
        (frame) => { output.write(`${JSON.stringify(frame)}\n`); }, controller.signal);
      output.write(`${response}\n`);
    }
  } finally {
    input.removeListener('end', cancel);
    input.removeListener('close', cancel);
  }
}

