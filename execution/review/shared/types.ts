import type { JsonObject, TaskInputDefinition, TaskManifest } from '../../cua/contracts/types.js';

export type ReviewOrigin = 'builtin' | 'user';
export type ReviewOperation = 'click' | 'doubleClick' | 'input' | 'keyboard' | 'wait';

export interface ReviewEvidence {
  sourceStep: number;
  timestamp: number;
  full?: string;
  crop?: string;
  context?: boolean;
  fromStepId?: string;
}

export interface ReviewStep {
  id: string;
  name: string;
  operation: ReviewOperation;
  flow: JsonObject[];
  input?: TaskInputDefinition;
  evidence?: ReviewEvidence;
  contextEvidence?: ReviewEvidence;
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
  scenes: JsonObject[];
}

export interface ReviewTaskListResponse {
  scene: string;
  tasks: JsonObject[];
}
