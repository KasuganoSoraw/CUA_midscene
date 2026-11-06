import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { RecordingWorkflow } from '../service/recording-workflow.js';
import { listSkills, readSkill, validateSkillDraft } from '../../cua/skills/assets.js';
import { safeSkillFile } from '../../cua/skills/paths.js';
import { loadReviewSkill, saveReviewSkill } from '../service/review-skill.js';
import { applyReviewMutation } from '../service/task-mutations.js';
import { uploadSkillReferenceImage } from '../service/reference-images.js';
import { referenceImageMaxBytes } from '../shared/reference-upload.js';
import type { GenerationLanguage, ReviewMutation, ReviewTaskDraft, SaveReviewTaskRequest } from '../shared/types.js';
import type { SkillTaskManifest } from '../../cua/contracts/types.js';

const params = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } };
const draft = {
  type: 'object',
  required: ['manifest', 'document'],
  additionalProperties: false,
  properties: { manifest: { type: 'object' }, document: { type: 'object' } },
};
export function registerWorkflowRoutes(app: FastifyInstance, workflow: RecordingWorkflow): void {
  app.get<{ Params: { id: string } }>('/api/recording-cards/:id/workflow', { schema: { params } }, (request) =>
    workflow.status(request.params.id),
  );
  app.post<{ Params: { id: string }; Body: { language: GenerationLanguage } }>(
    '/api/recording-cards/:id/analyze',
    {
      schema: {
        params,
        body: {
          type: 'object',
          required: ['language'],
          additionalProperties: false,
          properties: { language: { enum: ['zh-CN', 'en-US'] } },
        },
      },
    },
    (request) => workflow.analyze(request.params.id, request.body.language),
  );
  app.post<{ Params: { id: string } }>('/api/recording-cards/:id/publish', { schema: { params } }, (request) =>
    workflow.publish(request.params.id),
  );
  app.post<{ Params: { id: string } }>('/api/recording-cards/:id/stop', { schema: { params } }, (request) =>
    workflow.stop(request.params.id),
  );
  app.post<{ Params: { id: string } }>('/api/recording-cards/:id/result/open-folder', { schema: { params } }, async request => {
    const origin = request.headers.origin;
    if (request.headers['sec-fetch-site'] === 'cross-site'
      || (origin !== undefined && origin !== `http://${request.headers.host}`)) {
      throw Object.assign(new Error('不允许从其他站点打开安装目录'), { statusCode: 403 });
    }
    return workflow.openInstallDirectory(request.params.id);
  });
  registerDraftReads(app, workflow);
  registerDraftWrites(app, workflow);
}
function registerDraftReads(app: FastifyInstance, workflow: RecordingWorkflow): void {
  app.get<{ Params: { id: string } }>(
    '/api/recording-cards/:id/draft/catalog',
    { schema: { params } },
    async (request) => {
      const status = workflow.draft(request.params.id);
      return { configured: true, envName: 'CUA_SKILLS_ROOT', skills: await listSkills(status.draftRoot) };
    },
  );
  app.get<{ Params: { id: string } }>('/api/recording-cards/:id/draft', { schema: { params } }, (request) => {
    const status = workflow.draft(request.params.id);
    return loadReviewSkill(status.draftRoot, status.skillName);
  });
  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    '/api/recording-cards/:id/draft/evidence',
    {
      schema: { params, querystring: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } },
    },
    async (request, reply) => {
      const status = workflow.draft(request.params.id);
      const asset = await readSkill(status.draftRoot, status.skillName);
      if (!request.query.path.replaceAll('\\', '/').startsWith('source/')) throw new Error('证据必须位于 source/');
      const file = await safeSkillFile(asset.root, request.query.path);
      const types: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
      };
      const type = types[file.split('.').pop()?.toLowerCase() ?? ''];
      if (!type) throw new Error('仅支持图片证据');
      return reply
        .type(type)
        .header('x-content-type-options', 'nosniff')
        .send(await readFile(file));
    },
  );
  app.get<{ Params: { id: string } }>('/api/recording-cards/:id/result', { schema: { params } }, request => workflow.result(request.params.id));
}
function registerDraftWrites(app: FastifyInstance, workflow: RecordingWorkflow): void {
  app.put<{ Params: { id: string }; Body: SaveReviewTaskRequest<SkillTaskManifest> }>(
    '/api/recording-cards/:id/draft',
    {
      schema: {
        params,
        body: {
          ...draft,
          required: ['manifest', 'document', 'expectedRevision'],
          properties: { ...draft.properties, expectedRevision: { type: 'string' } },
        },
      },
    },
    (request) => {
      const status = workflow.draft(request.params.id, true);
      return saveReviewSkill(status.draftRoot, status.skillName, request.body);
    },
  );
  app.post<{ Params: { id: string }; Body: { draft: ReviewTaskDraft<SkillTaskManifest>; mutation: ReviewMutation } }>(
    '/api/recording-cards/:id/draft/mutate',
    {
      schema: {
        params,
        body: { type: 'object', required: ['draft', 'mutation'], properties: { draft, mutation: { type: 'object' } } },
      },
    },
    async (request) => {
      const status = workflow.draft(request.params.id, true);
      const asset = await readSkill(status.draftRoot, status.skillName);
      const result = applyReviewMutation(request.body.draft, request.body.mutation);
      await validateSkillDraft(asset, result.draft.manifest, result.draft.document);
      return result;
    },
  );
  registerDraftUpload(app, workflow);
}
function registerDraftUpload(app: FastifyInstance, workflow: RecordingWorkflow): void {
  app.post<{ Params: { id: string }; Querystring: { revision: string } }>(
    '/api/recording-cards/:id/draft/reference-images',
    {
      bodyLimit: referenceImageMaxBytes,
      schema: {
        params,
        querystring: { type: 'object', required: ['revision'], properties: { revision: { type: 'string' } } },
      },
    },
    (request) => {
      const status = workflow.draft(request.params.id, true);
      return uploadSkillReferenceImage({
        skillsRoot: status.draftRoot,
        skillName: status.skillName,
        expectedRevision: request.query.revision,
        data: request.body as Buffer,
        contentType: String(request.headers['content-type']),
      });
    },
  );
}
