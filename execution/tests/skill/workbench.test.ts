import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { createReviewApp } from '../../review/server/app.js';
import { dataPaths } from '../../cua/data-paths.js';
import { createSkillFixture } from '../helpers/skill-fixture.js';
import type { RecorderControl } from '../../review/service/windows-recorder.js';
import { startReviewServer } from '../../review/server/main.js';

async function setup(configured = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skill-review-'));
  const skillsRoot = path.join(root, 'skills');
  const recordingsRoot = path.join(root, 'recordings');
  const directory = path.join(recordingsRoot, 'Recording_1', 'inputs');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'video.mp4'), 'video');
  await writeFile(path.join(directory, 'events.txt'), 'CONFIG: 0,0,1920,1080\n');
  await createSkillFixture(skillsRoot);
  await mkdir(path.join(skillsRoot, 'ordinary'));
  await writeFile(path.join(skillsRoot, 'ordinary', 'SKILL.md'), 'ordinary skill');
  const starts: unknown[] = [];
  const generatedRequests: Array<{ language?: string }> = [];
  const recorder: RecorderControl = {
    status: () => ({ phase: 'idle' }), close: async () => {},
    refreshDisplays: async () => ({ displays: [], revision: 'test' }),
    preview: async () => { throw new Error('no preview'); },
    start: async () => ({ phase: 'idle' }), stop: async () => ({ phase: 'idle' }),
  };
  const app = await createReviewApp({
    layout: { catalog: {}, data: dataPaths(path.join(root, 'data')), skillsRoot: configured ? skillsRoot : undefined },
    staticRoot: root, recordingsRoot, identity: { service: 'test', protocolVersion: 4, dataRootKey: root, devMode: false },
    dependencies: {
      recorder, execution: { status: () => ({ phase: 'idle' }), close: async () => {},
        stop: async () => ({ phase: 'idle' }), start: async request => { starts.push(request); return { phase: 'preparing' }; } },
      createSkill: async options => {
        generatedRequests.push(options);
        assert.equal(options.skillsRoot, skillsRoot);
        await createSkillFixture(options.skillsRoot, 'generated-alarm-query');
        return { created: true, valid: true, skillName: 'generated-alarm-query', goal: '查询', zipPath: path.join(root, 'generated-alarm-query.zip') };
      },
    },
  });
  return { app, root, skillsRoot, starts, generatedRequests,
    close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}

test('Skill Workbench 平铺发现、直接保存与重新加载，不管理普通 Skill', async () => {
  const setupValue = await setup();
  const { app, skillsRoot } = setupValue;
  try {
    const catalog = (await app.inject('/api/skills')).json();
    assert.equal(catalog.skills.length, 1);
    assert.equal(catalog.skills[0].skillName, 'alarm-query');
    const view = (await app.inject('/api/skills/alarm-query')).json();
    const draft = { manifest: view.manifest, document: view.document };
    draft.document.tasks[0].flow = [{ aiTap: '点击新的查询按钮' }];
    const saved = await app.inject({ method: 'PUT', url: '/api/skills/alarm-query', payload: { ...draft, expectedRevision: view.revision } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal((await app.inject('/api/skills/alarm-query')).json().document.tasks[0].flow[0].aiTap, '点击新的查询按钮');
    assert.match(await readFile(path.join(skillsRoot, 'alarm-query', 'task.yaml'), 'utf8'), /新的查询按钮/);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/skills/alarm-query', payload: { ...draft, expectedRevision: view.revision } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/skills/ordinary' })).statusCode, 400);
    assert.equal(await readFile(path.join(skillsRoot, 'ordinary', 'SKILL.md'), 'utf8'), 'ordinary skill');
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/skills/alarm-query' })).statusCode, 200);
  } finally { await setupValue.close(); }
});

