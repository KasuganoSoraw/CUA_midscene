export interface RecordingCard {
  id: string;
  name: string;
  description: string;
  recordingId: string | null;
  skillName?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface RecentRecordingCard extends RecordingCard {
  lastVisitedAt: string;
}
export interface RecordingCardPage {
  cards: RecordingCard[];
  total: number;
  page: number;
  pageSize: number;
}
export interface RecordingCardInput {
  name: string;
  description: string;
}

export interface RecordingCardSyncResult {
  synced: true;
  importedSkills: number;
  warnings: string[];
}
