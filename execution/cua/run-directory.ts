import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

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
