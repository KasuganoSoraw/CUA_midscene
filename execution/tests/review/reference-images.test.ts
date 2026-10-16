import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { uploadReferenceImage } from '../../review/service/reference-images.js';
import { loadReviewTask } from '../../review/service/review-task.js';
import { ReviewConflictError, ReviewReadonlyError, saveReviewTask } from '../../review/service/task-save.js';
import { referenceImageMaxBytes } from '../../review/shared/reference-upload.js';
import { createReviewApp } from '../../review/server/app.js';
import { createTaskFixture } from '../helpers/task-fixture.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-reference-upload-'));
  const projectsRoot = path.join(root, 'projects');
  const taskRoot = await createTaskFixture(projectsRoot);
  const catalog = { userProjectsRoot: projectsRoot };
  const view = await loadReviewTask('browser-demo', 'search-demo', catalog);
  const data = await sharp({ create: { width: 64, height: 40, channels: 3, background: '#366bfc' } }).png().toBuffer();
  return { root, taskRoot, catalog, view, request: { scene: 'browser-demo', task: 'search-demo', catalog, expectedRevision: view.revision, contentType: 'image/png', data } };
}

test('上传图保存为任务内不可变资产，保存绑定后可重新读取且不覆盖录制证据', async () => {
  const setup = await fixture();
  await mkdir(path.join(setup.taskRoot, 'source', 'screenshots'), { recursive: true });
  const recorded = path.join(setup.taskRoot, 'source', 'screenshots', 'recorded.png');
  await writeFile(recorded, setup.request.data);
  const originalYaml = await readFile(path.join(setup.taskRoot, 'task.yaml'));
  const originalJson = await readFile(path.join(setup.taskRoot, 'task.json'));
  const first = await uploadReferenceImage(setup.request);
  assert.match(first.image.url, /^source\/reference-images\/[a-f0-9]{64}\.png$/);
  assert.deepEqual((await uploadReferenceImage(setup.request)).image, first.image);
  assert.deepEqual(await readFile(recorded), setup.request.data);
  assert.deepEqual(await readFile(path.join(setup.taskRoot, 'task.yaml')), originalYaml);
  assert.deepEqual(await readFile(path.join(setup.taskRoot, 'task.json')), originalJson);
  const document = structuredClone(setup.view.document);
  (document.tasks as any[])[1].flow = [{ aiTap: null, locate: { prompt: '点击 reference-image 所示按钮', images: [first.image] } }];
  await saveReviewTask('browser-demo', 'search-demo', setup.catalog, { expectedRevision: setup.view.revision, manifest: setup.view.manifest, document });
  const loaded = await loadReviewTask('browser-demo', 'search-demo', setup.catalog);
  assert.deepEqual(loaded.steps[1].referenceImages, [first.image]);
  assert.equal(loaded.steps[1].evidence, undefined);
  const metadata = await sharp(await readFile(path.join(setup.taskRoot, first.image.url))).metadata();
  assert.equal(metadata.width, 64);
});

test('更换图创建不同资产，已上传和已绑定的图片保持可读', async () => {
  const setup = await fixture();
  const first = await uploadReferenceImage(setup.request);
  const second = await uploadReferenceImage({ ...setup.request,
    data: await sharp({ create: { width: 32, height: 24, channels: 3, background: '#dd3336' } }).jpeg().toBuffer(), contentType: 'image/jpeg' });
  assert.notEqual(first.image.url, second.image.url);
  await Promise.all([readFile(path.join(setup.taskRoot, first.image.url)), readFile(path.join(setup.taskRoot, second.image.url))]);
});

test('WebP 规范化后使用内容哈希命名，同名不同内容不覆盖', async () => {
  const setup = await fixture();
  const data = await sharp(setup.request.data).webp().toBuffer();
  const first = await uploadReferenceImage({ ...setup.request, data, contentType: 'image/webp' });
  assert.match(first.image.url, /^source\/reference-images\/[a-f0-9]{64}\.webp$/);
  const stored = path.join(setup.taskRoot, first.image.url);
  const metadata = await sharp(await readFile(stored)).metadata();
  assert.equal(metadata.format, 'webp');
  await writeFile(stored, 'different content');
  await assert.rejects(uploadReferenceImage({ ...setup.request, data, contentType: 'image/webp' }), /资产内容冲突/);
  assert.equal(await readFile(stored, 'utf8'), 'different content');
});

