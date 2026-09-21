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
import { useI18n } from '../i18n';
import ReviewSelect, { type ReviewSelectOption } from './ReviewSelect.vue';

const { t } = useI18n();

const props = defineProps<{
  scenes: SceneCatalogItem[];
  initialScene?: string;
  initialTask?: string;
  targetVersion?: number;
  developerMode?: boolean;
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
  label: item.status === 'error' ? `${item.title} (${t('common.unavailable')})` : item.title,
  description: item.status === 'error' ? item.error : item.description,
  disabled: item.status === 'error',
})));
const taskOptions = computed<ReviewSelectOption[]>(() => tasks.value.map((item) => ({
  value: item.task,
  label: item.status === 'error' ? `${item.title} (${t('common.unavailable')})` : item.title,
  description: item.status === 'error' ? item.error : item.description,
  disabled: item.status === 'error',
})));
const modeOptions = computed<ReviewSelectOption[]>(() => [
  { value: 'task', label: t('execution.stepMode'), description: t('execution.stepModeHelp') },
  { value: 'act', label: t('execution.adaptiveMode'), description: t('execution.adaptiveModeHelp') },
]);
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
  idle: t('execution.idle'),
  preparing: t('execution.preparing', { seconds: countdown.value }),
  running: t('execution.running', { elapsed: elapsed.value }),
  stopping: t('execution.stoppingLabel'),
  succeeded: t('execution.succeeded', { elapsed: elapsed.value }),
  failed: t('execution.failed'),
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
        <div><p class="eyebrow">{{ t('execution.target') }}</p><h2>{{ t('execution.choose') }}</h2></div>
      </div>
      <div class="execution-form">
        <label>{{ t('review.scene') }}
          <ReviewSelect v-model="scene" :aria-label="t('execution.sceneAria')" :options="sceneOptions" :disabled="active" @change="chooseScene" />
        </label>
        <label>{{ t('review.task') }}
          <ReviewSelect v-model="task" :aria-label="t('execution.taskAria')" :options="taskOptions" :disabled="active || !scene" @change="chooseTask" />
        </label>
        <label>{{ t('execution.mode') }}
          <ReviewSelect v-model="mode" :aria-label="t('execution.mode')" :options="modeOptions" :disabled="active" />
        </label>
        <div class="execution-task-summary" v-if="selectedTask">
          <strong>{{ selectedTask.title }}</strong>
          <p>{{ selectedTask.description || selectedTask.goal }}</p>
          <small>{{ t('execution.summary', { steps: t('common.steps', { count: selectedTask.taskCount }), actions: t('common.actions', { count: selectedTask.actionCount }) }) }}</small>
        </div>
      </div>
    </aside>

    <section class="panel execution-main">
      <div class="panel-heading execution-heading">
        <div><p class="eyebrow">{{ t('execution.inputs') }}</p><h2>{{ t('execution.inputs') }}</h2></div>
        <span>{{ t('common.items', { count: inputEntries.length }) }}</span>
      </div>
      <div class="execution-inputs" v-if="inputEntries.length">
        <label v-for="([id, definition]) in inputEntries" :key="id">
          <span><strong>{{ definition.label }}</strong><code v-if="developerMode">{{ id }}</code></span>
          <input v-model="inputs[id]" :disabled="active" />
          <small v-if="definition.description">{{ definition.description }}</small>
        </label>
      </div>
      <div v-else class="execution-empty">
        {{ selectedTask ? t('execution.noInputs') : t('execution.selectFirst') }}
      </div>

      <div class="execution-notice">
        <strong>{{ t('execution.warningTitle') }}</strong>
        <p>{{ t('execution.warning') }}</p>
      </div>

      <div v-if="error" class="execution-error">{{ error }}</div>
      <div class="execution-actions">
        <span>{{ t('execution.inputsEphemeral') }}</span>
        <button v-if="active" class="danger execution-stop" :disabled="busy || status.phase === 'stopping'" @click="stop">
          {{ status.phase === 'preparing' ? t('execution.cancelPrepare') : status.phase === 'stopping' ? t('execution.stopping') : t('execution.stop') }}
        </button>
        <button v-else class="primary" :disabled="!canStart" @click="start">{{ t('execution.prepare') }}</button>
      </div>
    </section>

    <aside class="panel execution-status" :class="`phase-${status.phase}`">
      <div class="execution-status-mark"><span></span></div>
      <p class="eyebrow">{{ t('execution.status') }}</p>
      <h2>{{ phaseLabel }}</h2>
      <p v-if="status.scene">{{ status.scene }} / {{ status.task }}</p>
      <div v-if="status.phase === 'preparing'" class="countdown">{{ countdown }}</div>
      <p v-else-if="status.phase === 'running' || status.phase === 'stopping'" class="elapsed">{{ elapsed }}</p>
      <p v-if="status.phase === 'succeeded'" class="execution-success">{{ t('execution.success') }}</p>
      <p v-if="status.error" class="execution-error status-error">{{ status.error }}</p>
      <div v-if="developerMode && status.result?.runDir" class="execution-result">
        <small>{{ t('execution.outputDirectory') }}</small>
        <code :title="status.result.runDir">{{ status.result.runDir }}</code>
      </div>
      <small v-if="status.phase === 'running'">{{ t('execution.noOutputHint') }}</small>
    </aside>
  </section>
</template>
