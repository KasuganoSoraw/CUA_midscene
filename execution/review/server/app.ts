import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { RuntimeLayout } from '../../cua/contracts/types.js';
import { ReviewConflictError, ReviewReadonlyError } from '../service/task-save.js';
import { registerReviewRoutes } from './routes.js';

export const reviewBodyLimit = 2 * 1024 * 1024;

function errorStatus(error: unknown): number {
  if (error instanceof ReviewConflictError) return 409;
  if (error instanceof ReviewReadonlyError) return 403;
  const statusCode = Number((error as FastifyError | undefined)?.statusCode);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 400;
}

export async function createReviewApp(options: {
  layout: RuntimeLayout;
  staticRoot: string;
}): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: reviewBodyLimit,
    logger: false,
  });

  app.setErrorHandler((error, _request, reply) => {
    reply.code(errorStatus(error)).send({
      error: error instanceof Error ? error.message : String(error),
    });
  });

  await app.register(registerReviewRoutes, { layout: options.layout });
  await app.register(fastifyStatic, {
    root: options.staticRoot,
    redirect: false,
  });

  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return reply.code(404).send({ error: '接口不存在' });
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      return reply.type('text/html; charset=utf-8').sendFile('index.html', {
        cacheControl: false,
      });
    }
    return reply.code(404).send({ error: '页面不存在' });
  });

  await app.ready();
  return app;
}
