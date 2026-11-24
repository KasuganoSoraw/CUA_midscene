import type { FastifyInstance } from 'fastify';
import type { RecordingCardStore } from '../service/recording-cards.js';
import type { RecordingCard, RecordingCardInput, RecordingCardSyncResult } from '../shared/recording-cards.js';
import type { RecorderControl } from '../service/windows-recorder.js';
import type { RecordingCatalog } from '../../cua/recording/recording-catalog.js';

interface SkillCardLinks {
  synchronize?: () => Promise<RecordingCardSyncResult>;
  skillName?: (id: string) => string | undefined;
}

function cardView<T extends RecordingCard>(card: T, links: SkillCardLinks): T {
  return { ...card, skillName: links.skillName?.(card.id) };
}

const textFields = {
  name: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
  description: { type: 'string', maxLength: 2000 },
};
const params = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
};
const body = {
  type: 'object',
  required: ['name', 'description'],
  properties: textFields,
  additionalProperties: false,
};

export function registerRecordingCardRoutes(
  app: FastifyInstance,
  store: RecordingCardStore,
  recorder: RecorderControl,
  recordings: () => Promise<RecordingCatalog>,
  busy: () => boolean = () => false,
  removeCard: (id: string) => Promise<void> = async id => { store.remove(id); },
  links: SkillCardLinks = {},
): void {
  registerCardQueries(app, store, recordings, links);
  registerCardWrites(app, store);
  registerCardVisitsAndDeletion(app, store, recorder, busy, removeCard);
  registerCardRecording(app, store, recorder, busy);
}

function registerCardWrites(
  app: FastifyInstance,
  store: RecordingCardStore,
): void {
  app.post<{ Body: RecordingCardInput }>(
    '/api/recording-cards',
    { schema: { body } },
    async (request, reply) => reply.code(201).send(store.create(request.body)),
  );
  app.patch<{
    Params: { id: string };
    Body: RecordingCardInput & { version: number };
  }>(
    '/api/recording-cards/:id',
    {
      schema: {
        params,
        body: {
          ...body,
          required: ['name', 'description', 'version'],
          properties: {
            ...textFields,
            version: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request) =>
      store.update(request.params.id, request.body, request.body.version),
  );
}

function registerCardVisitsAndDeletion(
  app: FastifyInstance,
  store: RecordingCardStore,
  recorder: RecorderControl,
  busy: () => boolean,
  removeCard: (id: string) => Promise<void>,
): void {
  app.delete<{ Params: { id: string } }>(
    '/api/recording-cards/:id',
    { schema: { params } },
    async (request) => {
      if (recorder.status().phase === 'failed') store.clearSession();
      if (busy()) throw Object.assign(new Error('任务正在处理，不能删除卡片'), { statusCode: 409 });
      await removeCard(request.params.id);
      return { deleted: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/recording-cards/:id/visit',
    { schema: { params } },
    async (request) => {
      store.visit(request.params.id);
      return { visited: true };
    },
  );
}

function registerCardRecording(
  app: FastifyInstance,
  store: RecordingCardStore,
  recorder: RecorderControl,
  busy: () => boolean,
): void {
  let starting = false;
  app.post<{ Params: { id: string }; Body: { displayId: string; language?: string } }>(
    '/api/recording-cards/:id/record',
    {
      schema: {
        params,
        body: {
          type: 'object',
          required: ['displayId'],
          additionalProperties: false,
          properties: {
            displayId: { type: 'string', minLength: 1 },
            language: { type: 'string', enum: ['zh-CN', 'en-US'] },
          },
        },
      },
    },
    async (request) => {
      if (busy() || starting || !['idle', 'failed'].includes(recorder.status().phase)) {
        throw Object.assign(new Error('已有录制正在进行'), { statusCode: 409 });
      }
      store.clearSession();
      store.beginRecording(request.params.id);
      starting = true;
      try {
        return await recorder.start(request.body.displayId, request.body.language);
      } catch (error) {
        store.clearSession();
        throw error;
      } finally {
        starting = false;
      }
    },
  );
}

function registerCardQueries(
  app: FastifyInstance,
  store: RecordingCardStore,
  recordings: () => Promise<RecordingCatalog>,
  links: SkillCardLinks,
): void {
  app.get<{
    Querystring: { query?: string; page?: number; pageSize?: number };
  }>(
    '/api/recording-cards',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', maxLength: 200 },
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request) => {
      const result = store.list(
        request.query.query ?? '',
        request.query.page ?? 1,
        request.query.pageSize ?? 16,
      );
      return { ...result, cards: result.cards.map(card => cardView(card, links)) };
    },
  );
  registerCardLookup(app, store, recordings, links);
}

function registerCardLookup(
  app: FastifyInstance,
  store: RecordingCardStore,
  recordings: () => Promise<RecordingCatalog>,
  links: SkillCardLinks,
): void {
  app.post('/api/recording-cards/sync', async () => {
    store.importRecordings((await recordings()).recordings);
    if (links.synchronize) return links.synchronize();
    return { synced: true, importedSkills: 0, warnings: [] };
  });
  app.get('/api/recording-cards/recent', async () => ({
    cards: store.recent().map(card => cardView(card, links)),
  }));
  app.get<{ Params: { id: string } }>(
    '/api/recording-cards/:id',
    { schema: { params } },
    async (request) => cardView(store.get(request.params.id), links),
  );
}
