import { loadPublishedSkillResult } from './review-skill.js';
import type { WorkflowResult } from '../shared/workflow.js';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { withSkillWriteLock } from '../../cua/skills/lock.js';
import { Writable } from 'node:stream';
import type { RecordingCardStore } from './recording-cards.js';
import type { WorkflowStatus } from '../shared/workflow.js';
import type { GenerationLanguage } from '../shared/types.js';
import { prepareRecordingSkill, publishRecordingDraft } from '../../cua/skills/create.js';
import { describeRecording, resolveRecordingDirectory, openRecordingDirectory } from '../../cua/recording/recording-catalog.js';
import { JsonStore } from './json-store.js';

interface WorkflowState {
  workflows: Record<string, WorkflowStatus>;
}

export class RecordingWorkflow {
  private readonly store: JsonStore<WorkflowState>;
  private active?: { id: string; controller: AbortController; completion: Promise<void> };
  constructor(
    private readonly options: {
      dataRoot: string;
      skillsRoot?: string;
      recordingsRoot?: string;
      executionRoot?: string;
      beforeAnalyze?: () => void;
      cards: RecordingCardStore;
    },
    private readonly dependencies: {
      prepare?: typeof prepareRecordingSkill;
      publish?: typeof publishRecordingDraft;
    } = {},
  ) {
    this.store = new JsonStore(
      path.join(options.dataRoot, 'workbench', 'workflows.json'),
      () => ({ workflows: {} }),
    );
    // 进程重启后，之前处于进行中的任务已不可能完成，标记为失败。
    this.store.update((state) => {
      for (const status of Object.values(state.workflows)) {
        if (status.phase === 'analyzing' || status.phase === 'publishing') {
          status.phase = 'failed';
          status.error = '服务重启，处理已中断，请检查后重试';
        }
      }
    });
  }
  status(id: string): WorkflowStatus {
    const card = this.options.cards.get(id);
    const row = this.store.value.workflows[id];
    if (row && row.recordingId === card.recordingId) return { ...row };
    return {
      cardId: id,
      recordingId: card.recordingId ?? '',
      phase: 'idle',
      skillName: '',
      draftRoot: '',
      error: '',
      log: '',
    };
  }
  async result(id: string): Promise<WorkflowResult> {
    const status = this.status(id);
    if (status.phase !== 'done') throw new Error('技能尚未完成导入');
    if (!this.options.skillsRoot) throw new Error('请配置 CUA_SKILLS_ROOT');
    return loadPublishedSkillResult(this.options.skillsRoot, status.skillName);
  }
  async openInstallDirectory(id: string, openDirectory = openRecordingDirectory) {
    const result = await this.result(id);
    const opened = await openDirectory(result.installPath);
    return { opened: true as const, ...opened, serverPid: process.pid };
  }
  busyRecording(id: string): boolean {
    return !!this.active && this.status(this.active.id).recordingId === id;
  }
  isBusy(): boolean {
    return !!this.active;
  }
  private write(value: WorkflowStatus): void {
    this.store.update((state) => {
      state.workflows[value.cardId] = { ...value };
    });
  }
  async analyze(id: string, language: GenerationLanguage): Promise<WorkflowStatus> {
    if (this.active) throw Object.assign(new Error('已有任务正在处理'), { statusCode: 409 });
    this.options.beforeAnalyze?.();
    const card = this.options.cards.get(id);
    if (!card.recordingId || !this.options.skillsRoot) throw new Error('需要完整录制并配置 CUA_SKILLS_ROOT');
    const entry = await describeRecording(card.recordingId, this.options);
    if (!entry.ready) throw new Error(entry.errors.join('\n'));
    const recording = await resolveRecordingDirectory(card.recordingId, this.options);
    const exportRoot = path.join(this.options.dataRoot, 'workbench', 'drafts');
    await mkdir(exportRoot, { recursive: true });
    const draftRoot = await mkdtemp(path.join(exportRoot, 'draft-'));
    if (this.active) throw Object.assign(new Error('已有任务正在处理'), { statusCode: 409 });
    if (this.options.cards.get(id).recordingId !== card.recordingId) throw new Error('录制关联已更新，请重新开始分析');
    const status: WorkflowStatus = {
      cardId: id,
      recordingId: card.recordingId,
      phase: 'analyzing',
      skillName: '',
      draftRoot,
      error: '',
      log: '',
    };
    this.options.beforeAnalyze?.();
    this.write(status);
    const controller = new AbortController();
    const progress = this.progressStream(status);
    const completion = this.run(
      status,
      async () => {
        status.skillName = await (this.dependencies.prepare ?? prepareRecordingSkill)({
          ...this.options,
          skillsRoot: this.options.skillsRoot!,
          recording,
          draftRoot,
          language,
          progress,
          signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        await this.synchronize(status);
      },
      controller.signal,
    );
    this.active = { id, controller, completion };
    return this.status(id);
  }
  private progressStream(status: WorkflowStatus): Writable {
    return new Writable({ write: (chunk, _encoding, callback) => {
      status.log = (status.log + chunk.toString()).slice(-32768);
      this.write(status);
      callback();
    } });
  }
  async publish(id: string): Promise<WorkflowStatus> {
    if (this.active) throw Object.assign(new Error('已有任务正在处理'), { statusCode: 409 });
    const status = this.status(id);
    if (!status.skillName || !['editing', 'failed'].includes(status.phase)) throw new Error('没有可发布的编辑草稿');
    if (!this.options.skillsRoot) throw new Error('请配置 CUA_SKILLS_ROOT');
    status.phase = 'publishing';
    status.error = '';
    this.write(status);
    const controller = new AbortController();
    const completion = this.run(
      status,
      () => this.synchronize(status),
      controller.signal,
    );
    this.active = { id, controller, completion };
    return this.status(id);
  }
  private async synchronize(status: WorkflowStatus): Promise<void> {
    status.phase = 'publishing';
    status.log += '\n录制分析完成，正在打包并同步到 GDE Skill，请等待导入确认。\n';
    this.write(status);
    await withSkillWriteLock(status.draftRoot, status.skillName, () => (this.dependencies.publish ?? publishRecordingDraft)({
      ...status, skillsRoot: this.options.skillsRoot!, executionRoot: this.options.executionRoot,
    }));
    await loadPublishedSkillResult(this.options.skillsRoot!, status.skillName);
    status.log += `技能 ${status.skillName} 已同步到 GDE，正式 Skill 资源校验完成。\n`;
    status.phase = 'done';
  }
  private async run(status: WorkflowStatus, work: () => Promise<void>, signal: AbortSignal): Promise<void> {
    try {
      await work();
    } catch (error) {
      status.phase = signal.aborted ? 'stopped' : 'failed';
      status.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.write(status);
      this.active = undefined;
    }
  }
  async stop(id: string): Promise<WorkflowStatus> {
    if (this.active?.id !== id) return this.status(id);
    if (this.status(id).phase !== 'analyzing') throw new Error('宿主导入中不能中止，请等待确认结果');
    this.active.controller.abort();
    const completion = this.active.completion;
    await completion;
    return this.status(id);
  }
  draft(id: string, writable = false): WorkflowStatus {
    const status = this.status(id);
    if (!status.skillName || !status.draftRoot) throw new Error('草稿尚未就绪');
    if (writable && !['editing', 'failed'].includes(status.phase)) throw new Error('当前状态不能编辑草稿');
    return status;
  }
  async close(): Promise<void> {
    if (this.active && this.status(this.active.id).phase === 'analyzing') this.active.controller.abort();
    await this.active?.completion;
  }
}
