import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { RuntimeLayout, SkillTaskManifest } from '../../cua/contracts/types.js';
import { requireSkillsRoot } from '../../cua/data-paths.js';
import { listSkills, readSkill, validateSkillDraft } from '../../cua/skills/assets.js';
import { createSkillFromRecording } from '../../cua/skills/create.js';
import { requireSkillName, safeSkillFile } from '../../cua/skills/paths.js';
import { describeRecording, resolveRecordingDirectory } from '../../cua/recording/recording-catalog.js';
import { RecordingGenerationManager } from '../service/recording-generation.js';
import { deleteReviewSkill, loadReviewSkill, saveReviewSkill } from '../service/review-skill.js';
import { applyReviewMutation } from '../service/task-mutations.js';
import { uploadSkillReferenceImage } from '../service/reference-images.js';
import { referenceImageMaxBytes } from '../shared/reference-upload.js';
import type { CreateRecordingSkillResult, ReviewMutation, ReviewTaskDraft, SaveReviewTaskRequest, TaskExecutionStatus } from '../shared/types.js';

interface SkillParams { skillName: string }
interface Options {
  layout: RuntimeLayout;
  recordingsRoot?: string;
  executionRoot?: string;
  create?: typeof createSkillFromRecording;
  executionStatus(): TaskExecutionStatus;
}

const skillParams = {
  type: 'object', required: ['skillName'], additionalProperties: false,
  properties: { skillName: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', maxLength: 64 } },
} as const;
const draftProperties = {
  manifest: { type: 'object', additionalProperties: true }, document: { type: 'object', additionalProperties: true },
} as const;
const draftSchema = { type: 'object', required: ['manifest', 'document'], properties: draftProperties, additionalProperties: false } as const;

function registerSkillReads(app: FastifyInstance, options: Options): void {
  app.get('/api/skills', async () => {
    if (!options.layout.skillsRoot) return {
      configured: false, envName: 'CUA_SKILLS_ROOT', skills: [], error: '请配置 CUA_SKILLS_ROOT：正式 Skill 的绝对根目录',
    };
    return { configured: true, envName: 'CUA_SKILLS_ROOT', skills: await listSkills(options.layout.skillsRoot) };
  });
  app.get<{ Params: SkillParams }>('/api/skills/:skillName', { schema: { params: skillParams } }, request =>
    loadReviewSkill(requireSkillsRoot(options.layout), request.params.skillName));
  app.get<{ Params: SkillParams; Querystring: { path: string } }>('/api/skills/:skillName/evidence', {
    schema: { params: skillParams, querystring: { type: 'object', required: ['path'], properties: { path: { type: 'string', minLength: 1 } }, additionalProperties: false } },
  }, async (request, reply) => {
    const asset = await readSkill(requireSkillsRoot(options.layout), request.params.skillName);
    if (!request.query.path.replaceAll('\\', '/').startsWith('source/')) throw new Error('证据必须位于 Skill source/');
    const file = await safeSkillFile(asset.root, request.query.path);
    const extension = file.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
    if (!extension || !types[extension]) throw new Error('证据接口仅提供图片');
    return reply.type(types[extension]).header('x-content-type-options', 'nosniff').send(await readFile(file));
  });
}

function registerSkillEdits(app: FastifyInstance, options: Options): void {
  app.put<{ Params: SkillParams; Body: SaveReviewTaskRequest<SkillTaskManifest> }>('/api/skills/:skillName', {
    schema: { params: skillParams, body: {
      ...draftSchema, required: ['manifest', 'document', 'expectedRevision'],
      properties: { ...draftProperties, expectedRevision: { type: 'string', minLength: 1 } },
    } },
  }, request => saveReviewSkill(requireSkillsRoot(options.layout), request.params.skillName, request.body));
  app.post<{ Params: SkillParams; Body: { draft: ReviewTaskDraft<SkillTaskManifest>; mutation: ReviewMutation } }>('/api/skills/:skillName/mutate', {
    schema: { params: skillParams, body: { type: 'object', required: ['draft', 'mutation'], additionalProperties: false,
      properties: { draft: draftSchema, mutation: { type: 'object', additionalProperties: true } } } },
  }, async request => {
    const asset = await readSkill(requireSkillsRoot(options.layout), request.params.skillName);
    await validateSkillDraft(asset, request.body.draft.manifest, request.body.draft.document);
    const result = applyReviewMutation(request.body.draft, request.body.mutation);
    await validateSkillDraft(asset, result.draft.manifest, result.draft.document);
    return result;
  });
  app.post<{ Params: SkillParams; Body: ReviewTaskDraft<SkillTaskManifest> }>('/api/skills/:skillName/validate', {
    schema: { params: skillParams, body: draftSchema },
  }, async request => {
    const asset = await readSkill(requireSkillsRoot(options.layout), request.params.skillName);
    await validateSkillDraft(asset, request.body.manifest, request.body.document);
    return { valid: true };
  });
}

function registerSkillAssets(app: FastifyInstance, options: Options): void {
  app.delete<{ Params: SkillParams }>('/api/skills/:skillName', { schema: { params: skillParams } }, request => {
    const active = options.executionStatus();
    if (active.skillName === request.params.skillName && ['preparing', 'running', 'stopping'].includes(active.phase)) {
      throw Object.assign(new Error('Skill 正在执行，暂时不能删除'), { statusCode: 409 });
    }
    return deleteReviewSkill(requireSkillsRoot(options.layout), request.params.skillName);
  });
  app.post<{ Params: SkillParams; Querystring: { revision: string }; Body: Buffer }>('/api/skills/:skillName/reference-images', {
    bodyLimit: referenceImageMaxBytes, schema: { params: skillParams, querystring: {
      type: 'object', required: ['revision'], properties: { revision: { type: 'string', minLength: 1 } }, additionalProperties: false,
    } },
  }, async (request, reply) => {
    const result = await uploadSkillReferenceImage({
      skillsRoot: requireSkillsRoot(options.layout), skillName: requireSkillName(request.params.skillName),
      expectedRevision: request.query.revision, data: request.body,
      contentType: String(request.headers['content-type'] ?? '').split(';')[0].trim(),
    });
    return reply.code(201).send(result);
  });
}

export function registerSkillRoutes(app: FastifyInstance, options: Options): RecordingGenerationManager<Record<string, never>, CreateRecordingSkillResult> {
  registerSkillReads(app, options);
  registerSkillEdits(app, options);
  registerSkillAssets(app, options);
  const generation = new RecordingGenerationManager<Record<string, never>, CreateRecordingSkillResult>();
  app.get('/api/skill-generation', async () => generation.status());
  app.post<{ Params: { recording: string } }>('/api/recordings/:recording/skills', {
    schema: {
      params: { type: 'object', required: ['recording'], properties: { recording: { type: 'string', minLength: 1 } } },
      body: { type: 'object', additionalProperties: false },
    },
  }, async (request, reply) => {
    const skillsRoot = requireSkillsRoot(options.layout);
    const recordingOptions = { recordingsRoot: options.recordingsRoot, executionRoot: options.executionRoot };
    const entry = await describeRecording(request.params.recording, recordingOptions);
    if (!entry.ready) throw new Error(`录制不可生成：${entry.errors.join('\n')}`);
    const recording = await resolveRecordingDirectory(entry.id, recordingOptions);
    const status = generation.start(entry.id, {}, () => (options.create ?? createSkillFromRecording)({
      recording, skillsRoot, executionRoot: options.executionRoot,
    }));
    return reply.code(202).send(status);
  });
  return generation;
}
