export type WorkflowPhase = 'idle' | 'analyzing' | 'editing' | 'publishing' | 'done' | 'failed' | 'stopped';
export interface WorkflowStatus {
  cardId: string;
  recordingId: string;
  phase: WorkflowPhase;
  skillName: string;
  draftRoot: string;
  error: string;
  log: string;
}

export interface WorkflowResult {
  name: string;
  description: string;
  content: string;
  installPath: string;
  origin: 'user';
  version?: string;
}
