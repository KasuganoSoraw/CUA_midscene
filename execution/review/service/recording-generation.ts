import type {
  CreateRecordingTaskRequest,
  CreateRecordingTaskResult,
  RecordingGenerationStatus,
} from '../shared/types.js';

export class RecordingGenerationManager {
  private current: RecordingGenerationStatus = { phase: 'idle' };

  status(): RecordingGenerationStatus {
    return structuredClone(this.current);
  }

  start(
    recording: string,
    request: CreateRecordingTaskRequest,
    generate: () => Promise<CreateRecordingTaskResult>,
  ): RecordingGenerationStatus {
    if (this.current.phase === 'running') {
      throw Object.assign(new Error('已有任务正在生成，请等待完成'), { statusCode: 409 });
    }
    this.current = {
      phase: 'running', recording, request: structuredClone(request),
      startedAt: new Date().toISOString(),
    };
    const started = this.status();
    void this.run(generate);
    return started;
  }

  private async run(generate: () => Promise<CreateRecordingTaskResult>): Promise<void> {
    try {
      const result = await generate();
      this.current = { ...this.current, phase: 'succeeded', result, finishedAt: new Date().toISOString() };
    } catch (error) {
      this.current = {
        ...this.current, phase: 'failed', finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
