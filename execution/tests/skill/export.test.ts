import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { createSkillArchive } from '../../cua/skills/archive.js';
import { availableSkillName, occupiedSkillNames } from '../../cua/skills/names.js';
import { listSkills } from '../../cua/skills/assets.js';
import { resolveSkillExportRoot } from '../../cua/data-paths.js';
import { createSkillFixture } from '../helpers/skill-fixture.js';

test('ZIP 直接包含单个 Skill 文件与证据，没有额外临时目录包装', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skill-zip-'));
  try {
    const source = await createSkillFixture(path.join(root, 'skills'));
    await writeFile(path.join(source, 'source', '定位图.png'), 'image bytes');
    const zipPath = path.join(root, 'alarm-query.zip');
    await createSkillArchive(source, 'alarm-query', zipPath);
    const entries = unzipSync(await readFile(zipPath));
    assert.deepEqual(Object.keys(entries).sort(), ['SKILL.md', 'cua-manifest.json', 'source/processed-log-sc.json', 'source/showui-trace.json', 'source/定位图.png', 'task.json', 'task.yaml']);
    assert.equal(new TextDecoder().decode(entries['source/定位图.png']), 'image bytes');
    await assert.rejects(createSkillArchive(source, 'alarm-query', path.join(source, 'archive.zip')), /不能位于/);
    await assert.rejects(createSkillArchive(source, 'alarm-query', zipPath), /EEXIST/);
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(source, 'linked'), 'junction');
    await assert.rejects(createSkillArchive(source, 'alarm-query', path.join(root, 'unsafe.zip')), /符号链接/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('普通 Skill 的规范名称及实际目录名均参与重名检查，但不进入工作台列表', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-skill-names-'));
  try {
    await mkdir(path.join(root, 'different-directory'));
    await writeFile(path.join(root, 'different-directory', 'SKILL.md'), '---\nname: alarm-query\n---\n');
    await mkdir(path.join(root, 'broken-skill'));
    await writeFile(path.join(root, 'broken-skill', 'SKILL.md'), 'not frontmatter');
    const names = await occupiedSkillNames(root);
    assert.ok(names.has('different-directory'));
    assert.ok(names.has('alarm-query'));
    assert.ok(names.has('broken-skill'));
    assert.deepEqual(await listSkills(root), []);
    assert.equal(availableSkillName('alarm-query', names, () => 'a3f91c'), 'alarm-query-a3f91c');
    assert.equal(availableSkillName('free-name', names, () => { throw new Error('must not need random'); }), 'free-name');
    await assert.rejects(access(path.join(root, 'different-directory', 'task.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('冲突后缀保持 64 字符限制、合法名称和有限尝试', () => {
  const name = 'a'.repeat(64);
  assert.equal(availableSkillName(name, new Set([name]), () => 'abcdef').length, 64);
  let index = 0;
  const occupied = new Set(['alarm-query', 'alarm-query-abcdef']);
  assert.equal(availableSkillName('alarm-query', occupied, () => ['abcdef', '123456'][index++]), 'alarm-query-123456');
  assert.throws(() => availableSkillName('alarm-query', occupied, () => 'abcdef'), /未占用/);
  assert.throws(() => availableSkillName('alarm-query', occupied, () => '../bad'), /随机后缀/);
});

test('临时根支持系统默认与配置优先级，拒绝正式根及链接别名下的导出', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-export-path-'));
  const previous = process.env.CUA_SKILL_EXPORT_TEMP_ROOT;
  const skills = path.join(root, 'skills');
  const executionRoot = path.join(root, 'execution');
  try {
    process.env.CUA_SKILL_EXPORT_TEMP_ROOT = '';
    assert.equal(await resolveSkillExportRoot(skills, executionRoot), await realpath(os.tmpdir()));
    delete process.env.CUA_SKILL_EXPORT_TEMP_ROOT;
    await writeFile(path.join(root, '.env'), `CUA_SKILL_EXPORT_TEMP_ROOT=${path.join(root, 'from-env')}\n`);
    assert.match(await resolveSkillExportRoot(skills, executionRoot), /from-env$/);
    await writeFile(path.join(root, '.env.local'), `CUA_SKILL_EXPORT_TEMP_ROOT=${path.join(root, 'from-local')}\n`);
    assert.match(await resolveSkillExportRoot(skills, executionRoot), /from-local$/);
    process.env.CUA_SKILL_EXPORT_TEMP_ROOT = path.join(root, 'process-temp');
    assert.match(await resolveSkillExportRoot(skills, executionRoot), /process-temp$/);
    for (const invalid of ['relative', skills, path.join(skills, 'exports')]) {
      process.env.CUA_SKILL_EXPORT_TEMP_ROOT = invalid;
      await assert.rejects(resolveSkillExportRoot(skills, executionRoot), /绝对路径|不得位于/);
    }
    await mkdir(skills);
    await symlink(skills, path.join(root, 'alias'), 'junction');
    process.env.CUA_SKILL_EXPORT_TEMP_ROOT = path.join(root, 'alias', 'exports');
    await assert.rejects(resolveSkillExportRoot(skills, executionRoot), /不得位于/);
    assert.deepEqual(await readdir(skills), []);
    const file = path.join(root, 'not-directory');
    await writeFile(file, 'file');
    process.env.CUA_SKILL_EXPORT_TEMP_ROOT = file;
    await assert.rejects(resolveSkillExportRoot(skills, executionRoot), /不可用/);
  } finally {
    if (previous === undefined) delete process.env.CUA_SKILL_EXPORT_TEMP_ROOT; else process.env.CUA_SKILL_EXPORT_TEMP_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
