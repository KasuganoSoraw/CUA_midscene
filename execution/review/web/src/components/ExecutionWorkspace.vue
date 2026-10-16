<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { SceneCatalogItem, TaskCatalogReadyItem } from '../../../../cua/contracts/types';
import type { ReviewTaskView, TaskExecutionMode, TaskExecutionStatus } from '../../../shared/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { executionFeedback } from '../execution-feedback';
import { executionInstruction, executionParameters } from '../execution-presentation';
import ReviewSelect, { type ReviewSelectOption } from './ReviewSelect.vue';
import TaskCatalog from './TaskCatalog.vue';
import emptyParameters from '../assets/ucd/execution-empty.svg';
import copyIcon from '../assets/ucd/execution-copy.svg';
import runIcon from '../assets/ucd/execution-run.svg';
import infoIcon from '../assets/ucd/execution-info.svg';

const { t } = useI18n();
const props = defineProps<{
  scenes: SceneCatalogItem[];
  initialScene?: string;
  initialTask?: string;
  targetVersion?: number;
  developerMode?: boolean;
}>();
const emit = defineEmits<{ create: [] }>();
const scene = ref('');
const task = ref('');
const selectedTask = ref<TaskCatalogReadyItem>();
const taskView = ref<ReviewTaskView>();
const mode = ref<TaskExecutionMode>('task');
const inputs = ref<Record<string, string>>({});
const status = ref<TaskExecutionStatus>({ phase: 'idle' });
const busy = ref(false);
const error = ref('');
const connectionError = ref('');
const reportOpening = ref(false);
const reportOpenError = ref('');
const copyState = ref<'idle' | 'copied' | 'failed'>('idle');
const copying = ref(false);
const instructionField = ref<HTMLInputElement>();
const clock = ref(Date.now());
let poll: ReturnType<typeof setInterval> | undefined;
let selectionVersion = 0;
let statusPolling = false;
let disposed = false;

const modeOptions = computed<ReviewSelectOption[]>(() => [
  { value: 'task', label: `${t('execution.stepMode')}——${t('execution.stepModeHelp')}` },
  { value: 'act', label: `${t('execution.adaptiveMode')}——${t('execution.adaptiveModeHelp')}` },
]);
const parameters = computed(() => taskView.value ? executionParameters(taskView.value) : []);
const instruction = computed(() => selectedTask.value ? executionInstruction(task.value, mode.value) : '');
const active = computed(() => ['preparing', 'running', 'stopping'].includes(status.value.phase));
const canStart = computed(() => Boolean(selectedTask.value && taskView.value && !active.value && !busy.value && !connectionError.value));
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
const feedback = computed(() => executionFeedback(status.value));
const requestDescriptionKey = computed(() => {
  const result = executionFeedback({ phase: 'failed', error: error.value });
  return !result || result.titleKey === 'execution.failed' ? 'execution.operationFailedHelp' : result.descriptionKey;
});
const phaseLabel = computed(() => feedback.value ? t(feedback.value.titleKey, { elapsed: elapsed.value }) : ({
  idle: t('execution.idle'), preparing: t('execution.preparing', { seconds: countdown.value }),
  running: t('execution.running', { elapsed: elapsed.value }), stopping: t('execution.stoppingLabel'),
  succeeded: t('execution.succeeded', { elapsed: elapsed.value }), failed: t('execution.failed'), stopped: t('execution.stopped'),
})[status.value.phase]);

async function selectTask(target: { scene: string; task?: string }): Promise<void> {
  if (active.value && (target.scene !== status.value.scene || target.task !== status.value.task)) return;
  const version = ++selectionVersion;
  scene.value = target.scene;
  task.value = target.task ?? '';
  selectedTask.value = undefined;
  taskView.value = undefined;
  inputs.value = {};
  error.value = '';
  busy.value = true;
  try {
    if (!target.scene) return;
    const tasks = (await api.tasks(target.scene)).tasks;
    if (disposed || version !== selectionVersion) return;
    const candidate = target.task
      ? tasks.find(item => item.task === target.task && item.status === 'ready')
      : tasks.find(item => item.status === 'ready');
    if (!candidate || candidate.status !== 'ready') return;
    task.value = candidate.task;
    const view = await api.task(target.scene, candidate.task);
    if (disposed || version !== selectionVersion) return;
    selectedTask.value = candidate;
    taskView.value = view;
    inputs.value = Object.fromEntries(Object.entries(view.manifest.inputs).map(([id, value]) => [id, value.default]));
  } catch (caught) {
    if (!disposed && version === selectionVersion) error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    if (!disposed && version === selectionVersion) busy.value = false;
  }
}

