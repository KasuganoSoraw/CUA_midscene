import { agentForComputer } from '@midscene/computer';
import { checkRequiredModelEnv, warnIfNodeVersionIsOld } from '../../env.js';
import { createKeyboardTypeTextAction } from './keyboard-type-action.js';
import {
  assertAllowedTaskArgs,
  loadRuntimeInputs,
  parseTaskArgs,
  type ParsedTaskArgs,
} from '../task/cli-args.js';
import { resolveProjectFlow, taskProjectPaths, writeResolvedFlowSnapshot } from '../task/resolver.js';
import type { MidsceneFlowStep } from '../contracts/types.js';

type ComputerAgent = Awaited<ReturnType<typeof agentForComputer>>;

interface RunOptions {
  project: string;
  projectRoot?: string;
  flowPath?: string;
  dryRun: boolean;
  args: ParsedTaskArgs;
}

function parseArgs(argv: string[]): RunOptions {
  const args = parseTaskArgs(argv, ['dry-run']);
  assertAllowedTaskArgs(args, ['project', 'project-root', 'flow', 'inputs'], ['dry-run'], true);
  const project = args.values.get('project');
  if (!project) {
    throw new Error('必须提供 --project <project-name>');
  }

  return {
    project,
    projectRoot: args.values.get('project-root'),
    flowPath: args.values.get('flow'),
    dryRun: args.flags.has('dry-run'),
    args,
  };
}

function describeRoute(step: MidsceneFlowStep): string {
  const route = step.route;
  switch (route.strategy) {
    case 'keyboard':
      return `${describeStepTiming(step)}${step.id} keyboard ${route.keyName}`;
    case 'input':
      return `${describeStepTiming(step)}${step.id} input KeyboardTypeText locate "${route.locatePrompt}" -> ${renderPrompt(route.prompt, route.value)} = ${route.value}`;
    case 'tap':
      return `${describeStepTiming(step)}${step.id} tap ${route.prompt}`;
    case 'act':
      return `${describeStepTiming(step)}${step.id} act ${route.prompt}`;
    case 'wait':
      return `${describeStepTiming(step)}${step.id} wait ${route.condition}`;
    case 'manual-review':
      return `${describeStepTiming(step)}${step.id} manual-review ${route.reason}`;
  }
}

function renderPrompt(prompt: string, value: string): string {
  return prompt.replaceAll('{{value}}', value);
}

function describeStepTiming(step: MidsceneFlowStep): string {
  const waitBeforeMs = step.timing?.waitBeforeMs ?? 0;
  return waitBeforeMs > 0 ? `[wait ${waitBeforeMs}ms] ` : '';
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitBeforeStep(step: MidsceneFlowStep): Promise<void> {
  const waitBeforeMs = step.timing?.waitBeforeMs ?? 0;
  if (waitBeforeMs <= 0) return;
  console.log(`等待 ${waitBeforeMs}ms 后执行 ${step.id}（来源：录制步骤间隔）`);
  await delay(waitBeforeMs);
}

async function executeStep(agent: ComputerAgent, step: MidsceneFlowStep): Promise<void> {
  const route = step.route;
  switch (route.strategy) {
    case 'keyboard':
      await agent.callActionInActionSpace('KeyboardPress', { keyName: route.keyName });
      return;
    case 'input':
      await agent.callActionInActionSpace('KeyboardTypeText', {
        locate: { prompt: route.locatePrompt },
        value: route.value,
        mode: route.mode ?? 'replace',
      });
      return;
    case 'tap':
      await agent.aiTap(route.prompt);
      return;
    case 'act':
      await agent.aiAct(route.prompt);
      return;
    case 'wait':
      await agent.aiWaitFor(route.prompt ?? route.condition, { timeoutMs: route.timeoutMs ?? 15000 });
      return;
    case 'manual-review':
      throw new Error(`step ${step.id} 需要人工审查：${route.reason}`);
  }
}

async function run(options: RunOptions): Promise<void> {
  const inputs = await loadRuntimeInputs(options.args);
  const resolved = await resolveProjectFlow({
    project: options.project,
    projectRoot: options.projectRoot,
    flowPath: options.flowPath,
    inputs,
  });
  const flow = resolved.flow;

  if (options.dryRun) {
    console.log(`Midscene flow dry-run 通过：${resolved.sources.baseFlowPath}`);
    console.log(`已确认校准 step：${resolved.sources.appliedOverrideSteps.join(', ') || '无'}`);
    console.log(`本次输入：${JSON.stringify(resolved.inputs)}`);
    for (const step of flow.steps) {
      console.log(describeRoute(step));
    }
    return;
  }

  warnIfNodeVersionIsOld();
  checkRequiredModelEnv();

  const paths = taskProjectPaths(options.project, options.projectRoot, options.flowPath);
  const snapshotPath = await writeResolvedFlowSnapshot(resolved, paths.reportsDir);
  console.log(`已保存 resolved flow 快照：${snapshotPath}`);

  const keyboardTypeText = createKeyboardTypeTextAction();
  const agent = await agentForComputer({
    generateReport: true,
    groupName: `midscene-flow-${flow.project}`,
    groupDescription: flow.goal || `执行 Midscene flow：${flow.project}`,
    customActions: [keyboardTypeText.action],
  });
  const keyboard = agent.interface.inputPrimitives?.keyboard;
  if (!keyboard?.keyboardPress) {
    throw new Error('当前 Midscene computer interface 不支持底层 keyboardPress 输入');
  }
  keyboardTypeText.setPressKey(async (keyName, target) => {
    await keyboard.keyboardPress(keyName, { target });
  });

  try {
    for (const step of flow.steps) {
      await waitBeforeStep(step);
      console.log(`执行 ${describeRoute(step)}`);
      await executeStep(agent, step);
    }
  } finally {
    await agent.destroy();
  }
}

run(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
