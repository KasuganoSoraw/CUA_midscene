import type {
  JsonObject,
  SceneCatalogItem,
  TaskCatalogItem,
  TaskInputDefinition,
  TaskManifest,
} from '../../cua/contracts/types.js';

export type ReviewOrigin = 'builtin' | 'user';
export type ReviewOperation = 'click' | 'doubleClick' | 'input' | 'keyboard' | 'wait';

export interface ReviewServerIdentity {
  service: string;
  protocolVersion: number;
  dataRootKey: string;
  devMode: boolean;
}

export interface ReviewEvidence {
  sourceStep: number;
  timestamp: number;
  full?: string;
  crop?: string;
  reference?: string;
}

export interface ReviewReferenceImage {
  name: string;
  url: string;
}

export interface ReviewStep {
  id: string;
  name: string;
  operation: ReviewOperation;
  flow: JsonObject[];
  input?: TaskInputDefinition;
  evidence?: ReviewEvidence;
  referenceImages?: ReviewReferenceImage[];
}

export interface ReviewTaskDraft {
  manifest: TaskManifest;
  document: JsonObject;
}

export interface ReviewTaskView extends ReviewTaskDraft {
  scene: string;
  task: string;
  title: string;
  description: string;
  origin: ReviewOrigin;
  writable: boolean;
  revision: string;
  steps: ReviewStep[];
}

export type ReviewMutation =
  | {
      type: 'insert';
      index: number;
      step: { operation: ReviewOperation; flow: JsonObject[]; input?: TaskInputDefinition };
    }
  | { type: 'remove'; index: number }
  | { type: 'move'; from: number; to: number }
  | {
      type: 'update';
      index: number;
      step: { operation?: ReviewOperation; flow?: JsonObject[]; input?: TaskInputDefinition | null };
    };

export interface ReviewChange {
  kind: ReviewMutation['type'];
  summary: string;
  details: string[];
}

export interface ReviewMutationResult {
  draft: ReviewTaskDraft;
  change: ReviewChange;
}

export interface SaveReviewTaskRequest extends ReviewTaskDraft {
  expectedRevision: string;
}

export interface SaveReviewTaskResult {
  revision: string;
  changed: Array<'task.yaml' | 'task.json'>;
}

export interface ReviewCatalogResponse {
  scenes: SceneCatalogItem[];
}

export interface ReviewTaskListResponse {
  scene: string;
  tasks: TaskCatalogItem[];
}

export interface ReviewRecordingFile {
  name: string;
  size: number;
}

export interface ReviewRecording {
  id: string;
  ready: boolean;
  errors: string[];
  video?: ReviewRecordingFile;
  eventLog?: ReviewRecordingFile;
  startedAt?: string;
  screen?: {
    width: number;
    height: number;
    scaleFactor?: number;
  };
}

export interface ReviewRecordingCatalog {
  configured: boolean;
  envName: string;
  recordings: ReviewRecording[];
}

export interface CreateRecordingTaskRequest {
  scene: string;
  task: string;
  goal?: string;
}

export interface CreateRecordingTaskResult {
  created: true;
  valid: true;
  scene: string;
  task: string;
  goal: string;
}

export type RecorderPhase = 'idle' | 'arming' | 'armed' | 'starting' | 'recording' | 'stopping' | 'failed';

export interface RecorderStatus {
  phase: RecorderPhase;
  outputRoot?: string;
  recordingId?: string;
  startedAt?: string;
  hotkey?: string;
  error?: string;
}

export interface RecorderDisplay {
  id: string;
  deviceName: string;
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
  previewUrl: string;
}

export interface RecorderDisplaysResult {
  displays: RecorderDisplay[];
  revision: string;
}

export interface StartRecorderRequest {
  displayId: string;
}

export type TaskExecutionMode = 'task' | 'act';
export type TaskExecutionPhase =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'stopping'
  | 'succeeded'
  | 'failed';

export interface StartTaskExecutionRequest {
  scene: string;
  task: string;
  mode: TaskExecutionMode;
  inputs: Record<string, string>;
}

export interface TaskExecutionResultSummary {
  runDir?: string;
  resolvedTaskPath?: string;
  executor?: JsonObject;
}

export interface TaskExecutionStatus {
  phase: TaskExecutionPhase;
  scene?: string;
  task?: string;
  mode?: TaskExecutionMode;
  preparedAt?: string;
  startsAt?: string;
  startedAt?: string;
  finishedAt?: string;
  result?: TaskExecutionResultSummary;
  error?: string;
}
