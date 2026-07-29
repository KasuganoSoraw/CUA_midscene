import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { packageRoot } from '../../cua/package-root.js';
import { requireDataPaths, resolveRuntimeLayout } from '../../cua/task/data-paths.js';
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

interface ReviewServerIdentity {
  service: string;
  protocolVersion: number;
  dataRootKey: string;
}

export function reviewDataRootKey(root: string): string {
  const normalized = path.normalize(path.resolve(root));
  const stable = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  return createHash('sha256').update(stable).digest('hex');
}

function identityFor(dataRoot: string): ReviewServerIdentity {
  return {
    service: reviewServiceName,
    protocolVersion: reviewProtocolVersion,
    dataRootKey: reviewDataRootKey(dataRoot),
  };
}

function identityMatches(actual: unknown, expected: ReviewServerIdentity): boolean {
  if (!actual || typeof actual !== 'object') return false;
  const identity = actual as Partial<ReviewServerIdentity>;
  return identity.service === expected.service
    && identity.protocolVersion === expected.protocolVersion
    && identity.dataRootKey === expected.dataRootKey;
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

function reusedServer(url: string): StartedReviewServer {
  return {
    url,
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
  dependencies?: ReviewRouteDependencies;
} = {}): Promise<StartedReviewServer> {
  const layout = await resolveRuntimeLayout(options.dataRoot);
  const data = await requireDataPaths(layout);
  const staticRoot = path.resolve(options.staticRoot ?? path.join(packageRoot, 'dist', 'review', 'web'));
  const identity = identityFor(data.root);
  const defaultPort = options.port === undefined;
  const port = options.port ?? defaultReviewPort;
  const expectedUrl = `http://127.0.0.1:${port}/`;
  if (defaultPort && await probeReviewServer(expectedUrl, identity)) {
    return reusedServer(expectedUrl);
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
    if (defaultPort && isAddressInUse(error)) {
      if (await probeReviewServer(expectedUrl, identity)) return reusedServer(expectedUrl);
      throw new Error(
        `复核服务端口 ${defaultReviewPort} 已被其他程序或不同数据目录的 review 服务占用`,
      );
    }
    throw error;
  }
  const url = `${address.replace(/\/$/, '')}/`;
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
