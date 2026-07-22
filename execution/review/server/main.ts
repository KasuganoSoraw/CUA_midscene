import { spawn } from 'node:child_process';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { packageRoot } from '../../cua/package-root.js';
import { requireDataPaths, resolveRuntimeLayout } from '../../cua/task/data-paths.js';
import { createReviewApp } from './app.js';

export interface StartedReviewServer {
  server: FastifyInstance;
  url: string;
  close(): Promise<void>;
}

export async function startReviewServer(options: {
  dataRoot?: string;
  port?: number;
  staticRoot?: string;
} = {}): Promise<StartedReviewServer> {
  const layout = await resolveRuntimeLayout(options.dataRoot);
  await requireDataPaths(layout);
  const staticRoot = path.resolve(options.staticRoot ?? path.join(packageRoot, 'dist', 'review', 'web'));
  const server = await createReviewApp({ layout, staticRoot });
  const address = await server.listen({ host: '127.0.0.1', port: options.port ?? 0 });
  const url = `${address.replace(/\/$/, '')}/`;
  return {
    server,
    url,
    close: () => server.close(),
  };
}

export function openSystemBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'rundll32' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
