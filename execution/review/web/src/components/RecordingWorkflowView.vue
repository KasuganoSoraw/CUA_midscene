<script setup lang="ts">
import { recordingProgress } from '../recording-progress';
import copyIcon from '../assets/ucd/record-copy.svg';
import importantIcon from '../assets/ucd/record-important.svg';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import App from '../App.vue';
import RecordingWorkspace from './RecordingWorkspace.vue';
import { api, request } from '../api';
import { useI18n } from '../i18n';
import type { RecordingCard } from '../../../shared/recording-cards';
import type { WorkflowStatus } from '../../../shared/workflow';
const props = defineProps<{ card: RecordingCard }>();
const { locale } = useI18n();
const status = ref<WorkflowStatus>();
const error = ref('');
const actionBusy = ref(false);
const recording = ref(false);
const result = ref<{ name: string; description: string; content: string }>();
const copyState = ref('');
const invocation = computed(() => result.value ? `[${result.value.name}](skill://${result.value.name}) 请执行该任务` : '');
const root = `/api/recording-cards/${encodeURIComponent(props.card.id)}`;
let poll: ReturnType<typeof setInterval> | undefined;
let fetching = false;
let disposed = false;
const renderedContent = computed(() =>
  DOMPurify.sanitize(marked.parse((result.value?.content ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''), { async: false }) as string),
);
const phase = computed(() => (recording.value ? 'idle' : (status.value?.phase ?? 'idle')));
const activeStep = computed(() => (['idle'].includes(phase.value) ? 1 : phase.value === 'done' ? 3 : 2));
const displayLog = computed(() => (status.value?.log ?? '').replace(/^CUA_TRACE_PROGRESS .*\r?\n?/gm, ''));
const progress = computed(() => recordingProgress(status.value?.log ?? ''));
const running = computed(() => ['analyzing', 'publishing'].includes(phase.value));
async function refresh(): Promise<void> {
  if (fetching || disposed) return;
  fetching = true;
  try {
    const next = await request<WorkflowStatus>(`${root}/workflow`);
    if (disposed) return;
    status.value = next;
    if (next.phase === 'done' && !result.value) result.value = await request(`${root}/result`);
  } catch (cause) {
    error.value = String(cause instanceof Error ? cause.message : cause);
  } finally {
    fetching = false;
  }
}
async function action(name: 'analyze' | 'publish' | 'stop'): Promise<void> {
  actionBusy.value = true;
  error.value = '';
  recording.value = false;
  try {
    status.value = await request<WorkflowStatus>(`${root}/${name}`, {
      method: 'POST',
      ...(name === 'analyze' ? { body: JSON.stringify({ language: locale.value }) } : {}),
    });
    result.value = undefined;
    await refresh();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    actionBusy.value = false;
  }
}
async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(invocation.value);
    copyState.value = '已复制运行指令';
  } catch {
    copyState.value = '复制失败，请手动选择内容复制';
  }
}
onMounted(async () => {
  await refresh();
  poll = setInterval(() => {
    if (running.value) void refresh();
  }, 1000);
});
onUnmounted(() => {
  disposed = true;
  if (poll) clearInterval(poll);
});
</script>
<template>
  <section class="recording-workflow">
    <nav class="workflow-stepper" aria-label="创建技能阶段">
      <span
        v-for="(label, index) in ['流程录制', '技能编辑', '技能生成']"
        :key="label"
        :class="{ current: activeStep === index + 1, complete: activeStep > index + 1 }"
        :aria-current="activeStep === index + 1 ? 'step' : undefined"
        ><i>{{ activeStep > index + 1 ? '✓' : index + 1 }}</i
        >{{ label }}</span
      >
    </nav>
    <p v-if="error" class="console-error" role="alert">{{ error }}</p>
    <p v-if="!status" class="catalog-feedback">正在加载流程…</p>
    <RecordingWorkspace
      v-else-if="phase === 'idle'"
      :key="card.id"
      :card-id="card.id"
      :recording-id="card.recordingId"
      :skills-configured="true"
      @analyze="action('analyze')"
    />
    <template v-else-if="running || phase === 'failed' || phase === 'stopped'">
      <section class="workflow-progress-panel">
        <h2>任务进度</h2>
        <div
          class="workflow-progress-message"
          :class="{ failed: phase === 'failed', stopped: phase === 'stopped' }"
          :role="running ? 'status' : 'alert'"
        >
          <div v-if="running" class="workflow-progress-bar" :class="{ indeterminate: !progress || phase !== 'analyzing' }" role="progressbar" aria-label="任务生成进度" :aria-valuemin="0" :aria-valuemax="progress?.total" :aria-valuenow="phase === 'analyzing' ? progress?.completed : undefined"><span :style="progress && phase === 'analyzing' ? { width: `${progress.completed / progress.total * 100}%` } : undefined"></span></div>
          <h3>
            {{
              phase === 'analyzing'
                ? '正在生成任务'
                : phase === 'publishing'
                  ? '正在打包并导入技能'
                  : phase === 'stopped'
                    ? '任务已停止'
                    : '任务失败'
            }}
          </h3>
          <p v-if="running">
            {{
              phase === 'analyzing'
                ? '正在处理录制并创建可运行任务，请勿关闭页面。'
                : '正在通过宿主导入编辑后的技能，请等待导入确认。'
            }}
          </p>
          <p v-if="status?.error">{{ status.error }}</p>
          <pre v-if="displayLog">{{ displayLog }}</pre>
        </div>
      </section>
      <div class="workflow-footer">
        <template v-if="!running"
          ><button class="secondary" @click="recording = true">返回录制</button
          ><button v-if="status?.skillName" class="secondary" @click="status.phase = 'editing'">返回编辑</button
          ><button class="primary" :disabled="actionBusy" @click="action(status?.skillName ? 'publish' : 'analyze')">
            再次尝试
          </button></template
        ><button v-else-if="phase === 'analyzing'" class="secondary" :disabled="actionBusy" @click="action('stop')">
          停止任务
        </button>
      </div>
    </template>
    <App v-else-if="phase === 'editing'" :draft-card-id="card.id" :draft-task-title="card.name" @publish="action('publish')" />
    <template v-else-if="phase === 'done' && result">
      <div class="workflow-result-copy">
        <span>复制到对话即可运行</span>
        <div class="workflow-command"><code>{{ invocation }}</code><button class="workflow-copy-icon" aria-label="复制运行指令" title="复制运行指令" @click="copy"><img :src="copyIcon" alt="" /></button></div>
        <small role="status">{{ copyState }}</small>
      </div>
      <article class="workflow-result-card">
        <span class="card-avatar purple">S</span>
        <div>
          <h2>{{ result.name }}</h2>
          <p>{{ result.description }}</p>
        </div>
        <span class="workflow-imported">已导入</span>
      </article>
      <h2 class="workflow-content-label"><img :src="importantIcon" alt="必填" />内容</h2>
      <article class="workflow-skill-content" v-html="renderedContent"></article>
    </template>
  </section>
</template>
