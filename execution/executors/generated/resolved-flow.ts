/* 由 resolved-flow.schema.json 生成，请勿手工编辑。 */

export type Flowexecution = string | null;
export type Recordingpreparation = string | null;
export type Tracegeneration = string | null;
export type Tracetoflowconversion = string;
export type Goal = string;
export type Project = string;
export type Schemaversion = '0.1';
export type Processedlogpath = string | null;
export type Processedlogwithscreenshotspath = string | null;
export type Screenshotsdir = string | null;
export type Tracepath = string;
export type Action = string;
export type Crop = string | null;
export type Expectation = string | null;
export type Observation = string;
export type Operation =
  | (TraceClickOperation | TraceInputOperation | TraceKeyboardOperation | TraceWaitOperation | TraceUnknownOperation)
  | null;
export type Prompt = string;
export type Type = 'click';
export type Locateprompt = string | null;
export type Prompt1 = string;
export type Type1 = 'input';
export type Value = string;
export type Key = string;
export type Prompt2 = string | null;
export type Type2 = 'keyboard';
export type Condition = string;
export type Prompt3 = string | null;
export type Type3 = 'wait';
export type Prompt4 = string | null;
export type Type4 = 'unknown';
export type Screenshot = string | null;
export type Thought = string | null;
export type Instruction = string | null;
export type Reason = string | null;
export type Strategy = 'vision' | 'fail';
export type Id = string;
export type Intent = string;
export type Route = KeyboardRoute | InputRoute | TapRoute | ActRoute | WaitRoute | ManualReviewRoute;
export type Keyname = string;
export type Strategy1 = 'keyboard';
export type Inputmethod = 'keyboard-action' | null;
export type Locateprompt1 = string;
export type Mode = ('replace' | 'append' | 'typeOnly') | null;
export type Prompt5 = string;
export type Strategy2 = 'input';
export type Value1 = string;
export type Prompt6 = string;
export type Strategy3 = 'tap';
export type Prompt7 = string;
export type Strategy4 = 'act';
export type Condition1 = string;
export type Prompt8 = string | null;
export type Strategy5 = 'wait';
export type Timeoutms = number | null;
export type Reason1 = string;
export type Strategy6 = 'manual-review';
export type Rawaction = string | null;
export type Stepindex = number;
export type Timestampsec = number | null;
export type Recordedgapms = number | null;
export type Waitbeforems = number | null;
export type Waitreason = ('recorded-step-gap' | 'manual-calibration') | null;
export type Steps = MidsceneFlowStep[];
export type Resolvedat = string;
export type Schemaversion1 = '0.1';
export type Appliedoverridesteps = string[];
export type Baseflowfingerprint = string;
export type Baseflowpath = string;
export type Overridespath = string;
export type Projectconfigpath = string;

export interface ResolvedFlowSnapshot {
  flow: MidsceneFlow;
  inputs: Inputs;
  resolvedAt: Resolvedat;
  schemaVersion: Schemaversion1;
  sources: ResolvedFlowSources;
}
export interface MidsceneFlow {
  commands?: MidsceneFlowCommands | null;
  goal: Goal;
  project: Project;
  schemaVersion: Schemaversion;
  source: MidsceneFlowSource;
  steps: Steps;
}
export interface MidsceneFlowCommands {
  flowExecution?: Flowexecution;
  recordingPreparation?: Recordingpreparation;
  traceGeneration?: Tracegeneration;
  traceToFlowConversion: Tracetoflowconversion;
}
export interface MidsceneFlowSource {
  processedLogPath?: Processedlogpath;
  processedLogWithScreenshotsPath?: Processedlogwithscreenshotspath;
  screenshotsDir?: Screenshotsdir;
  tracePath: Tracepath;
}
export interface MidsceneFlowStep {
  evidence: MidsceneFlowEvidence;
  fallback: MidsceneFlowFallback;
  id: Id;
  intent: Intent;
  route: Route;
  sourceTrace: MidsceneFlowSourceTrace;
  timing?: MidsceneFlowTiming | null;
}
export interface MidsceneFlowEvidence {
  action: Action;
  crop?: Crop;
  expectation?: Expectation;
  observation: Observation;
  operation?: Operation;
  screenshot?: Screenshot;
  thought?: Thought;
}
export interface TraceClickOperation {
  prompt: Prompt;
  type: Type;
}
export interface TraceInputOperation {
  locatePrompt?: Locateprompt;
  prompt: Prompt1;
  type: Type1;
  value: Value;
}
export interface TraceKeyboardOperation {
  key: Key;
  prompt?: Prompt2;
  type: Type2;
}
export interface TraceWaitOperation {
  condition: Condition;
  prompt?: Prompt3;
  type: Type3;
}
export interface TraceUnknownOperation {
  prompt?: Prompt4;
  type: Type4;
}
export interface MidsceneFlowFallback {
  instruction?: Instruction;
  reason?: Reason;
  strategy: Strategy;
}
export interface KeyboardRoute {
  keyName: Keyname;
  strategy: Strategy1;
}
export interface InputRoute {
  inputMethod?: Inputmethod;
  locatePrompt: Locateprompt1;
  mode?: Mode;
  prompt: Prompt5;
  strategy: Strategy2;
  value: Value1;
}
export interface TapRoute {
  prompt: Prompt6;
  strategy: Strategy3;
}
export interface ActRoute {
  prompt: Prompt7;
  strategy: Strategy4;
}
export interface WaitRoute {
  condition: Condition1;
  prompt?: Prompt8;
  strategy: Strategy5;
  timeoutMs?: Timeoutms;
}
export interface ManualReviewRoute {
  reason: Reason1;
  strategy: Strategy6;
}
export interface MidsceneFlowSourceTrace {
  rawAction?: Rawaction;
  stepIndex: Stepindex;
  timestampSec?: Timestampsec;
}
export interface MidsceneFlowTiming {
  recordedGapMs?: Recordedgapms;
  waitBeforeMs?: Waitbeforems;
  waitReason?: Waitreason;
}
export interface Inputs {
  [k: string]: string;
}
export interface ResolvedFlowSources {
  appliedOverrideSteps: Appliedoverridesteps;
  baseFlowFingerprint: Baseflowfingerprint;
  baseFlowPath: Baseflowpath;
  overridesPath: Overridespath;
  projectConfigPath: Projectconfigpath;
}
