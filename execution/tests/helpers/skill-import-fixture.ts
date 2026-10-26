import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { parseSkillName } from '../../cua/skills/assets.js';
import { assembleSkillFixture } from './skill-fixture.js';

export async function recordingSkillFixture(root: string, name = 'network-alarm-search') {
  const fixture = path.join(root, 'fixture');
  const recording = path.join(root, 'Recording_1');
  const skillsRoot = path.join(root, 'skills');
  const exportRoot = path.join(root, 'exports');
  await assembleSkillFixture(fixture, name);
  await mkdir(path.join(recording, 'inputs'), { recursive: true });
  await writeFile(path.join(recording, 'inputs', 'events.txt'), 'original events');
  const trace = JSON.parse(await readFile(path.join(fixture, 'source', 'showui-trace.json'), 'utf8'));
  trace.skill = { name, description: '查询网络告警', goal: '查询并展示告警结果' };
  await writeFile(path.join(recording, 'Recording_1_trace.json'), JSON.stringify(trace));
  const log = await readFile(path.join(fixture, 'source', 'processed-log-sc.json'));
  for (const suffix of ['processed_log', 'processed_log_sc']) {
    await writeFile(path.join(recording, `Recording_1_${suffix}.json`), log);
  }
  await writeFile(path.join(root, '.env.local'), `GDECLAW_API_BASE_URL=http://127.0.0.1:51999\nCUA_SKILL_EXPORT_TEMP_ROOT=${exportRoot}\n`);
  return { recording, skillsRoot, exportRoot, executionRoot: path.join(root, 'execution'), pythonExecutable: process.execPath };
}

export async function installImportedFixture(form: FormData, skillsRoot: string): Promise<string> {
  const file = form.get('file');
  if (!(file instanceof Blob)) throw new Error('missing ZIP file');
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const name = parseSkillName(new TextDecoder().decode(entries['SKILL.md']));
  const root = path.join(skillsRoot, name);
  await mkdir(skillsRoot, { recursive: true });
  await mkdir(root);
  for (const [relative, bytes] of Object.entries(entries)) {
    const target = path.resolve(root, relative);
    const inside = path.relative(root, target);
    if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) throw new Error('unsafe ZIP');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
  return name;
}
