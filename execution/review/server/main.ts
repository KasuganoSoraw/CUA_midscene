import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { packageRoot } from '../../cua/package-root.js';
import { requireDataPaths, resolveRuntimeLayout } from '../../cua/task/data-paths.js';
import { createReviewApp } from './app.js';

export interface StartedReviewServer {
  server: Server;
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
  const server = createServer(createReviewApp({ layout, staticRoot }));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法读取 review 服务监听地址');
  const url = `http://127.0.0.1:${address.port}/`;
  return {
    server,
    url,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

export function openSystemBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'rundll32' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