test('Skill 参考图上传、绑定和证据路径均使用正式目录，冲突时拒绝', async () => {
  const setupValue = await setup();
  const { app, skillsRoot } = setupValue;
  try {
    const view = (await app.inject('/api/skills/alarm-query')).json();
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
    const response = await app.inject({ method: 'POST', url: `/api/skills/alarm-query/reference-images?revision=${encodeURIComponent(view.revision)}`, headers: { 'content-type': 'image/png' }, payload: image });
    assert.equal(response.statusCode, 201, response.body);
    const reference = response.json().image;
    assert.ok((await readFile(path.join(skillsRoot, 'alarm-query', reference.url))).length);
    view.document.tasks[0].flow = [{ aiTap: null, locate: { prompt: '查询按钮', images: [reference] } }];
    const save = await app.inject({ method: 'PUT', url: '/api/skills/alarm-query', payload: { manifest: view.manifest, document: view.document, expectedRevision: view.revision } });
    assert.equal(save.statusCode, 200, save.body);
    assert.equal((await app.inject(`/api/skills/alarm-query/evidence?path=${encodeURIComponent(reference.url)}`)).statusCode, 200);
    assert.equal((await app.inject('/api/skills/alarm-query/evidence?path=../ordinary/SKILL.md')).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: `/api/skills/alarm-query/reference-images?revision=${encodeURIComponent(view.revision)}`, headers: { 'content-type': 'image/png' }, payload: image })).statusCode, 409);
  } finally { await setupValue.close(); }
});

test('录制生成请求无需 scene/task/goal，完成后返回正式 Skill 身份', async () => {
  const setupValue = await setup();
  try {
    const response = await setupValue.app.inject({ method: 'POST', url: '/api/recordings/Recording_1/skills', payload: {} });
    assert.equal(response.statusCode, 202, response.body);
    assert.equal(response.json().request.language, 'zh-CN');
    assert.equal(setupValue.generatedRequests[0].language, 'zh-CN');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const status = (await setupValue.app.inject('/api/skill-generation')).json();
      if (status.phase !== 'running') {
        assert.equal(status.phase, 'succeeded', JSON.stringify(status));
        assert.equal(status.result.skillName, 'generated-alarm-query');
        assert.equal((await setupValue.app.inject('/api/skills/generated-alarm-query')).statusCode, 200);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('generation did not finish');
  } finally { await setupValue.close(); }
});

test('录制生成接受英文语言并拒绝不支持的值', async () => {
  const setupValue = await setup();
  try {
    const invalid = await setupValue.app.inject({
      method: 'POST', url: '/api/recordings/Recording_1/skills', payload: { language: 'fr-FR' },
    });
    assert.equal(invalid.statusCode, 400);
    const response = await setupValue.app.inject({
      method: 'POST', url: '/api/recordings/Recording_1/skills', payload: { language: 'en-US' },
    });
    assert.equal(response.statusCode, 202, response.body);
    assert.equal(response.json().request.language, 'en-US');
    assert.equal(setupValue.generatedRequests[0].language, 'en-US');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const status = (await setupValue.app.inject('/api/skill-generation')).json();
      if (status.phase !== 'running') {
        assert.equal(status.phase, 'succeeded', JSON.stringify(status));
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal((await setupValue.app.inject('/api/skill-generation')).json().phase, 'succeeded');
  } finally { await setupValue.close(); }
});

test('未配置 Skill 根时给出配置提示，生成失败不回退；调试默认 guided', async () => {
  const missing = await setup(false);
  try {
    const catalog = (await missing.app.inject('/api/skills')).json();
    assert.equal(catalog.configured, false);
    assert.match(catalog.error, /CUA_SKILLS_ROOT/);
    assert.equal((await missing.app.inject({ method: 'POST', url: '/api/recordings/Recording_1/skills', payload: {} })).statusCode, 400);
  } finally { await missing.close(); }
  const configured = await setup();
  try {
    const response = await configured.app.inject({ method: 'POST', url: '/api/execution/start', payload: { skillName: 'alarm-query', inputs: {} } });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(configured.starts, [{ skillName: 'alarm-query', inputs: {}, mode: 'act' }]);
  } finally { await configured.close(); }
});

test('相同数据根但不同 Skill 根不会复用 Review Server', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skill-identity-'));
  const previous = process.env.CUA_SKILLS_ROOT;
  let server: Awaited<ReturnType<typeof startReviewServer>> | undefined;
  try {
    process.env.CUA_SKILLS_ROOT = path.join(root, 'skills-a');
    server = await startReviewServer({ dataRoot: path.join(root, 'data'), port: 0 });
    const port = Number(new URL(server.url).port);
    const reused = await startReviewServer({ dataRoot: path.join(root, 'data'), port });
    assert.equal(reused.reused, true);
    process.env.CUA_SKILLS_ROOT = path.join(root, 'skills-b');
    await assert.rejects(startReviewServer({ dataRoot: path.join(root, 'data'), port }), /占用/);
  } finally {
    await server?.close();
    if (previous === undefined) delete process.env.CUA_SKILLS_ROOT; else process.env.CUA_SKILLS_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
