import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  applyStepPatch,
  pathExists,
  readFlowWithFingerprint,
  readJsonFile,
  resolveProjectFlow,
  taskProjectPaths,
  validateOverrides,
  validateProjectConfig,
  validateRoute,
} from './resolver.js';
import {
  CALIBRATION_PROPOSAL_SCHEMA_VERSION,
  type CalibrationHistoryRecord,
  type CalibrationProposal,
  type FlowOverrides,
  type FlowStepPatch,
  type TaskProjectConfig,
} from '../contracts/task-types.js';
import type { MidsceneFlowStep } from '../contracts/types.js';

export interface CalibrationOptions {
  project: string;
  proposal: string;
  projectRoot?: string;
}

export interface ValidatedCalibration {
  proposal: CalibrationProposal;
  proposalPath: string;
  currentSteps: Map<string, MidsceneFlowStep>;
  patchedSteps: Map<string, MidsceneFlowStep>;
  config: TaskProjectConfig;
  overrides: FlowOverrides;
}

function proposalFileName(proposal: string): string {
  const id = proposal.endsWith('.json') ? proposal.slice(0, -5) : proposal;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new Error(`proposal id 只能包含小写字母、数字、点、下划线和连字符：${proposal}`);
  }
  return `${id}.json`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function assertProposalShape(proposal: CalibrationProposal, expectedProject: string): void {
  if (proposal.schemaVersion !== CALIBRATION_PROPOSAL_SCHEMA_VERSION) {
    throw new Error(`不支持的 calibration proposal schemaVersion：${String(proposal.schemaVersion)}`);
  }
  if (proposal.project !== expectedProject) {
    throw new Error(`proposal 项目 ${proposal.project} 与请求项目 ${expectedProject} 不一致`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(proposal.id)) throw new Error(`无效 proposal id：${proposal.id}`);
  if (typeof proposal.summary !== 'string' || proposal.summary.trim() === '') throw new Error('proposal.summary 不能为空');
  if (typeof proposal.reason !== 'string' || proposal.reason.trim() === '') throw new Error('proposal.reason 不能为空');
  if (!/^[a-f0-9]{64}$/.test(proposal.baseFlowFingerprint)) throw new Error('proposal.baseFlowFingerprint 必须是 SHA-256');
  if (!Array.isArray(proposal.changes) || proposal.changes.length === 0) throw new Error('proposal.changes 不能为空');
}

export async function validateCalibrationProposal(options: CalibrationOptions): Promise<ValidatedCalibration> {
  const paths = taskProjectPaths(options.project, options.projectRoot);
  const proposalPath = path.join(paths.proposalsDir, proposalFileName(options.proposal));
  const [proposal, resolved, config, overrides, base] = await Promise.all([
    readJsonFile<CalibrationProposal>(proposalPath),
    resolveProjectFlow({ project: options.project, projectRoot: paths.projectRoot, executable: false }),
    readJsonFile<TaskProjectConfig>(paths.projectConfigPath),
    readJsonFile<FlowOverrides>(paths.overridesPath),
    readFlowWithFingerprint(paths.flowPath),
  ]);

  assertProposalShape(proposal, options.project);
  if (`${proposal.id}.json` !== path.basename(proposalPath)) {
    throw new Error(`proposal 文件名必须与 id 一致：${proposal.id}.json`);
  }
  if (proposal.baseFlowFingerprint !== base.fingerprint) {
    throw new Error('proposal 已过期：基础 IR 指纹已变化，请基于当前 flow 重新生成建议');
  }
  validateProjectConfig(config, base.flow);
  validateOverrides(overrides, base.flow);

  const currentSteps = new Map(resolved.flow.steps.map((step) => [step.id, step]));
  const patchedSteps = new Map<string, MidsceneFlowStep>();
  const changedIds = new Set<string>();
  for (const change of proposal.changes) {
    if (!change || typeof change !== 'object') throw new Error('proposal change 必须是对象');
    if (changedIds.has(change.stepId)) throw new Error(`proposal 重复修改 step：${change.stepId}`);
    changedIds.add(change.stepId);
    const current = currentSteps.get(change.stepId);
    if (!current) throw new Error(`proposal 引用了不存在的 step：${change.stepId}`);
    validateRoute(change.before?.route, `${change.stepId}.before.route`, false);
    if (stableJson(change.before.route) !== stableJson(current.route)) {
      throw new Error(`${change.stepId} 当前 route 与 proposal.before 不一致，请重新生成建议`);
    }
    if (change.before.timing !== undefined && stableJson(change.before.timing) !== stableJson(current.timing)) {
      throw new Error(`${change.stepId} 当前 timing 与 proposal.before 不一致，请重新生成建议`);
    }
    patchedSteps.set(change.stepId, applyStepPatch(current, change.after));
  }

  return { proposal, proposalPath, currentSteps, patchedSteps, config, overrides };
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

function mergeAppliedPatch(existing: FlowStepPatch | undefined, patched: MidsceneFlowStep, after: FlowStepPatch): FlowStepPatch {
  const result: FlowStepPatch = { ...existing, route: structuredClone(patched.route) };
  if (after.timing) {
    result.timing = { waitBeforeMs: patched.timing?.waitBeforeMs ?? 0 };
  }
  return result;
}

export async function applyCalibrationProposal(options: CalibrationOptions): Promise<CalibrationHistoryRecord> {
  const validated = await validateCalibrationProposal(options);
  const paths = taskProjectPaths(options.project, options.projectRoot);
  const historyPath = path.join(paths.historyDir, `${validated.proposal.id}.json`);
  if (await pathExists(historyPath)) throw new Error(`校准历史已存在：${validated.proposal.id}`);

  const nextOverrides = structuredClone(validated.overrides);
  const nextConfig = structuredClone(validated.config);
  for (const change of validated.proposal.changes) {
    const patched = validated.patchedSteps.get(change.stepId)!;
    nextOverrides.steps[change.stepId] = mergeAppliedPatch(
      nextOverrides.steps[change.stepId],
      patched,
      change.after,
    );

    if (patched.route.strategy === 'input') {
      for (const definition of Object.values(nextConfig.inputs)) {
        if (definition.binding.stepId === change.stepId) definition.default = patched.route.value;
      }
    }
  }

  const history: CalibrationHistoryRecord = {
    ...validated.proposal,
    status: 'applied',
    appliedAt: new Date().toISOString(),
  };

  await atomicWriteJson(paths.overridesPath, nextOverrides);
  await atomicWriteJson(paths.projectConfigPath, nextConfig);
  await atomicWriteJson(historyPath, history);
  await unlink(validated.proposalPath);
  return history;
}
