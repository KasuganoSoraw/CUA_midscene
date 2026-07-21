import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { JsonObject, RuntimeLayout } from '../../cua/contracts/types.js';
import { listScenes, listTasks, requireIdentifier } from '../../cua/task/tasks.js';
import type { ReviewMutation, ReviewTaskDraft, SaveReviewTaskRequest } from '../shared/types.js';
import { applyReviewMutation } from '../service/task-mutations.js';
import { loadReviewTask, resolveReviewTaskRoot } from '../service/review-task.js';
import {
  ReviewConflictError,
  ReviewReadonlyError,
  saveReviewTask,
  validateReviewDraft,
} from '../service/task-save.js';

const jsonLimit = 2 * 1024 * 1024;

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function sendBuffer(response: ServerResponse, status: number, value: Buffer, contentType: string): void {
  response.writeHead(status, { 'content-type': contentType, 'content-length': value.length });
  response.end(value);
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > jsonLimit) throw new Error('请求体过大');
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON 请求体必须是对象');
  return parsed as JsonObject;
}

function contentType(sourcePath: string): string {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.json': 'application/json; charset=utf-8',
  } as Record<string, string>)[path.extname(sourcePath).toLowerCase()] ?? 'application/octet-stream';
}

function inside(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function serveStatic(response: ServerResponse, staticRoot: string, pathname: string): Promise<void> {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let sourcePath = path.resolve(staticRoot, requested);
  if (!inside(staticRoot, sourcePath)) throw Object.assign(new Error('静态资源路径越界'), { statusCode: 404 });
  try {
    if (!(await stat(sourcePath)).isFile()) throw new Error('not a file');
  } catch {
    sourcePath = path.join(staticRoot, 'index.html');
  }
  sendBuffer(response, 200, await readFile(sourcePath), contentType(sourcePath));
}

function routeParts(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map((item) => decodeURIComponent(item));
}

async function evidenceFile(
  scene: string,
  task: string,
  reference: string,
  layout: RuntimeLayout,
): Promise<{ body: Buffer; type: string }> {
  const resolved = await resolveReviewTaskRoot(scene, task, layout.catalog);
  const sourceRoot = path.join(resolved.taskRoot, 'source');
  const target = path.resolve(resolved.taskRoot, reference);
  if (!inside(sourceRoot, target)) throw Object.assign(new Error('证据路径越出 source 目录'), { statusCode: 404 });
  return { body: await readFile(target), type: contentType(target) };
}

export function createReviewApp(options: { layout: RuntimeLayout; staticRoot: string }) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith('/api/')) {
        await serveStatic(response, options.staticRoot, url.pathname);
        return;
      }
      const parts = routeParts(url.pathname);
      if (request.method === 'GET' && parts.join('/') === 'api/scenes') {
        sendJson(response, 200, { scenes: await listScenes(options.layout.catalog) });
        return;
      }
      if (request.method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'scenes' && parts[3] === 'tasks') {
        const scene = requireIdentifier(parts[2], 'scene');
        sendJson(response, 200, { scene, tasks: await listTasks(scene, options.layout.catalog) });
        return;
      }
      if (parts.length >= 4 && parts[0] === 'api' && parts[1] === 'tasks') {
        const scene = requireIdentifier(parts[2], 'scene');
        const task = requireIdentifier(parts[3], 'task');
        if (request.method === 'GET' && parts.length === 4) {
          sendJson(response, 200, await loadReviewTask(scene, task, options.layout.catalog));
          return;
        }
        if (request.method === 'GET' && parts[4] === 'evidence') {
          const reference = url.searchParams.get('path');
          if (!reference) throw new Error('缺少证据 path');
          const file = await evidenceFile(scene, task, reference, options.layout);
          sendBuffer(response, 200, file.body, file.type);
          return;
        }
        if (request.method === 'POST' && parts[4] === 'mutate') {
          const body = await readJson(request);
          const result = applyReviewMutation(body.draft as ReviewTaskDraft, body.mutation as ReviewMutation);
          await validateReviewDraft(result.draft);
          sendJson(response, 200, result);
          return;
        }
        if (request.method === 'POST' && parts[4] === 'validate') {
          const body = await readJson(request);
          await validateReviewDraft(body as unknown as ReviewTaskDraft);
          sendJson(response, 200, { valid: true });
          return;
        }
        if (request.method === 'PUT' && parts.length === 4) {
          const body = await readJson(request);
          sendJson(response, 200, await saveReviewTask(scene, task, options.layout.catalog, body as unknown as SaveReviewTaskRequest));
          return;
        }
      }
      sendJson(response, 404, { error: '接口不存在' });
    } catch (error) {
      const status = error instanceof ReviewConflictError
        ? 409
        : error instanceof ReviewReadonlyError
          ? 403
          : Number((error as { statusCode?: number }).statusCode) || 400;
      sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
