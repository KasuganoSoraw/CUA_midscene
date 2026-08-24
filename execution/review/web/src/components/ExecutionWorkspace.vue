<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type {
  SceneCatalogItem,
  TaskCatalogItem,
  TaskCatalogReadyItem,
} from '../../../../cua/contracts/types';
import type {
  TaskExecutionMode,
  TaskExecutionStatus,
} from '../../../shared/types';
import { api } from '../api';
import ReviewSelect, { type ReviewSelectOption } from './ReviewSelect.vue';

const props = defineProps<{
  scenes: SceneCatalogItem[];
  initialScene?: string;
  initialTask?: string;
  targetVersion?: number;
}>();

const scene = ref('');
const task = ref('');
const tasks = ref<TaskCatalogItem[]>([]);
const mode = ref<TaskExecutionMode>('task');
const inputs = ref<Record<string, string>>({});
const status = ref<TaskExecutionStatus>({ phase: 'idle' });
const busy = ref(false);
const error = ref('');
const clock = ref(Date.now());
let poll: ReturnType<typeof setInterval> | undefined;

const sceneOptions = computed<ReviewSelectOption[]>(() => props.scenes.map((item) => ({
  value: item.scene,
  label: item.status === 'error' ? `${item.title}（不可用）` : item.title,
  description: item.status === 'error' ? item.error : item.description,
  disabled: item.status === 'error',
})));
const taskOptions = computed<ReviewSelectOption[]>(() => tasks.value.map((item) => ({
  value: item.task,
  label: item.status === 'error' ? `${item.title}（不可用）` : item.title,
  description: item.status === 'error' ? item.error : item.description,
  disabled: item.status === 'error',
})));
const modeOptions: ReviewSelectOption[] = [
  { value: 'task', label: '逐步执行', description: '按 task.yaml 的步骤依次运行' },
  { value: 'act', label: '整体规划', description: '将录制任务转换为一个整体 aiAct' },
];
const selectedTask = computed<TaskCatalogReadyItem | undefined>(() => {
  const selected = tasks.value.find((item) => item.task === task.value);
  return selected?.status === 'ready' ? selected : undefined;
});
const inputEntries = computed(() => Object.entries(selectedTask.value?.inputs ?? {}));
const active = computed(() => ['preparing', 'running', 'stopping'].includes(status.value.phase));
const canStart = computed(() => Boolean(scene.value && task.value && selectedTask.value && !active.value && !busy.value));
const countdown = computed(() => {
  if (status.value.phase !== 'preparing' || !status.value.startsAt) return 0;
  return Math.max(0, Math.ceil((new Date(status.value.startsAt).getTime() - clock.value) / 1000));
});
const elapsed = computed(() => {
  if (!status.value.startedAt) return '00:00';
  const end = status.value.finishedAt ? new Date(status.value.finishedAt).getTime() : clock.value;
  const seconds = Math.max(0, Math.floor((end - new Date(status.value.startedAt).getTime()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
});
const phaseLabel = computed(() => ({
  idle: '等待运行', preparing: `准备中 · ${countdown.value}s`, running: `正在运行 · ${elapsed.value}`,
  stopping: '正在停止', succeeded: `运行成功 · ${elapsed.value}`, failed: '运行未完成',
})[status.value.phase]);

function applyInputDefaults(): void {
  inputs.value = Object.fromEntries(inputEntries.value.map(([id, definition]) => [id, definition.default]));
}

async function loadTasks(preferredTask?: string): Promise<void> {
  error.value = '';
  if (!scene.value) {
    tasks.value = [];
    task.value = '';
    inputs.value = {};
    return;
  }
  busy.value = true;
  try {
    tasks.value = (await api.tasks(scene.value)).tasks;
    const candidate = preferredTask ?? task.value;
    task.value = tasks.value.some((item) => item.task === candidate && item.status === 'ready')
      ? candidate
      : tasks.value.find((item) => item.status === 'ready')?.task ?? '';
    applyInputDefaults();
  } catch (caught) {
    tasks.value = [];
    task.value = '';
    inputs.value = {};
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}

async function chooseScene(): Promise<void> {
  await loadTasks();
}

function chooseTask(): void {
  applyInputDefaults();
}

async function applyTarget(): Promise<void> {
  const requestedScene = props.initialScene;
  scene.value = props.scenes.some((item) => item.scene === requestedScene && item.status === 'ready')
    ? requestedScene!
    : props.scenes.find((item) => item.status === 'ready')?.scene ?? '';
  await loadTasks(props.initialTask);
}

async function refreshStatus(): Promise<void> {
  try {
    status.value = await api.executionStatus();
    error.value = '';
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function start(): Promise<void> {
  if (!canStart.value) return;
  busy.value = true;
  error.value = '';
  try {
    status.value = await api.startExecution({
      scene: scene.value,
      task: task.value,
      mode: mode.value,
      inputs: { ...inputs.value },
    });
    clock.value = Date.now();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    await refreshStatus();
    error.value = message;
  } finally {
    busy.value = false;
  }
}

async function stop(): Promise<void> {
  if (!active.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    status.value = await api.stopExecution();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}

watch(() => props.targetVersion, () => { void applyTarget(); });
onMounted(async () => {
  await Promise.all([applyTarget(), refreshStatus()]);
  poll = setInterval(() => {
    clock.value = Date.now();
    void refreshStatus();
  }, 1000);
});
onUnmounted(() => { if (poll) clearInterval(poll); });
</script>

<template>
  <section class="execution-console">
    <aside class="panel execution-config">
      <div class="panel-heading execution-heading">
        <div><p class="eyebrow">TASK TARGET</p><h2>选择执行任务</h2></div>
      </div>
      <div class="execution-form">
        <label>场景
          <ReviewSelect v-model="scene" aria-label="运行场景" :options="sceneOptions" :disabled="active" @change="chooseScene" />
        </label>
        <label>任务
          <ReviewSelect v-model="task" aria-label="运行任务" :options="taskOptions" :disabled="active || !scene" @change="chooseTask" />
        </label>
        <label>运行方式
          <ReviewSelect v-model="mode" aria-label="运行方式" :options="modeOptions" :disabled="active" />
        </label>
        <div class="execution-task-summary" v-if="selectedTask">
          <strong>{{ selectedTask.title }}</strong>
          <p>{{ selectedTask.description || selectedTask.goal }}</p>
          <small>{{ selectedTask.taskCount }} 个步骤 · {{ selectedTask.actionCount }} 个动作</small>
        </div>
      </div>
    </aside>

    <section class="panel execution-main">
      <div class="panel-heading execution-heading">
        <div><p class="eyebrow">RUNTIME INPUTS</p><h2>本次运行参数</h2></div>
        <span>{{ inputEntries.length }} inputs</span>
      </div>
      <div class="execution-inputs" v-if="inputEntries.length">
        <label v-for="([id, definition]) in inputEntries" :key="id">
          <span><strong>{{ definition.label }}</strong><code>{{ id }}</code></span>
          <input v-model="inputs[id]" :disabled="active" />
          <small v-if="definition.description">{{ definition.description }}</small>
        </label>
      </div>
      <div v-else class="execution-empty">
        {{ selectedTask ? '这个任务没有运行时参数，可以直接准备运行。' : '请先选择一个可用任务。' }}
      </div>

      <div class="execution-notice">
        <strong>执行会直接操作当前 Windows 桌面</strong>
        <p>点击准备后有 5 秒切换到目标初始界面。首版不限制录制器同时运行，请不要在任务执行期间启动录制或手动操作鼠标键盘。</p>
      </div>

      <div v-if="error" class="execution-error">{{ error }}</div>
      <div class="execution-actions">
        <span>运行时参数只用于本次执行，不会写回任务。</span>
        <button v-if="active" class="danger execution-stop" :disabled="busy || status.phase === 'stopping'" @click="stop">
          {{ status.phase === 'preparing' ? '取消准备' : status.phase === 'stopping' ? '正在停止…' : '停止任务' }}
        </button>
        <button v-else class="primary" :disabled="!canStart" @click="start">准备运行</button>
      </div>
    </section>

    <aside class="panel execution-status" :class="`phase-${status.phase}`">
      <div class="execution-status-mark"><span></span></div>
      <p class="eyebrow">EXECUTION STATUS</p>
      <h2>{{ phaseLabel }}</h2>
      <p v-if="status.scene">{{ status.scene }} / {{ status.task }}</p>
      <div v-if="status.phase === 'preparing'" class="countdown">{{ countdown }}</div>
      <p v-else-if="status.phase === 'running' || status.phase === 'stopping'" class="elapsed">{{ elapsed }}</p>
      <p v-if="status.phase === 'succeeded'" class="execution-success">任务执行已成功完成。</p>
      <p v-if="status.error" class="execution-error status-error">{{ status.error }}</p>
      <div v-if="status.result?.runDir" class="execution-result">
        <small>RUN DIRECTORY</small>
        <code :title="status.result.runDir">{{ status.result.runDir }}</code>
      </div>
      <small v-if="status.phase === 'running'">执行器可能长时间无输出；这里显示的时间来自真实进程状态。</small>
    </aside>
  </section>
</template>