test('定位参考图目录链接越界时拒绝写入', async () => {
  const setup = await fixture();
  const source = path.join(setup.taskRoot, 'source');
  const outside = path.join(setup.root, 'outside');
  await mkdir(source, { recursive: true });
  await mkdir(outside);
  await symlink(outside, path.join(source, 'reference-images'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(uploadReferenceImage(setup.request), /定位参考图目录越出 source 目录/);
  assert.deepEqual(await readdir(outside), []);
});

test('上传拒绝空图、超限、伪装格式、损坏数据及过大边长', async () => {
  const setup = await fixture();
  for (const data of [Buffer.alloc(0), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])]) {
    await assert.rejects(uploadReferenceImage({ ...setup.request, data }));
  }
  await assert.rejects(uploadReferenceImage({ ...setup.request, data: Buffer.alloc(referenceImageMaxBytes + 1) }), (error: any) => error.statusCode === 413);
  await assert.rejects(uploadReferenceImage({ ...setup.request, contentType: 'image/webp' }), /声明格式不一致/);
  const wide = await sharp({ create: { width: 6001, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(uploadReferenceImage({ ...setup.request, data: wide }), /6000/);
  const pixels = await sharp({ create: { width: 4001, height: 4001, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(uploadReferenceImage({ ...setup.request, data: pixels }), /1600 万像素/);
  await assert.rejects(readdir(path.join(setup.taskRoot, 'source', 'reference-images')), /ENOENT/);
});

test('外部修改和只读 catalog 拒绝上传，目录链接不能越出任务 source', async () => {
  const setup = await fixture();
  await assert.rejects(uploadReferenceImage({ ...setup.request, expectedRevision: 'stale' }), ReviewConflictError);
  await assert.rejects(uploadReferenceImage({ ...setup.request, catalog: { builtinProjectsRoot: setup.catalog.userProjectsRoot } }), ReviewReadonlyError);
  const outside = path.join(setup.root, 'outside');
  await mkdir(outside);
  await symlink(outside, path.join(setup.taskRoot, 'source'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(uploadReferenceImage(setup.request), /source 目录越出任务目录/);
  assert.deepEqual(await readdir(outside), []);
});

test('上传 API 接收二进制图片并保留错误码和大小边界', async () => {
  const setup = await fixture();
  const app = await createReviewApp({
    layout: { catalog: setup.catalog, data: { root: setup.root, projectsRoot: setup.catalog.userProjectsRoot, runsRoot: path.join(setup.root, 'runs'), cacheRoot: path.join(setup.root, 'cache') } },
    staticRoot: path.resolve('dist/review/web'),
    identity: { service: 'test-review', protocolVersion: 3, dataRootKey: setup.root, devMode: false },
  });
  const url = `/api/tasks/browser-demo/search-demo/reference-images?revision=${encodeURIComponent(setup.view.revision)}`;
  try {
    const uploaded = await app.inject({ method: 'POST', url, headers: { 'content-type': 'image/png' }, payload: setup.request.data });
    assert.equal(uploaded.statusCode, 201);
    const image = uploaded.json().image;
    const evidence = await app.inject({ method: 'GET', url: `/api/tasks/browser-demo/search-demo/evidence?path=${encodeURIComponent(image.url)}` });
    assert.equal(evidence.statusCode, 200);
    assert.equal(evidence.headers['content-type'], 'image/png');
    const stale = await app.inject({ method: 'POST', url: url.replace(encodeURIComponent(setup.view.revision), 'stale'), headers: { 'content-type': 'image/png' }, payload: setup.request.data });
    assert.equal(stale.statusCode, 409);
    const invalid = await app.inject({ method: 'POST', url, headers: { 'content-type': 'image/png' }, payload: Buffer.alloc(3 * 1024 * 1024) });
    assert.equal(invalid.statusCode, 400);
    const oversized = await app.inject({ method: 'POST', url, headers: { 'content-type': 'image/png' }, payload: Buffer.alloc(referenceImageMaxBytes + 1) });
    assert.equal(oversized.statusCode, 413);
    const unsupported = await app.inject({ method: 'POST', url, headers: { 'content-type': 'image/svg+xml' }, payload: '<svg/>' });
    assert.equal(unsupported.statusCode, 415);
  } finally { await app.close(); }
});
