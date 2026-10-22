import { randomUUID } from 'node:crypto';
import type { RecorderControl } from './windows-recorder.js';
import { prepareRecording } from './prepare-recording.js';
import type { RecordingProgress, RecordingResult } from '../shared/recording.js';

const messages: Record<RecordingProgress['data']['phase'], string> = {
  armed: '已启动录制悬浮条，等待用户开始', recording: '用户正在录制操作',
  received: '录制已收到，正在处理操作记录', processing: '正在整理操作记录',
  extracting: '正在提取步骤截图', completed: '操作资产已准备完成',
  cancelled: '用户取消了录制', failed: '录制资产处理失败',
};

export class ConversationRecordingService {
  private busy = false;

  constructor(
    private readonly recorder: RecorderControl,
    private readonly executionRoot: string,
    private readonly prepare: typeof prepareRecording = prepareRecording,
  ) {}

  async run(
    goal: string, signal: AbortSignal, emit: (event: RecordingProgress) => void, id: string = randomUUID(),
  ): Promise<RecordingResult> {
    if (!goal.trim()) throw new Error('录制目标不能为空');
    if (this.busy) throw Object.assign(new Error('已有普通录制正在进行'), { statusCode: 409 });
    const { primaryDisplay, waitForResult, abort, subscribe } = this.recorder;
    if (!primaryDisplay || !waitForResult || !abort || !subscribe) throw new Error('录制服务不支持对话录制');
    this.busy = true;
    const notify = (phase: RecordingProgress['data']['phase']) => {
      emit({ type: 'recording.progress', message: messages[phase], data: { source: 'recorder', phase } });
    };
    let owned = false;
    const cancel = () => { if (owned) void this.recorder.abort!(id).catch(() => undefined); };
    let unsubscribe = () => {};
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      const display = await this.recorder.primaryDisplay!();
      signal.throwIfAborted();
      unsubscribe = this.recorder.subscribe!((status) => {
        if (status.phase === 'armed' || status.phase === 'recording') notify(status.phase);
      });
      owned = true;
      await this.recorder.start(display, id);
      if (signal.aborted) await this.recorder.abort!(id);
      signal.throwIfAborted();
      const result = await this.recorder.waitForResult!(id);
      signal.throwIfAborted();
      return await this.finish(result, signal, notify);
    } catch (error) {
      if (owned) await this.recorder.abort!(id).catch(() => undefined);
      notify('failed');
      return { status: 'failed', message: '录制处理失败，未生成完整操作资产', assets: null,
        error: error instanceof Error ? error.message : String(error) };
    } finally {
      signal.removeEventListener('abort', cancel);
      unsubscribe();
      this.busy = false;
    }
  }

  private async finish(
    result: Awaited<ReturnType<NonNullable<RecorderControl['waitForResult']>>>,
    signal: AbortSignal, notify: (phase: RecordingProgress['data']['phase']) => void,
  ): Promise<RecordingResult> {
    if (result.status === 'failed') throw new Error(result.error);
    if (result.status === 'cancelled') {
      notify('cancelled');
      return { status: 'cancelled', message: '用户取消了录制，本次未生成操作资产',
        assets: null, reason: result.reason };
    }
    const received = result.completedAt ?? Date.now();
    notify('received');
    const started = Date.now();
    const assets = await this.prepare(result.recordingPath, this.executionRoot, signal, (phase) => {
      if (phase === 'processing' || phase === 'extracting') notify(phase);
    });
    notify('completed');
    return { status: 'completed', message: '录制已完成，操作记录与截图已准备好',
      recordingId: result.recordingId, assets,
      timingsMs: { receivedToPrepare: Math.max(0, started - received) } };
  }
}
