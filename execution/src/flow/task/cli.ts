import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { applyCalibrationProposal, validateCalibrationProposal } from './calibration.js';
import { assertAllowedTaskArgs, loadRuntimeInputs, parseTaskArgs } from './cli-args.js';
import {
  createResolvedFlowSnapshot,
  readFlowWithFingerprint,
  readJsonFile,
  resolveProjectFlow,
  taskProjectPaths,
  validateFlow,
  validateOverrides,
  validateProjectConfig,
} from './resolver.js';
import type { FlowOverrides, TaskProjectConfig } from '../contracts/task-types.js';

type TaskCommand =
  | 'project:list'
  | 'flow:validate'
  | 'flow:inspect'
  | 'calibration:validate'
  | 'calibration:apply';

function requireValue(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`必须提供 --${key} <value>`);
  return value;
}

async function listProjects(projectsRoot: string): Promise<unknown[]> {
  let entries;
  try {
    entries = await readdir(projectsRoot, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取项目目录失败：${projectsRoot}\n${message}`);
  }

  const projects = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const paths = taskProjectPaths(entry.name, path.join(projectsRoot, entry.name));
    const [{ flow, fingerprint }, config, overrides] = await Promise.all([
      readFlowWithFingerprint(paths.flowPath),
      readJsonFile<TaskProjectConfig>(paths.projectConfigPath),
      readJsonFile<FlowOverrides>(paths.overridesPath),
    ]);
    validateFlow(flow, false);
    validateProjectConfig(config, flow);
    validateOverrides(overrides, flow);
    projects.push({
      project: config.project,
      title: config.title,
      description: config.description,
      goal: config.goal,
      inputs: config.inputs,
      baseFlowFingerprint: fingerprint,
    });
  }
  return projects;
}

async function run(): Promise<void> {
  const [commandValue, ...argv] = process.argv.slice(2);
  const command = commandValue as TaskCommand | undefined;
  if (!command) throw new Error('必须提供任务命令');

  if (command === 'project:list') {
    const args = parseTaskArgs(argv, ['json']);
    assertAllowedTaskArgs(args, ['projects-root'], ['json']);
    const projectsRoot = path.resolve(args.values.get('projects-root') ?? 'projects');
    const projects = await listProjects(projectsRoot);
    if (args.flags.has('json')) {
      console.log(JSON.stringify({ projects }, null, 2));
    } else {
      for (const project of projects as Array<{ project: string; title: string; description: string }>) {
        console.log(`${project.project}\t${project.title}\t${project.description}`);
      }
    }
    return;
  }

  const args = parseTaskArgs(argv, ['json', 'confirmed']);
  const project = requireValue(args.values, 'project');
  const projectRoot = args.values.get('project-root');

  if (command === 'calibration:validate' || command === 'calibration:apply') {
    assertAllowedTaskArgs(args, ['project', 'project-root', 'proposal'], ['json', 'confirmed']);
    const proposal = requireValue(args.values, 'proposal');
    if (command === 'calibration:validate') {
      const validated = await validateCalibrationProposal({ project, projectRoot, proposal });
      console.log(JSON.stringify({
        valid: true,
        project,
        proposal: validated.proposal,
      }, null, 2));
      return;
    }
    if (!args.flags.has('confirmed')) {
      throw new Error('应用校准前必须取得用户明确确认，并传入 --confirmed');
    }
    const history = await applyCalibrationProposal({ project, projectRoot, proposal });
    console.log(JSON.stringify({ applied: true, project, history }, null, 2));
    return;
  }

  if (command !== 'flow:validate' && command !== 'flow:inspect') {
    throw new Error(`不支持的任务命令：${command}`);
  }

  assertAllowedTaskArgs(args, ['project', 'project-root', 'flow', 'inputs'], ['json'], true);

  const inputs = await loadRuntimeInputs(args);
  const resolved = await resolveProjectFlow({
    project,
    projectRoot,
    flowPath: args.values.get('flow'),
    inputs,
  });
  if (command === 'flow:validate') {
    console.log(JSON.stringify({
      valid: true,
      project,
      inputs: resolved.inputs,
      sources: resolved.sources,
      stepCount: resolved.flow.steps.length,
    }, null, 2));
    return;
  }
  console.log(JSON.stringify(createResolvedFlowSnapshot(resolved), null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
