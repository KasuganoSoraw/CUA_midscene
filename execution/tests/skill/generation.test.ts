import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSkillFromRecording, skillMarkdown } from '../../cua/skills/create.js';
import { readSkill } from '../../cua/skills/assets.js';
import { requireSkillsRoot, resolveRuntimeLayout, resolveSkillsRoot } from '../../cua/data-paths.js';
import { installImportedFixture, recordingSkillFixture } from '../helpers/skill-import-fixture.js';

test('生成的 Skill 说明按 task.json 当前参数委派，并提供对象形式的绑定示例', () => {
  const metadata = { name: 'alarm-query', description: '查询告警', goal: '展示告警结果' };
  const chinese = skillMarkdown(metadata);
  const english = skillMarkdown({ ...metadata, description: 'Search alarms', goal: 'Show alarms' }, 'en-US');
  assert.match(chinese, /每次执行前先读取同目录的 `task\.json`/);
  assert.match(chinese, /默认值为空且用户未提供时，先向用户询问/);
  assert.match(chinese, /不是序列化后的 JSON 字符串/);
  assert.match(english, /Before each execution, read the adjacent `task\.json`/);
  assert.match(english, /If a default is empty and the user has not supplied a value, ask the user/);
  assert.doesNotMatch(english, /[\u3400-\u9fff]/u);
  for (const markdown of [chinese, english]) {
    const example = /```json\n([\s\S]*?)\n```/.exec(markdown);
    assert.ok(example);
    const binding = JSON.parse(example[1]);
    assert.equal(binding.execution.skillName, 'alarm-query');
    assert.equal(binding.execution.strategy, 'guided');
    assert.equal(typeof binding.execution.inputs, 'object');
    assert.equal(Object.keys(binding.execution.inputs).length, 1);
  }
});

