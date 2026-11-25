import type { RecordingCardStore } from './recording-cards.js';
import type { RecordingCard, RecordingCardInput } from '../shared/recording-cards.js';
import type { WorkflowStatus } from '../shared/workflow.js';

interface AssociationOptions {
  input: RecordingCardInput;
  recordings: Set<string>;
  cards: RecordingCardStore;
  workflows: WorkflowStatus[];
  write: (status: WorkflowStatus) => void;
  removeWorkflow: (id: string) => void;
}

function matchingWorkflow(options: AssociationOptions, cards: RecordingCard[]): WorkflowStatus | undefined {
  const rows = options.workflows.filter(row => row.skillName === options.input.name || row.pendingSkillName === options.input.name);
  const live = rows.filter(row => cards.some(card => card.id === row.cardId));
  if (live.length > 1) throw new Error('同一 Skill 对应多张任务卡片，无法自动确定关联');
  const available = rows.filter(row => options.recordings.has(row.recordingId));
  if (new Set(available.map(row => row.recordingId)).size > 1) {
    throw new Error('同一 Skill 存在多个录制资产关联，无法自动确定来源');
  }
  return available.find(row => live.includes(row)) ?? available[0] ?? live[0] ?? rows[0];
}

function associatedCard(options: AssociationOptions, cards: RecordingCard[], row?: WorkflowStatus): RecordingCard | undefined {
  if (!row) return;
  const live = options.workflows.find(candidate =>
    (candidate.skillName === options.input.name || candidate.pendingSkillName === options.input.name)
    && cards.some(card => card.id === candidate.cardId));
  const card = cards.find(item => item.id === (live?.cardId ?? row.cardId));
  const recorded = cards.find(item => item.recordingId === row.recordingId && options.recordings.has(row.recordingId));
  if (card && recorded && card.id !== recorded.id) {
    throw new Error('录制资产已属于另一张卡片，保留原数据，请先确认关联');
  }
  return card ?? recorded;
}

export function associateSkillCard(options: AssociationOptions): { created: boolean; warnings: string[] } {
  const cards = options.cards.all();
  const row = matchingWorkflow(options, cards);
  const existing = associatedCard(options, cards, row);
  const card = existing ?? options.cards.create(options.input, row?.cardId);
  try {
    if (row?.recordingId && options.recordings.has(row.recordingId) && !card.recordingId) {
      options.cards.associateRecording(card.id, row.recordingId);
    }
    if (!row) {
      options.write({ cardId: card.id, recordingId: '', phase: 'done', skillName: options.input.name,
        draftRoot: '', error: '', log: '' });
    } else if (row.cardId !== card.id) {
      options.write({ ...row, cardId: card.id });
      if (!cards.some(item => item.id === row.cardId)) options.removeWorkflow(row.cardId);
    }
  } catch (error) {
    if (!existing) options.cards.remove(card.id);
    throw error;
  }
  return { created: !existing, warnings: [] };
}
