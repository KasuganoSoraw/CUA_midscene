import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildRecordedSteps } from '../../cua/conversion/showui-trace.js';
import { writeJsonFile } from '../../cua/contracts/validation.js';
import { writeYamlDocument } from '../../cua/task/yaml-task.js';
import { installSkill, skillMarkdown } from '../../cua/skills/create.js';

export async function assembleSkillFixture(root: string, name = 'alarm-query'): Promise<void> {
  await mkdir(path.join(root, 'source'), { recursive: true });
  const trace = { trajectory: [{ step_idx: 1, caption: { operation: { type: 'click' as const, prompt: '点击查询' } } }] };
  const log = [{ timestamp: 0, action: 'LClick' }];
  const built = buildRecordedSteps(trace, log);
  const metadata = { name, description: '查询网络告警。', goal: '在告警页面点击查询并显示结果' };
  await writeFile(path.join(root, 'SKILL.md'), skillMarkdown(metadata), 'utf8');
  await writeJsonFile(path.join(root, 'cua-manifest.json'), { schemaVersion: '0.1', kind: 'cua-skill', skillName: name, taskSchemaVersion: '0.3' });
  await writeJsonFile(path.join(root, 'task.json'), {
    schemaVersion: '0.3', skillName: name, title: name,
    description: `${metadata.description} 由 CUA 子 Agent 执行此电脑操作任务。`, goal: metadata.goal,
    source: { tracePath: 'source/showui-trace.json', processedLogPath: 'source/processed-log-sc.json', conversionCommand: 'fixture', stepBindings: built.stepBindings },
    inputs: built.inputs,
  });
  await writeYamlDocument(path.join(root, 'task.yaml'), {
    computer: {}, agent: { groupName: name, groupDescription: metadata.goal }, tasks: built.tasks,
  });
  await writeJsonFile(path.join(root, 'source', 'showui-trace.json'), trace);
  await writeJsonFile(path.join(root, 'source', 'processed-log-sc.json'), log);
}

export async function createSkillFixture(skillsRoot: string, name = 'alarm-query'): Promise<string> {
  return installSkill(skillsRoot, name, root => assembleSkillFixture(root, name));
}
