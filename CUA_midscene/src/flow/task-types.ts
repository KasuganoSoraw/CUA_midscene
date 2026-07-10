import type { MidsceneFlow, MidsceneFlowRoute, MidsceneFlowTiming } from './types.js';

export const TASK_PROJECT_SCHEMA_VERSION = '0.1';
export const FLOW_OVERRIDES_SCHEMA_VERSION = '0.1';
export const CALIBRATION_PROPOSAL_SCHEMA_VERSION = '0.1';
export const RESOLVED_FLOW_SCHEMA_VERSION = '0.1';

export interface TaskProjectConfig {
  schemaVersion: typeof TASK_PROJECT_SCHEMA_VERSION;
  project: string;
  title: string;
  description: string;
  goal: string;
  inputs: Record<string, TaskInputDefinition>;
}

export interface TaskInputDefinition {
  type: 'string';
  label: string;
  description?: string;
  default: string;
  binding: {
    stepId: string;
    field: 'route.value';
  };
}

export interface FlowOverrides {
  schemaVersion: typeof FLOW_OVERRIDES_SCHEMA_VERSION;
  project: string;
  steps: Record<string, FlowStepPatch>;
}

export interface FlowStepPatch {
  route?: Partial<MidsceneFlowRoute> & { strategy?: MidsceneFlowRoute['strategy'] };
  timing?: Pick<MidsceneFlowTiming, 'waitBeforeMs'>;
}

export interface CalibrationProposal {
  schemaVersion: typeof CALIBRATION_PROPOSAL_SCHEMA_VERSION;
  id: string;
  project: string;
  baseFlowFingerprint: string;
  summary: string;
  reason: string;
  changes: CalibrationChange[];
}

export interface CalibrationChange {
  stepId: string;
  before: {
    route: MidsceneFlowRoute;
    timing?: MidsceneFlowTiming;
  };
  after: FlowStepPatch;
}

export interface CalibrationHistoryRecord extends CalibrationProposal {
  status: 'applied';
  appliedAt: string;
}

export interface ResolvedFlowSources {
  baseFlowPath: string;
  projectConfigPath: string;
  overridesPath: string;
  baseFlowFingerprint: string;
  appliedOverrideSteps: string[];
}

export interface ResolvedFlowResult {
  flow: MidsceneFlow;
  sources: ResolvedFlowSources;
  inputs: Record<string, string>;
}

export interface ResolvedFlowSnapshot extends ResolvedFlowResult {
  schemaVersion: typeof RESOLVED_FLOW_SCHEMA_VERSION;
  resolvedAt: string;
}
