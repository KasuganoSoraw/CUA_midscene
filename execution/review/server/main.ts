import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { packageRoot } from '../../cua/package-root.js';
import { requireDataPaths, resolveRuntimeLayout } from '../../cua/task/data-paths.js';
import type { ReviewServerIdentity } from '../shared/types.js';
import { createReviewApp } from './app.js';
import type { ReviewRouteDependencies } from './routes.js';

export interface StartedReviewServer {
  server?: FastifyInstance;
  url: string;
  reused: boolean;
  close(): Promise<void>;
}

export const defaultReviewPort = 47831;
export const reviewServiceName = 'cua-midscene-review';
export const reviewProtocolVersion = 1;

export function reviewDataRootKey(root: string): string {
  const normalized = path.normalize(path.resolve(root));
  const stable = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  return createHash('sha256').update(stable).digest('hex');
}

function identityFor(dataRoot: string, devMode: boolean): ReviewServerIdentity {
  return {
    service: reviewServiceName,
    protocolVersion: reviewProtocolVersion,
    dataRootKey: reviewDataRootKey(dataRoot),
    devMode,
  };
}

function identityMatches(actual: unknown, expected: ReviewServerIdentity): boolean {
  if (!actual || typeof actual !== 'object') return false;
  const identity = actual as Partial<ReviewServerIdentity>;
  return identity.service === expected.service
    && identity.protocolVersion === expected.protocolVersion
    && identity.dataRootKey === expected.dataRootKey
    && (!expected.devMode || identity.devMode === true);
}

async function probeReviewServer(url: string, expected: ReviewServerIdentity): Promise<boolean> {
  try {
    const response = await fetch(new URL('/api/review/identity', url), {
      signal: AbortSignal.timeout(500),
    });
    return response.ok && identityMatches(await response.json(), expected);
  } catch {
    return false;
  }
}

function publicUrl(baseUrl: string, devMode: boolean): string {
  const url = new URL(baseUrl);
  if (devMode) url.searchParams.set('dev', '1');
  return url.toString();
}

function reusedServer(url: string, devMode: boolean): StartedReviewServer {
  return {
    url: publicUrl(url, devMode),
    reused: true,
    close: async () => undefined,
  };
}

function isAddressInUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE';
}

export async function startReviewServer(options: {
  dataRoot?: string;
  recordingsRoot?: string;
  executionRoot?: string;
  port?: number;
  staticRoot?: string;
  dev?: boolean;
  dependencies?: ReviewRouteDependencies;
} = {}): Promise<StartedReviewServer> {
  const layout = await resolveRuntimeLayout(options.dataRoot);
  const data = await requireDataPaths(layout);
  const staticRoot = path.resolve(options.staticRoot ?? path.join(packageRoot, 'dist', 'review', 'web'));
  const devMode = options.dev === true;
  const identity = identityFor(data.root, devMode);
  const port = options.port ?? defaultReviewPort;
  const expectedUrl = `http://127.0.0.1:${port}/`;
  if (await probeReviewServer(expectedUrl, identity)) {
    return reusedServer(expectedUrl, devMode);
  }
  const server = await createReviewApp({
    layout,
    staticRoot,
    identity,
    recordingsRoot: options.recordingsRoot,
    executionRoot: options.executionRoot ?? packageRoot,
    dependencies: options.dependencies,
  });
  let address: string;
  try {
    address = await server.listen({ host: '127.0.0.1', port });
  } catch (error) {
    await server.close().catch(() => undefined);
    if (isAddressInUse(error)) {
      if (await probeReviewServer(expectedUrl, identity)) return reusedServer(expectedUrl, devMode);
      throw new Error(
        `复核服务端口 ${port} 已被其他程序或不同数据目录/开发模式的 review 服务占用`,
      );
    }
    throw error;
  }
  const url = publicUrl(`${address.replace(/\/$/, '')}/`, devMode);
  return {
    server,
    url,
    reused: false,
    close: () => server.close(),
  };
}

export function openSystemBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'rundll32' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
