import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSkillFromRecording } from '../../cua/skills/create.js';
import { readSkill } from '../../cua/skills/assets.js';
import { requireSkillsRoot, resolveRuntimeLayout, resolveSkillsRoot } from '../../cua/data-paths.js';
import { assembleSkillFixture } from '../helpers/skill-fixture.js';

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

test('录制生成使用模型语义摘要，直接写入 Skill 根，不创建 projects', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skill-generation-'));
  const fixture = path.join(root, 'fixture');
  const recording = path.join(root, 'Recording_1');
  const skillsRoot = path.join(root, 'skills');
  try {
    await assembleSkillFixture(fixture, 'network-alarm-search');
    await mkdir(recording);
    await mkdir(path.join(recording, 'inputs'));
    const trace = JSON.parse(await readFile(path.join(fixture, 'source', 'showui-trace.json'), 'utf8'));
    trace.skill = { name: 'network-alarm-search', description: '查询网络告警', goal: '查询并展示告警结果' };
    const result = await createSkillFromRecording({ recording, skillsRoot, pythonExecutable: process.execPath }, {
      runRecorder: async () => {
        await writeFile(path.join(recording, 'Recording_1_trace.json'), JSON.stringify(trace));
        for (const suffix of ['processed_log', 'processed_log_sc']) {
          await cp(path.join(fixture, 'source', 'processed-log-sc.json'), path.join(recording, `Recording_1_${suffix}.json`));
        }
      },
    });
    assert.equal(result.skillName, 'network-alarm-search');
    const asset = await readSkill(skillsRoot, result.skillName);
    assert.equal(asset.manifest.goal, '查询并展示告警结果');
    assert.match(asset.skill.description, /CUA 子 Agent/);
    assert.equal((await readdir(root)).includes('projects'), false);
    await assert.rejects(createSkillFromRecording({ recording, skillsRoot: '', pythonExecutable: process.execPath }), /CUA_SKILLS_ROOT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