test('Skill 根配置遵循进程、env.local、env 顺序且不回退到 projects', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skill-env-'));
  const executionRoot = path.join(root, 'execution');
  const previous = process.env.CUA_SKILLS_ROOT;
  await mkdir(executionRoot);
  const envRoot = path.join(root, 'env-skills');
  const localRoot = path.join(root, 'local-skills');
  try {
    delete process.env.CUA_SKILLS_ROOT;
    await writeFile(path.join(root, '.env'), `CUA_SKILLS_ROOT=${envRoot}\n`);
    assert.equal(await resolveSkillsRoot(executionRoot), envRoot);
    await writeFile(path.join(root, '.env.local'), `CUA_SKILLS_ROOT=${localRoot}\n`);
    assert.equal(await resolveSkillsRoot(executionRoot), localRoot);
    process.env.CUA_SKILLS_ROOT = path.join(root, 'process-skills');
    assert.equal((await resolveRuntimeLayout(undefined, { executionRoot })).skillsRoot, process.env.CUA_SKILLS_ROOT);
    process.env.CUA_SKILLS_ROOT = '';
    assert.throws(() => requireSkillsRoot({ skillsRoot: undefined }), /CUA_SKILLS_ROOT/);
    assert.equal(await resolveSkillsRoot(executionRoot), undefined);
    process.env.CUA_SKILLS_ROOT = 'relative';
    await assert.rejects(resolveSkillsRoot(executionRoot), /绝对路径/);
    const actual = path.join(root, 'actual');
    await mkdir(actual);
    await symlink(actual, path.join(root, 'alias'), 'junction');
    process.env.CUA_SKILLS_ROOT = path.join(root, 'alias', 'new-skills');
    const normalized = await resolveSkillsRoot(executionRoot);
    await mkdir(process.env.CUA_SKILLS_ROOT);
    assert.equal(normalized, await realpath(process.env.CUA_SKILLS_ROOT));
    assert.equal(normalized, await resolveSkillsRoot(executionRoot));
  } finally {
    if (previous === undefined) delete process.env.CUA_SKILLS_ROOT; else process.env.CUA_SKILLS_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('录制生成在独立目录打包，经宿主导入后读取正式资产，不直接安装', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skill-generation-'));
  try {
    const options = await recordingSkillFixture(root);
    let parserCalls = 0;
    const result = await createSkillFromRecording(options, {
      runRecorder: async () => { parserCalls += 1; },
      fetch: async (_url, init) => {
        await assert.rejects(access(options.skillsRoot));
        await installImportedFixture(init!.body as FormData, options.skillsRoot);
        return Response.json({ success: true });
      },
    });
    assert.equal(parserCalls, 1);
    assert.equal(result.skillName, 'network-alarm-search');
    const asset = await readSkill(options.skillsRoot, result.skillName);
    assert.equal(asset.manifest.goal, '查询并展示告警结果');
    assert.match(asset.skill.description, /CUA 子 Agent/);
    assert.ok((await readFile(result.zipPath)).length);
    assert.equal(path.relative(options.exportRoot, result.zipPath).startsWith('..'), false);
    assert.equal(await readFile(path.join(options.recording, 'inputs', 'events.txt'), 'utf8'), 'original events');
    assert.deepEqual(await readdir(options.skillsRoot), ['network-alarm-search']);
    assert.equal((await readdir(root)).includes('projects'), false);
    await assert.rejects(createSkillFromRecording({ ...options, skillsRoot: '' }), /CUA_SKILLS_ROOT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('英文生成语言贯穿解析器、步骤和新 Skill 资产', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skill-english-'));
  try {
    const options = await recordingSkillFixture(root);
    const tracePath = path.join(options.recording, 'Recording_1_trace.json');
    const trace = JSON.parse(await readFile(tracePath, 'utf8'));
    trace.skill = { name: 'network-alarm-search', description: 'Search network alarms', goal: 'Show matching alarms' };
    trace.trajectory[0].caption.operation.prompt = 'Click the search control';
    await writeFile(tracePath, JSON.stringify(trace));
    const result = await createSkillFromRecording({ ...options, language: 'en-US' }, {
      runRecorder: async request => { assert.equal(request.language, 'en-US'); },
      fetch: async (_url, init) => {
        await installImportedFixture(init!.body as FormData, options.skillsRoot);
        return Response.json({ success: true });
      },
    });
    const asset = await readSkill(options.skillsRoot, result.skillName);
    assert.equal(asset.manifest.goal, 'Show matching alarms');
    assert.match(asset.manifest.description, /Search network alarms.*Computer-Use SubAgent/);
    assert.equal((asset.document.tasks as any[])[0].flow[0].aiTap, 'Click the search control');
    assert.doesNotMatch(await readFile(path.join(asset.root, 'SKILL.md'), 'utf8'), /[\u3400-\u9fff]/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('普通 Skill 重名自动追加后缀，所有权威身份一致且原始证据不变', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-generation-conflict-'));
  try {
    const options = await recordingSkillFixture(root);
    const ordinary = path.join(options.skillsRoot, 'ordinary-directory');
    await mkdir(ordinary, { recursive: true });
    const markdown = '---\nname: network-alarm-search\ndescription: ordinary\n---\n';
    await writeFile(path.join(ordinary, 'SKILL.md'), markdown);
    const tracePath = path.join(options.recording, 'Recording_1_trace.json');
    const trace = await readFile(tracePath, 'utf8');
    const result = await createSkillFromRecording(options, {
      runRecorder: async () => {},
      fetch: async (url, init) => {
        const name = await installImportedFixture(init!.body as FormData, options.skillsRoot);
        assert.equal(new URL(String(url)).searchParams.get('target_name'), name);
        return Response.json({ success: true });
      },
    });
    assert.match(result.skillName, /^network-alarm-search-[a-f0-9]{6}$/);
    const asset = await readSkill(options.skillsRoot, result.skillName);
    assert.equal(asset.marker.skillName, result.skillName);
    assert.equal(asset.manifest.skillName, result.skillName);
    assert.equal(asset.manifest.title, result.skillName);
    assert.equal((asset.document.agent as { groupName: string }).groupName, result.skillName);
    assert.equal(asset.manifest.goal, '查询并展示告警结果');
    assert.equal(asset.manifest.description, '查询网络告警 由 CUA 子 Agent 执行此电脑操作任务。');
    assert.equal(await readFile(tracePath, 'utf8'), trace);
    assert.equal(await readFile(path.join(ordinary, 'SKILL.md'), 'utf8'), markdown);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('宿主报告成功但正式目录不可发现时明确失败，并保留 ZIP', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-generation-discovery-'));
  try {
    const options = await recordingSkillFixture(root);
    await assert.rejects(createSkillFromRecording(options, {
      runRecorder: async () => {}, fetch: async () => Response.json({ success: true }),
    }), /已报告导入成功.*CUA_SKILLS_ROOT/);
    await assert.rejects(access(options.skillsRoot));
    const [directory] = await readdir(options.exportRoot);
    assert.ok((await readFile(path.join(options.exportRoot, directory, 'network-alarm-search.zip'))).length);
    assert.equal(await readFile(path.join(options.recording, 'inputs', 'events.txt'), 'utf8'), 'original events');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('导入 409 不覆盖已存在资产、不换名重传，ZIP 保留用于排查', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-generation-409-'));
  try {
    const options = await recordingSkillFixture(root);
    let calls = 0;
    await assert.rejects(createSkillFromRecording(options, {
      runRecorder: async () => {}, fetch: async (_url, init) => {
        calls += 1;
        await installImportedFixture(init!.body as FormData, options.skillsRoot);
        return Response.json({ detail: 'name exists' }, { status: 409 });
      },
    }), /名称冲突.*HTTP 409/);
    assert.equal(calls, 1);
    assert.equal((await readSkill(options.skillsRoot, 'network-alarm-search')).skill.name, 'network-alarm-search');
    assert.deepEqual(await readdir(options.skillsRoot), ['network-alarm-search']);
    const [directory] = await readdir(options.exportRoot);
    await access(path.join(options.exportRoot, directory, 'network-alarm-search.zip'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('缺少宿主地址在模型解析前失败，组装校验失败仅清理本次临时目录', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-generation-errors-'));
  const previous = process.env.GDECLAW_API_BASE_URL;
  try {
    const options = await recordingSkillFixture(root);
    process.env.GDECLAW_API_BASE_URL = '';
    let parserCalls = 0;
    const runRecorder = async () => { parserCalls += 1; };
    await assert.rejects(createSkillFromRecording(options, { runRecorder }), /GDECLAW_API_BASE_URL/);
    assert.equal(parserCalls, 0);
    delete process.env.GDECLAW_API_BASE_URL;
    const log = path.join(options.recording, 'Recording_1_processed_log_sc.json');
    await writeFile(log, JSON.stringify([{ timestamp: 0, action: 'LClick', screenshot_crop: '../outside.png' }]));
    await assert.rejects(createSkillFromRecording(options, { runRecorder, fetch: async () => { throw new Error('must not upload'); } }));
    assert.deepEqual(await readdir(options.exportRoot), []);
    await assert.rejects(access(options.skillsRoot));
    assert.equal(await readFile(path.join(options.recording, 'inputs', 'events.txt'), 'utf8'), 'original events');
  } finally {
    if (previous === undefined) delete process.env.GDECLAW_API_BASE_URL; else process.env.GDECLAW_API_BASE_URL = previous;
    await rm(root, { recursive: true, force: true });
  }
});
