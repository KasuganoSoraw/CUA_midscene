import { randomBytes } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cleanupRunHistorySafely, runStateFilename } from './run-history.js';

const failedRuns = new WeakMap<Error, string>();

export function failedRunDirectory(error: unknown): string | undefined {
  return error instanceof Error ? failedRuns.get(error) : undefined;
}

export async function createRunDirectory(runsRoot: string): Promise<string> {
  const root = path.resolve(runsRoot);
  await mkdir(root, { recursive: true });
  const now = new Date().toISOString().replaceAll(':', '-').replace('.', '-');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const runDirectory = path.join(root, `${now}-${randomBytes(4).toString('hex')}`);
    try {
      await mkdir(runDirectory);
      return runDirectory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`无法创建唯一运行目录：${root}`);
}

/** Keep the run active until every execution artifact has been written. */
export async function withRunDirectory<T>(
  runsRoot: string,
  operation: (runDirectory: string) => Promise<T>,
): Promise<T> {
  const runDirectory = await createRunDirectory(runsRoot);
  const startedAt = new Date().toISOString();
  const statePath = path.join(runDirectory, runStateFilename);
  async function writeState(state: 'running' | 'completed' | 'failed'): Promise<void> {
    const temporary = `${statePath}.tmp`;
    await writeFile(temporary, JSON.stringify({
      schemaVersion: '1.0', state, pid: process.pid, startedAt,
      ...(state === 'running' ? {} : { finishedAt: new Date().toISOString() }),
    }), 'utf8');
    await rename(temporary, statePath);
  }
  await writeState('running');
  await cleanupRunHistorySafely(runsRoot, runDirectory);
  let state: 'completed' | 'failed' = 'failed';
  try {
    const result = await operation(runDirectory);
    state = 'completed';
    return result;
  } catch (error) {
    if (error instanceof Error) failedRuns.set(error, runDirectory);
    throw error;
  } finally {
    try {
      await writeState(state);
    } catch (error) {
      console.warn(`Unable to finalize run history state: ${error instanceof Error ? error.message : String(error)}`);
    }
    await cleanupRunHistorySafely(runsRoot, runDirectory);
  }
}
