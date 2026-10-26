import path from 'node:path';
import { requireDataPaths, requireSkillsRoot } from '../data-paths.js';
import type { RuntimeLayout } from '../contracts/types.js';
import { runRecordedTaskAiAct, runTask } from '../task/execution.js';
import { loadRuntimeInputs } from '../task/inputs.js';
import { describeSkill, listSkills, readSkill, resolveSkillTask } from './assets.js';
import { createSkillFromRecording } from './create.js';

export async function runSkillCommand(command: string, options: Record<string, string | string[] | boolean | undefined>, layout: RuntimeLayout): Promise<string> {
  const root = requireSkillsRoot(layout);
  const name = options['skill-name'] as string;
  if (command === 'list') return `${JSON.stringify({ skills: await listSkills(root) }, null, 2)}\n`;
  if (command === 'describe') return `${JSON.stringify(describeSkill(await readSkill(root, name)), null, 2)}\n`;
  if (command === 'create-from-recording') {
    const result = await createSkillFromRecording({
      recording: options.recording as string, skillsRoot: root,
      pythonExecutable: options['python-executable'] as string | undefined,
    });
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  const inputs = await loadRuntimeInputs(options.inputs as string | undefined, options.input as string[] | undefined);
  if (command === 'validate') {
    const resolved = await resolveSkillTask({ skillsRoot: root, skillName: name, inputs });
    return `${JSON.stringify({ valid: true, skillName: name, inputs: resolved.inputs }, null, 2)}\n`;
  }
  const strategy = options.strategy ?? 'guided';
  if (strategy !== 'guided' && strategy !== 'replay') throw new Error('--strategy 仅支持 guided 或 replay');
  const data = await requireDataPaths(layout);
  const execution = { skillName: name, skillsRoot: root, inputs, runsRoot: data.runsRoot, dryRun: options['dry-run'] === true };
  const result = strategy === 'guided' ? await runRecordedTaskAiAct(execution) : await runTask(execution);
  return `${JSON.stringify({
    skillName: name, strategy, runDir: path.dirname(result.resolvedTaskPath), resolvedTaskPath: result.resolvedTaskPath,
    ...('promptPath' in result ? { promptPath: result.promptPath } : {}), executor: result.executorResult,
  }, null, 2)}\n`;
}
