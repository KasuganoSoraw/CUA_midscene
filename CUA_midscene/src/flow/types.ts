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
  operation?: MidsceneTraceOperation;
  screenshot?: string;
  crop?: string;
}

export type MidsceneTraceOperation =
  | MidsceneTraceClickOperation
  | MidsceneTraceInputOperation
  | MidsceneTraceKeyboardOperation
  | MidsceneTraceWaitOperation
  | MidsceneTraceUnknownOperation;

export interface MidsceneTraceClickOperation {
  type: 'click';
  prompt: string;
}

export interface MidsceneTraceInputOperation {
  type: 'input';
  prompt: string;
  locatePrompt?: string;
  value: string;
}

export interface MidsceneTraceKeyboardOperation {
  type: 'keyboard';
  prompt?: string;
  key: string;
}

export interface MidsceneTraceWaitOperation {
  type: 'wait';
  prompt?: string;
  condition: string;
}

export interface MidsceneTraceUnknownOperation {
  type: 'unknown';
  prompt?: string;
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
  prompt: string;
  locatePrompt: string;
  value: string;
  mode?: 'replace' | 'append' | 'typeOnly';
  inputMethod?: 'keyboard-action';
}

export interface MidsceneTapRoute {
  strategy: 'tap';
  prompt: string;
}

export interface MidsceneActRoute {
  strategy: 'act';
  prompt: string;
}

export interface MidsceneWaitRoute {
  strategy: 'wait';
  prompt?: string;
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
