export const MIDSCENE_FLOW_SCHEMA_VERSION = '0.1';

export type MidsceneFlowRouteStrategy =
  | 'keyboard'
  | 'input'
  | 'tap'
  | 'act'
  | 'wait'
  | 'manual-review';

export interface MidsceneFlow {
  schemaVersion: typeof MIDSCENE_FLOW_SCHEMA_VERSION;
  project: string;
  goal: string;
  source: MidsceneFlowSource;
  commands?: MidsceneFlowCommands;
  modelUsage?: MidsceneFlowModelUsage;
  steps: MidsceneFlowStep[];
}

export interface MidsceneFlowSource {
  tracePath: string;
  processedLogPath?: string;
  processedLogWithScreenshotsPath?: string;
  screenshotsDir?: string;
}

export interface MidsceneFlowCommands {
  recordingPreparation?: string;
  traceGeneration?: string;
  traceToFlowConversion: string;
  flowExecution?: string;
}

export interface MidsceneFlowModelUsage {
  recordingPreparation: 'uses-model' | 'no-model' | 'unknown';
  traceGeneration: 'uses-model' | 'no-model' | 'unknown';
  traceToFlowConversion: 'uses-model' | 'no-model';
  flowExecution: 'uses-model' | 'no-model' | 'depends-on-route';
  notes?: string[];
}

export interface MidsceneFlowStep {
  id: string;
  sourceTrace: MidsceneFlowSourceTrace;
  intent: string;
  evidence: MidsceneFlowEvidence;
  route: MidsceneFlowRoute;
  fallback: MidsceneFlowFallback;
}

export interface MidsceneFlowSourceTrace {
  stepIndex: number;
  rawAction?: string;
}

export interface MidsceneFlowEvidence {
  observation: string;
  thought?: string;
  action: string;
  expectation?: string;
  screenshot?: string;
  crop?: string;
}

export type MidsceneFlowRoute =
  | MidsceneKeyboardRoute
  | MidsceneInputRoute
  | MidsceneTapRoute
  | MidsceneActRoute
  | MidsceneWaitRoute
  | MidsceneManualReviewRoute;

export interface MidsceneKeyboardRoute {
  strategy: 'keyboard';
  keyName: string;
}

export interface MidsceneInputRoute {
  strategy: 'input';
  target: string;
  value: string;
  mode?: 'replace' | 'append' | 'typeOnly';
}

export interface MidsceneTapRoute {
  strategy: 'tap';
  target: string;
}

export interface MidsceneActRoute {
  strategy: 'act';
  instruction: string;
}

export interface MidsceneWaitRoute {
  strategy: 'wait';
  condition: string;
  timeoutMs?: number;
}

export interface MidsceneManualReviewRoute {
  strategy: 'manual-review';
  reason: string;
}

export interface MidsceneFlowFallback {
  strategy: 'vision' | 'fail';
  instruction?: string;
  reason?: string;
}
