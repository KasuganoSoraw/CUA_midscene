import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importSkillArchive, resolveSkillImportEndpoint, skillImportUrl, SkillImportError } from '../../cua/skills/host-import.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-import-http-'));
  const zipPath = path.join(root, 'alarm-query.zip');
  await writeFile(zipPath, 'ZIP fixture');
  const url = skillImportUrl('alarm-query', new URL('http://127.0.0.1:49123/api/gdeclaw/skills/import'));
  return { root, options: { url, zipPath, skillName: 'alarm-query' }, close: () => rm(root, { recursive: true, force: true }) };
}

test('导入使用动态 URL、查询参数与原生 multipart，不发送额外鉴权字段', async () => {
  const value = await fixture();
  try {
    let calls = 0;
    const fetchMock: typeof fetch = async (input, init) => {
      calls += 1;
      const url = new URL(String(input));
      assert.equal(url.port, '49123');
      assert.equal(url.pathname, '/api/gdeclaw/skills/import');
      assert.deepEqual([...url.searchParams], [['enable', 'true'], ['target_name', 'alarm-query']]);
      assert.equal(init?.method, 'POST');
      assert.equal(init?.headers, undefined);
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.body instanceof FormData);
      assert.deepEqual([...init.body.keys()], ['file']);
      const file = init.body.get('file') as File;
      assert.equal(file.name, 'alarm-query.zip');
      assert.equal(file.type, 'application/zip');
      assert.equal(await file.text(), 'ZIP fixture');
      return Response.json({ success: true });
    };
    await importSkillArchive(value.options, { fetch: fetchMock });
    assert.equal(calls, 1);
    assert.equal(await readFile(value.options.zipPath, 'utf8'), 'ZIP fixture');
  } finally { await value.close(); }
});

test('宿主地址由进程及本地配置解析，拒绝缺失地址或非法协议', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-import-config-'));
  const previous = process.env.GDECLAW_API_BASE_URL;
  const executionRoot = path.join(root, 'execution');
  try {
    process.env.GDECLAW_API_BASE_URL = '';
    await assert.rejects(resolveSkillImportEndpoint(executionRoot), /GDECLAW_API_BASE_URL/);
    delete process.env.GDECLAW_API_BASE_URL;
    await writeFile(path.join(root, '.env'), 'GDECLAW_API_BASE_URL=http://127.0.0.1:45001/prefix?unused=true\n');
    assert.equal((await resolveSkillImportEndpoint(executionRoot)).port, '45001');
    await writeFile(path.join(root, '.env.local'), 'GDECLAW_API_BASE_URL=http://localhost:45002/prefix\n');
    assert.equal((await resolveSkillImportEndpoint(executionRoot)).port, '45002');
    process.env.GDECLAW_API_BASE_URL = 'http://localhost:45003/base';
    const endpoint = await resolveSkillImportEndpoint(executionRoot);
    assert.equal(endpoint.pathname, '/api/gdeclaw/skills/import');
    assert.equal(endpoint.port, '45003');
    assert.equal(skillImportUrl('alarm-query', endpoint).searchParams.get('target_name'), 'alarm-query');
    for (const invalid of ['not-a-url', 'file:///tmp/skill', 'https://user:secret@example.test']) {
      process.env.GDECLAW_API_BASE_URL = invalid;
      await assert.rejects(resolveSkillImportEndpoint(executionRoot), /GDECLAW_API_BASE_URL/);
    }
  } finally {
    if (previous === undefined) delete process.env.GDECLAW_API_BASE_URL; else process.env.GDECLAW_API_BASE_URL = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('HTTP 400、409、500 与错误响应不会报告成功，也不会自动重试', async () => {
  const value = await fixture();
  try {
    for (const status of [400, 409, 500]) {
      let calls = 0;
      await assert.rejects(importSkillArchive(value.options, { fetch: async () => {
        calls += 1;
        return Response.json({ detail: 'host rejected' }, { status });
      } }), error => error instanceof SkillImportError && error.remoteStatus === status && error.message.includes('host rejected'));
      assert.equal(calls, 1);
    }
    for (const response of [new Response('invalid JSON'), Response.json([]), Response.json({ success: false }), Response.json({ error: 'failed' }), new Response('failure', { status: 500 })]) {
      await assert.rejects(importSkillArchive(value.options, { fetch: async () => response }), SkillImportError);
    }
    assert.equal(await readFile(value.options.zipPath, 'utf8'), 'ZIP fixture');
  } finally { await value.close(); }
});

test('网络错误或超时明确说明结果不确定，保留 ZIP 并且不换名重传', async () => {
  const value = await fixture();
  try {
    let calls = 0;
    await assert.rejects(importSkillArchive(value.options, { fetch: async () => {
      calls += 1;
      throw new TypeError('network unavailable');
    } }), /结果不确定/);
    assert.equal(calls, 1);
    const fetchMock: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('test deadline')), 1000);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal?.reason); }, { once: true });
    });
    await assert.rejects(importSkillArchive(value.options, { fetch: fetchMock, timeoutMs: 5 }), /请求超时.*结果不确定/);
    assert.equal(await readFile(value.options.zipPath, 'utf8'), 'ZIP fixture');
  } finally { await value.close(); }
});