async function applyTarget(): Promise<void> {
  const requestedScene = active.value ? status.value.scene : props.initialScene;
  const requestedTask = active.value ? status.value.task : props.initialTask;
  const selectedScene = props.scenes.find(item => item.scene === requestedScene && item.status === 'ready')
    ?? props.scenes.find(item => item.status === 'ready');
  if (active.value && status.value.mode) mode.value = status.value.mode;
  await selectTask({ scene: selectedScene?.scene ?? '', task: requestedTask });
}

async function refreshStatus(): Promise<void> {
  if (statusPolling) return;
  statusPolling = true;
  try {
    const next = await api.executionStatus();
    if (!disposed) { status.value = next; connectionError.value = ''; }
  } catch (caught) {
    if (!disposed) connectionError.value = caught instanceof Error ? caught.message : String(caught);
  } finally { statusPolling = false; }
}

async function copyInstruction(): Promise<void> {
  if (!instruction.value || copying.value) return;
  const text = instruction.value;
  copying.value = true;
  try {
    await navigator.clipboard.writeText(text);
    if (!disposed && text === instruction.value) copyState.value = 'copied';
  } catch {
    if (!disposed && text === instruction.value) {
      copyState.value = 'failed';
      instructionField.value?.focus();
      instructionField.value?.select();
    }
  } finally { copying.value = false; }
}

async function start(): Promise<void> {
  if (!canStart.value) return;
  busy.value = true;
  error.value = '';
  try {
    status.value = await api.startExecution({ scene: scene.value, task: task.value, mode: mode.value, inputs: { ...inputs.value } });
    clock.value = Date.now();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    await refreshStatus();
    error.value = message;
  } finally { busy.value = false; }
}

async function stop(): Promise<void> {
  if (!active.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try { status.value = await api.stopExecution(); }
  catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught); }
  finally { busy.value = false; }
}

async function openReport(): Promise<void> {
  const reportUrl = status.value.result?.reportUrl;
  if (!reportUrl || reportOpening.value) return;
  reportOpening.value = true;
  reportOpenError.value = '';
  try { await api.openExecutionReport(reportUrl); }
  catch (caught) {
    if (!disposed && status.value.result?.reportUrl === reportUrl) {
      reportOpenError.value = caught instanceof Error ? caught.message : String(caught);
    }
  } finally { reportOpening.value = false; }
}

watch(instruction, () => { copyState.value = 'idle'; });
watch(() => status.value.result?.reportUrl, () => { reportOpenError.value = ''; });
watch(() => props.targetVersion, () => { void applyTarget(); });
onMounted(async () => {
  await refreshStatus();
  if (disposed) return;
  await applyTarget();
  if (disposed) return;
  poll = setInterval(() => { clock.value = Date.now(); void refreshStatus(); }, 1000);
});
onUnmounted(() => { disposed = true; selectionVersion += 1; if (poll) clearInterval(poll); });
</script>

