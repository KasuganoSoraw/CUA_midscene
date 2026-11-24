export type WorkflowPhase = 'idle' | 'analyzing' | 'editing' | 'publishing' | 'done' | 'failed' | 'stopped';
export interface WorkflowStatus {
  cardId: string;
  recordingId: string;
  phase: WorkflowPhase;
  skillName: string;
  pendingSkillName?: string;
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


export function generatedSkillName(status?: WorkflowStatus): string {
  return status?.pendingSkillName ?? status?.skillName ?? '';
}
