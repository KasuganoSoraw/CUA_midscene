import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyCalibrationProposal, validateCalibrationProposal } from '../../../src/flow/task/calibration.js';
import { fingerprintFlowContent, resolveProjectFlow } from '../../../src/flow/task/resolver.js';
import {
  CALIBRATION_PROPOSAL_SCHEMA_VERSION,
  FLOW_OVERRIDES_SCHEMA_VERSION,
  TASK_PROJECT_SCHEMA_VERSION,
  type CalibrationProposal,
  type FlowOverrides,
  type TaskProjectConfig,
} from '../../../src/flow/contracts/task-types.js';
import { MIDSCENE_FLOW_SCHEMA_VERSION, type MidsceneFlow } from '../../../src/flow/contracts/types.js';

const project = 'calibration-test';
const flow: MidsceneFlow = {
  schemaVersion: MIDSCENE_FLOW_SCHEMA_VERSION,
  project,
  goal: '测试校准',
  source: { tracePath: 'source/showui-trace.json' },
  steps: [{
    id: 'step-001',
    sourceTrace: { stepIndex: 1 },
    intent: '输入关键词',
    evidence: { observation: '', action: '输入关键词' },
    route: {
      strategy: 'input',
      prompt: '在搜索框输入 {{value}}',
      locatePrompt: '搜索框',
      value: '原始值',
      mode: 'replace',
      inputMethod: 'keyboard-action',
    },
    fallback: { strategy: 'vision', instruction: '在搜索框输入 {{value}}' },
  }],
};

const config: TaskProjectConfig = {
  schemaVersion: TASK_PROJECT_SCHEMA_VERSION,
  project,
  title: '校准测试',
  description: '校准测试',
  goal: flow.goal,
  inputs: {
    'step-001-value': {
      type: 'string',
      label: '搜索值',
      default: '原始值',
      binding: { stepId: 'step-001', field: 'route.value' },
    },
  },
};

const overrides: FlowOverrides = { schemaVersion: FLOW_OVERRIDES_SCHEMA_VERSION, project, steps: {} };
const root = await mkdtemp(path.join(os.tmpdir(), 'cua-calibration-'));
try {
  for (const directory of ['ir', 'config', 'calibration/proposals', 'calibration/history']) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  const flowContent = `${JSON.stringify(flow, null, 2)}\n`;
  await writeFile(path.join(root, 'ir', 'midscene-flow.json'), flowContent, 'utf8');
  await writeFile(path.join(root, 'config', 'project.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await writeFile(path.join(root, 'config', 'flow-overrides.json'), `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');

  const proposal: CalibrationProposal = {
    schemaVersion: CALIBRATION_PROPOSAL_SCHEMA_VERSION,
    id: 'fix-input-target',
    project,
    baseFlowFingerprint: fingerprintFlowContent(flowContent),
    summary: '修正输入框定位与默认值',
    reason: '原定位描述不足，默认搜索值需要长期调整',
    changes: [{
      stepId: 'step-001',
      before: { route: flow.steps[0].route },
      after: { route: { locatePrompt: '页面顶部工具栏中的搜索输入框', value: '47405' } },
    }],
  };
  const proposalPath = path.join(root, 'calibration', 'proposals', 'fix-input-target.json');
  await writeFile(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');

  const pending = await resolveProjectFlow({ project, projectRoot: root });
  assert.equal(pending.flow.steps[0].route.strategy === 'input' && pending.flow.steps[0].route.locatePrompt, '搜索框');

  await validateCalibrationProposal({ project, projectRoot: root, proposal: 'fix-input-target' });
  const history = await applyCalibrationProposal({ project, projectRoot: root, proposal: 'fix-input-target' });
  assert.equal(history.status, 'applied');
  const applied = await resolveProjectFlow({ project, projectRoot: root });
  assert.equal(applied.flow.steps[0].route.strategy === 'input' && applied.flow.steps[0].route.locatePrompt, '页面顶部工具栏中的搜索输入框');
  assert.equal(applied.flow.steps[0].route.strategy === 'input' && applied.flow.steps[0].route.value, '47405');
  assert.equal(await readFile(proposalPath, 'utf8').catch(() => 'missing'), 'missing');

  const staleProposal = { ...proposal, id: 'stale', baseFlowFingerprint: '0'.repeat(64) };
  await writeFile(
    path.join(root, 'calibration', 'proposals', 'stale.json'),
    `${JSON.stringify(staleProposal, null, 2)}\n`,
    'utf8',
  );
  await assert.rejects(
    validateCalibrationProposal({ project, projectRoot: root, proposal: 'stale' }),
    /proposal 已过期/,
  );

  const unknownStep = {
    ...proposal,
    id: 'unknown-step',
    changes: [{ ...proposal.changes[0], stepId: 'step-999' }],
  };
  await writeFile(
    path.join(root, 'calibration', 'proposals', 'unknown-step.json'),
    `${JSON.stringify(unknownStep, null, 2)}\n`,
    'utf8',
  );
  await assert.rejects(
    validateCalibrationProposal({ project, projectRoot: root, proposal: 'unknown-step' }),
    /不存在的 step：step-999/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('校准 proposal 测试通过');
