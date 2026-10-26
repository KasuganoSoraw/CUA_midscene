import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { listSkills, readSkill, resolveSkillTask } from '../../cua/skills/assets.js';
import { installSkill } from '../../cua/skills/create.js';
import { requireSkillName } from '../../cua/skills/paths.js';
import { assembleSkillFixture, createSkillFixture } from '../helpers/skill-fixture.js';

const roots: string[] = [];
async function temporary(): Promise<string> { const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skills-')); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test('正式 Skill 完整安装、发现与执行解析，不包含场景字段', async () => {
  const root = await temporary();
  const target = await createSkillFixture(root);
  const items = await listSkills(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].skillName, 'alarm-query');
  assert.deepEqual((await readdir(target)).sort(), ['SKILL.md', 'cua-manifest.json', 'source', 'task.json', 'task.yaml']);
  const resolved = await resolveSkillTask({ skillsRoot: root, skillName: 'alarm-query' });
  assert.equal(resolved.manifest.schemaVersion, '0.3');
  assert.equal(Object.hasOwn(resolved.manifest, 'scene'), false);
  await assert.rejects(resolveSkillTask({ skillsRoot: root, skillName: 'alarm-query', inputs: { unknown: 'x' } }), /未知输入/);
});

test('普通宿主 Skill 不被发现或解析，身份及版本错误不会被管理', async () => {
  const root = await temporary();
  await mkdir(path.join(root, 'ordinary'));
  await writeFile(path.join(root, 'ordinary', 'SKILL.md'), '---\nname: ordinary\ndescription: native\n---\n');
  assert.deepEqual(await listSkills(root), []);
  await assert.rejects(readSkill(root, 'ordinary'));
  const target = await createSkillFixture(root);
  await writeFile(path.join(target, 'cua-manifest.json'), JSON.stringify({ schemaVersion: '9', kind: 'cua-skill', skillName: 'alarm-query', taskSchemaVersion: '0.3' }));
  assert.equal((await listSkills(root))[0].status, 'error');
  await assert.rejects(readSkill(root, 'alarm-query'), /契约校验/);
});

test('安装名称冲突及并发不覆盖资产，组装失败清理暂存目录', async () => {
  const root = await temporary();
  const results = await Promise.allSettled([createSkillFixture(root), createSkillFixture(root)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const before = await readFile(path.join(root, 'alarm-query', 'task.json'), 'utf8');
  await assert.rejects(createSkillFixture(root), /拒绝覆盖/);
  assert.equal(await readFile(path.join(root, 'alarm-query', 'task.json'), 'utf8'), before);
  await assert.rejects(installSkill(root, 'incomplete-task', async () => { throw new Error('assemble failed'); }), /assemble failed/);
  assert.deepEqual(await readdir(path.join(root, '.cua-staging')), []);
  assert.equal((await readdir(root)).includes('incomplete-task'), false);
});

test('目录身份、越界引用、Windows 路径与符号链接被拒绝', async () => {
  const root = await temporary();
  for (const name of ['../escape', 'C:\\skills', 'Upper-Name', 'con']) assert.throws(() => requireSkillName(name));
  await assert.rejects(installSkill(root, 'wrong-name', stage => assembleSkillFixture(stage, 'actual-name')), /身份不一致/);
  const target = await createSkillFixture(root);
  const manifest = JSON.parse(await readFile(path.join(target, 'task.json'), 'utf8'));
  manifest.source.tracePath = '../outside.json';
  await writeFile(path.join(target, 'task.json'), JSON.stringify(manifest));
  await assert.rejects(readSkill(root, 'alarm-query'), /source|非法|越出/);
  const outside = await temporary();
  await symlink(outside, path.join(root, 'linked-skill'), 'junction');
  await assert.rejects(readSkill(root, 'linked-skill'), /符号链接/);
});
