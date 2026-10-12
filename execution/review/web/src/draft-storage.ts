import type { ReviewChange, ReviewTaskDraft } from '../../shared/types.js';
import type { StepEditorModel } from '../../shared/step-editor.js';

export interface StoredReviewDraft {
  version: 1;
  revision: string;
  draft: ReviewTaskDraft;
  changes: ReviewChange[];
  selected: number;
  editor: StepEditorModel;
  editors?: Record<string, StepEditorModel>;
}

export class ReviewDraftStorage {
  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
    private readonly dataRootKey: string,
  ) {}

  private key(scene: string, task: string): string {
    return `cua-review-draft:${this.dataRootKey}:${encodeURIComponent(scene)}:${encodeURIComponent(task)}`;
  }

  read(scene: string, task: string): StoredReviewDraft | undefined {
    const raw = this.storage.getItem(this.key(scene, task));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as StoredReviewDraft;
    if (
      value.version !== 1 || typeof value.revision !== 'string'
      || !value.draft?.manifest || !Array.isArray(value.draft?.document?.tasks)
      || !Array.isArray(value.changes) || !Number.isInteger(value.selected)
      || !value.editor || !Array.isArray(value.editor.referenceImages)
    ) throw new Error('本地草稿格式无法读取');
    return value;
  }

  write(scene: string, task: string, value: StoredReviewDraft): void {
    this.storage.setItem(this.key(scene, task), JSON.stringify(value));
  }

  remove(scene: string, task: string): void {
    this.storage.removeItem(this.key(scene, task));
  }
}