<template>
  <section class="execution-console panel">
    <TaskCatalog :scenes="scenes" :scene="scene" :task="task" :busy="busy || active"
      :version="targetVersion ?? 0" :current-step-count="selectedTask?.taskCount ?? 0"
      @select="selectTask" @create="emit('create')" />
    <section class="execution-main" :aria-busy="busy">
      <template v-if="selectedTask">
        <header class="execution-task-heading">
          <div><h2 :title="selectedTask.title">{{ selectedTask.title }}</h2><span>{{ t('execution.summary', { steps: t('common.steps', { count: selectedTask.taskCount }), actions: t('common.actions', { count: selectedTask.actionCount }) }) }}</span></div>
          <p v-if="selectedTask.description || selectedTask.goal">{{ selectedTask.description || selectedTask.goal }}</p>
        </header>
        <label class="execution-field">
          <span class="execution-section-title">{{ t('execution.mode') }}<img :src="infoIcon" :title="t('execution.modeHelp')" alt="" /></span>
          <ReviewSelect v-model="mode" :aria-label="t('execution.mode')" :options="modeOptions" :disabled="busy || active" />
        </label>
        <div class="execution-field">
          <label for="execution-instruction" class="execution-section-title">{{ t('execution.copyHeading') }}</label>
          <div class="execution-instruction">
            <input id="execution-instruction" ref="instructionField" :value="instruction" readonly @focus="instructionField?.select()" />
            <button type="button" :disabled="copying || !instruction" :title="t('execution.copyInstruction')" :aria-label="t('execution.copyInstruction')" @click="copyInstruction"><img :src="copyIcon" alt="" /></button>
          </div>
          <p class="execution-copy-message" role="status" aria-live="polite">{{ t(copyState === 'copied' ? 'execution.copied' : copyState === 'failed' ? 'execution.copyFailed' : 'execution.copyHelp') }}</p>
        </div>
        <section class="execution-parameters">
          <header><h3>{{ t('execution.debugInputs') }}</h3><span>{{ t('execution.inputsEphemeral') }}</span></header>
          <div v-if="parameters.length" class="execution-inputs">
            <label v-for="parameter in parameters" :key="parameter.id" class="execution-parameter-card">
              <span class="execution-parameter-label"><strong>{{ parameter.definition.label }}</strong><code v-if="developerMode">{{ parameter.id }}</code></span>
              <span v-if="parameter.stepNumber" class="execution-parameter-context">{{ t('execution.inputStep', { index: parameter.stepNumber }) }}<template v-if="parameter.target">：{{ parameter.target }}</template></span>
              <input v-model="inputs[parameter.id]" :aria-label="parameter.definition.label" :disabled="busy || active" />
              <small v-if="parameter.definition.description">{{ parameter.definition.description }}</small>
            </label>
          </div>
          <div v-else class="execution-empty"><img :src="emptyParameters" alt="" /><p>{{ t('execution.noInputs') }}</p></div>
        </section>
      </template>
      <div v-else class="execution-selection-empty"><h2>{{ t(busy ? 'review.loading' : 'execution.choose') }}</h2><p>{{ t('execution.selectFirst') }}</p></div>
      <div v-if="selectedTask || active" class="execution-actions">
        <button v-if="active" class="execution-stop" :disabled="busy || status.phase === 'stopping'" @click="stop">{{ status.phase === 'preparing' ? t('execution.cancelPrepare') : status.phase === 'stopping' ? t('execution.stopping') : t('execution.stop') }}</button>
        <button v-else class="primary execution-start" :disabled="!canStart" @click="start"><img :src="runIcon" alt="" />{{ t('execution.debugTask') }}</button>
        <p>{{ t('execution.warning') }}</p>
      </div>
      <div v-if="error || connectionError" class="execution-error" role="alert">
        <strong>{{ t(error ? 'execution.operationFailed' : 'execution.connectionLost') }}</strong>
        <p>{{ t(error ? requestDescriptionKey : 'execution.connectionLostHelp') }}</p>
        <details class="execution-diagnostics"><summary>{{ t('execution.technicalDetails') }}</summary><pre>{{ error || connectionError }}</pre></details>
      </div>
    </section>
    <aside class="execution-status" :class="`phase-${status.phase}`" aria-live="polite">
      <h2>{{ t('execution.debugResult') }}</h2>
      <div class="execution-status-heading"><span class="execution-status-dot" aria-hidden="true"></span><strong>{{ phaseLabel }}</strong></div>
      <p v-if="status.startedAt" class="execution-elapsed">{{ t('execution.duration', { elapsed }) }}</p>
      <div v-if="status.phase === 'preparing'" class="countdown">{{ countdown }}</div>
      <p v-if="status.phase === 'idle'" class="execution-result-empty">{{ t('execution.resultEmpty') }}</p>
      <dl v-if="status.task" class="execution-run-facts">
        <div><dt>{{ t('review.task') }}</dt><dd>{{ status.scene }} / {{ status.task }}</dd></div>
        <div v-if="status.mode"><dt>{{ t('execution.mode') }}</dt><dd>{{ t(status.mode === 'act' ? 'execution.adaptiveMode' : 'execution.stepMode') }}</dd></div>
      </dl>
      <div v-if="feedback" class="execution-feedback" role="status">
        <h3>{{ t('execution.resultExplanation') }}</h3><p>{{ t(feedback.descriptionKey) }}</p>
        <button v-if="status.result?.reportUrl" type="button" class="execution-report-link" :disabled="reportOpening" @click="openReport">{{ t(reportOpening ? 'execution.openingReport' : 'execution.viewReport') }} ↗</button>
        <p v-else class="execution-report-unavailable">{{ t('execution.reportUnavailable') }}</p>
        <div v-if="reportOpenError" role="alert">
          <p>{{ t('execution.openReportFailed') }}</p>
          <details class="execution-diagnostics"><summary>{{ t('execution.technicalDetails') }}</summary><pre>{{ reportOpenError }}</pre></details>
        </div>
        <details v-if="status.error" class="execution-diagnostics"><summary>{{ t('execution.technicalDetails') }}</summary><pre>{{ status.error }}</pre></details>
      </div>
      <div v-if="developerMode && status.result?.runDir" class="execution-result"><small>{{ t('execution.outputDirectory') }}</small><code :title="status.result.runDir">{{ status.result.runDir }}</code></div>
      <small v-if="status.phase === 'running'">{{ t('execution.noOutputHint') }}</small>
    </aside>
  </section>
</template>
