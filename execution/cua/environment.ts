import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { packageRoot } from './package-root.js';

export const environmentFilenames = ['.env.local', '.env'] as const;

export function environmentRoot(executionRoot = packageRoot): string {
  return path.dirname(path.resolve(executionRoot));
}

export function readEnvironmentFiles(executionRoot = packageRoot): Record<string, string> {
  const values: Record<string, string> = {};
  const root = environmentRoot(executionRoot);
  for (const filename of [...environmentFilenames].reverse()) {
    try {
      Object.assign(values, dotenv.parse(readFileSync(path.join(root, filename))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return values;
}

export function applyEnvironmentFiles(executionRoot = packageRoot): void {
  for (const [name, value] of Object.entries(readEnvironmentFiles(executionRoot))) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

export async function readEnvironmentValue(
  name: string,
  executionRoot = packageRoot,
): Promise<{ value?: string; source?: string }> {
  const root = environmentRoot(executionRoot);
  for (const filename of environmentFilenames) {
    const file = path.join(root, filename);
    try {
      const value = dotenv.parse(await readFile(file))[name]?.trim();
      if (value) return { value, source: file };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return {};
}
