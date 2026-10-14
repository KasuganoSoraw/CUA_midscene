<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { SceneCatalogItem } from '../../../../cua/contracts/types';
import type {
  CreateRecordingTaskResult,
  RecorderDisplay,
  RecorderStatus,
  RecordingGenerationStatus,
  ReviewRecording,
  ReviewRecordingCatalog,
} from '../../../shared/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { shouldDetectDisplays } from '../recording-display';
import ConfirmDialog from './ConfirmDialog.vue';
import videoIcon from '../assets/ucd/video.svg';
import logIcon from '../assets/ucd/event-log.svg';
import refreshIcon from '../assets/ucd/refresh.svg';

const { t, formatDateTime } = useI18n();

const props = defineProps<{
  scenes: SceneCatalogItem[];
}>();

const emit = defineEmits<{
  created: [result: CreateRecordingTaskResult];
}>();

const catalog = ref<ReviewRecordingCatalog>({
  configured: false,
  envName: 'CUA_RECORDINGS_ROOT',
  recordings: [],
});
const selectedId = ref('');
const sceneId = ref('');
const taskId = ref('');
const goal = ref('');
const actionBusy = ref(false);
const generation = ref<RecordingGenerationStatus>({ phase: 'idle' });
const busy = computed(() => actionBusy.value || generation.value.phase === 'running');
const opening = ref(false);
const sceneMenuOpen = ref(false);
const error = ref('');
const message = ref(() => t('recording.loading'));
const recorderStatus = ref<RecorderStatus>({ phase: 'idle' });
const recorderDisplays = ref<RecorderDisplay[]>([]);
const selectedDisplayId = ref('');
const recorderBusy = ref(false);
const recorderError = ref('');
const recordingDeleteOpen = ref(false);
const clock = ref(Date.now());
let recorderPoll: ReturnType<typeof setInterval> | undefined;
let generationPolling = false;
let disposed = false;

function applyGeneration(next: RecordingGenerationStatus, restoreForm = false): void {
  generation.value = next;
  if (restoreForm && next.request && next.recording) {
    selectedId.value = next.recording;
    sceneId.value = next.request.scene;
    taskId.value = next.request.task;
    goal.value = next.request.goal ?? '';
  }
  if (next.phase === 'running') message.value = () => t('recording.creating');
  else if (next.phase === 'succeeded' && next.result) {
    const result = next.result;
    message.value = () => t('recording.created', { scene: result.scene, task: result.task });
  } else if (next.phase === 'failed') message.value = () => t('recording.createFailed');
}

async function loadGeneration(restoreForm = false): Promise<void> {
  if (generationPolling) return;
  generationPolling = true;
  try {
    applyGeneration(await api.recordingGeneration(), restoreForm);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    generationPolling = false;
  }
}

const selected = computed<ReviewRecording | undefined>(() =>
  catalog.value.recordings.find((item) => item.id === selectedId.value),
);
const canCreate = computed(() =>
  Boolean(selected.value?.ready && sceneId.value.trim() && taskId.value.trim() && !busy.value),
);
const sceneOptions = computed(() => {
  const query = sceneId.value.trim().toLocaleLowerCase();
  return props.scenes
    .filter((item) => item.status === 'ready')
    .map((item) => ({
      id: item.scene,
      title: item.title,
    }))
    .filter((item) => item.id && (
      !query
      || item.id.toLocaleLowerCase().includes(query)
      || item.title.toLocaleLowerCase().includes(query)
    ));
});
const recorderCollapsed = computed(() =>
  ['arming', 'armed', 'starting', 'recording', 'stopping'].includes(recorderStatus.value.phase),
);
const canDeleteRecording = computed(() => Boolean(
  selected.value && !busy.value && !opening.value && !recorderBusy.value && !recorderCollapsed.value,
));
const canStartRecorder = computed(() => Boolean(
  selectedDisplayId.value
  && recorderStatus.value.outputRoot
  && ['idle', 'failed'].includes(recorderStatus.value.phase)
  && !recorderBusy.value,
));
const elapsedRecording = computed(() => {
  if (!recorderStatus.value.startedAt) return '00:00';
  const seconds = Math.max(0, Math.floor((clock.value - new Date(recorderStatus.value.startedAt).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
});

function formatSize(size: number | undefined): string {
  if (size === undefined) return t('common.notFound');
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string | undefined): string {
  return value ? formatDateTime(value) : t('common.unknownTime');
}

function selectScene(id: string): void {
  sceneId.value = id;
  sceneMenuOpen.value = false;
}

function closeSceneMenu(event: FocusEvent): void {
  const container = event.currentTarget as HTMLElement;
  const next = event.relatedTarget;
  if (!(next instanceof Node) || !container.contains(next)) sceneMenuOpen.value = false;
}

function applyCatalog(next: ReviewRecordingCatalog): void {
  catalog.value = next;
  if (!next.configured) {
    selectedId.value = '';
    message.value = () => t('recording.notConfigured', { name: next.envName });
    return;
  }
  selectedId.value = next.recordings.some((item) => item.id === selectedId.value)
    ? selectedId.value
    : next.recordings[0]?.id ?? '';
  message.value = next.recordings.length
    ? () => t('recording.found', { count: next.recordings.length })
    : () => t('recording.empty');
}

async function loadRecordings(): Promise<void> {
  error.value = '';
  try {
    applyCatalog(await api.recordings());
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function loadRecorderStatus(): Promise<void> {
  try {
    const wasActive = recorderCollapsed.value;
    const next = await api.recorderStatus();
    recorderStatus.value = next;
    if (wasActive && next.phase === 'idle') await loadRecordings();
  } catch (caught) {
    recorderError.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function refreshRecorderDisplays(): Promise<void> {
  if (recorderBusy.value || recorderCollapsed.value) return;
  recorderBusy.value = true;
  recorderError.value = '';
  try {
    const result = await api.refreshRecorderDisplays();
    recorderDisplays.value = result.displays;
    selectedDisplayId.value = result.displays.some((item) => item.id === selectedDisplayId.value)
      ? selectedDisplayId.value
      : result.displays.find((item) => item.primary)?.id ?? result.displays[0]?.id ?? '';
  } catch (caught) {
    recorderError.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    recorderBusy.value = false;
  }
}

async function startRecorder(): Promise<void> {
  if (!canStartRecorder.value) return;
  recorderBusy.value = true;
  recorderError.value = '';
  recorderStatus.value = {
    phase: 'arming',
    outputRoot: recorderStatus.value.outputRoot,
  };
  try {
    recorderStatus.value = await api.startRecorder({
      displayId: selectedDisplayId.value,
    });
    clock.value = Date.now();
  } catch (caught) {
    recorderError.value = caught instanceof Error ? caught.message : String(caught);
    await loadRecorderStatus();
  } finally {
    recorderBusy.value = false;
  }
}

async function stopRecorder(): Promise<void> {
  if (recorderBusy.value || !recorderCollapsed.value) return;
  recorderBusy.value = true;
  recorderError.value = '';
  try {
    recorderStatus.value = await api.stopRecorder();
    await loadRecordings();
  } catch (caught) {
    recorderError.value = caught instanceof Error ? caught.message : String(caught);
    await loadRecorderStatus();
  } finally {
    recorderBusy.value = false;
  }
}

async function openFolder(): Promise<void> {
  if (!selected.value || opening.value || busy.value) return;
  opening.value = true;
  error.value = '';
  try {
    await api.openRecordingFolder(selected.value.id);
    message.value = () => t('recording.folderOpened', { id: selected.value?.id ?? '' });
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    opening.value = false;
  }
}

async function createTask(): Promise<void> {
  if (!selected.value || !canCreate.value) return;
  actionBusy.value = true;
  error.value = '';
  message.value = () => t('recording.creating');
  try {
    applyGeneration(await api.createRecordingTask(selected.value.id, {
      scene: sceneId.value.trim(),
      task: taskId.value.trim(),
      goal: goal.value.trim(),
    }));
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
    message.value = () => t('recording.createFailed');
    await loadGeneration(true);
  } finally {
    actionBusy.value = false;
  }
}

function requestRecordingDeletion(): void {
  if (!canDeleteRecording.value) return;
  recordingDeleteOpen.value = true;
}

async function confirmRecordingDeletion(): Promise<void> {
  if (!selected.value || !canDeleteRecording.value) return;
  const recording = selected.value.id;
  actionBusy.value = true;
  error.value = '';
  try {
    await api.deleteRecording(recording);
    recordingDeleteOpen.value = false;
    await loadRecordings();
    message.value = () => t('recording.deleted', { recording });
  } catch (caught) {
    recordingDeleteOpen.value = false;
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    actionBusy.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadRecordings(), loadRecorderStatus()]);
  if (disposed) return;
  await loadGeneration(true);
  if (disposed) return;
  if (shouldDetectDisplays(recorderStatus.value.phase)) await refreshRecorderDisplays();
  if (disposed) return;
  recorderPoll = setInterval(() => {
    clock.value = Date.now();
    if (recorderCollapsed.value && !recorderBusy.value) void loadRecorderStatus();
    if (generation.value.phase === 'running') void loadGeneration();
  }, 1000);
});
onUnmounted(() => {
  disposed = true;
  if (recorderPoll) clearInterval(recorderPoll);
});
</script>

<template>
  <section class="panel recorder-control" :class="{ collapsed: recorderCollapsed }">
    <template v-if="recorderCollapsed">
      <span class="recorder-live-dot" :class="{ armed: recorderStatus.phase === 'armed' || recorderStatus.phase === 'arming' }"></span>
      <div class="recorder-live-copy">
        <strong>{{ recorderStatus.phase === 'arming' ? t('recording.preparing')
          : recorderStatus.phase === 'armed' ? t('recording.armed')
            : recorderStatus.phase === 'starting' ? t('recording.starting')
              : recorderStatus.phase === 'stopping' ? t('recording.stopping') : t('recording.active') }}</strong>
        <small v-if="recorderStatus.phase === 'armed'">{{ t('recording.switchAndStart', { hotkey: recorderStatus.hotkey || 'Ctrl+Shift+F9' }) }}</small>
        <small v-else-if="recorderStatus.phase === 'recording'">{{ t('recording.stopHint', { id: recorderStatus.recordingId || '', elapsed: elapsedRecording, hotkey: recorderStatus.hotkey || 'Ctrl+Shift+F9' }) }}</small>
        <small v-else>{{ recorderStatus.recordingId || t('recording.registeringHotkey') }}</small>
      </div>
      <button class="destructive recorder-stop" type="button"
        :disabled="recorderBusy || recorderStatus.phase === 'arming' || recorderStatus.phase === 'stopping'"
        @click="stopRecorder">{{ recorderStatus.phase === 'stopping' ? t('recording.stoppingButton') : recorderStatus.phase === 'armed' ? t('recording.cancelReady') : t('recording.stopNow') }}</button>
    </template>
    <template v-else>
      <div class="recorder-heading">
        <div class="recorder-heading-copy">
          <h2>{{ t('recording.new') }}</h2>
          <p>{{ t('recording.newHelp') }}</p>
        </div>
        <div class="recorder-heading-actions">
          <button class="secondary" type="button" :disabled="recorderBusy" @click="refreshRecorderDisplays">{{ recorderBusy ? t('recording.detecting') : t('recording.detectAgain') }}</button>
          <button class="primary" type="button" :disabled="!canStartRecorder" @click="startRecorder">{{ t('recording.prepare') }}</button>
        </div>
      </div>
      <div v-if="recorderDisplays.length" class="recorder-displays">
        <button v-for="display in recorderDisplays" :key="display.id" type="button"
          class="recorder-display" :class="{ selected: selectedDisplayId === display.id }"
          :aria-pressed="selectedDisplayId === display.id" :disabled="recorderBusy" @click="selectedDisplayId = display.id">
          <img :src="display.previewUrl" :alt="t('recording.displayAlt', { index: display.index + 1 })" />
          <span>
            <strong>{{ t('recording.display', { index: display.index + 1 }) }}<em v-if="display.primary">{{ t('recording.primaryDisplay') }}</em></strong>
            <small>{{ display.width }} × {{ display.height }} · {{ display.deviceName }}</small>
          </span>
        </button>
      </div>
      <div v-else class="recorder-preview-empty">{{ recorderBusy ? t('recording.detectingHelp') : t('recording.noDisplays') }}</div>
      <p v-if="!recorderStatus.outputRoot" class="recorder-output-help">{{ t('recording.outputHelp') }}</p>
      <div v-if="recorderStatus.phase === 'failed' || recorderError" class="inline-error recorder-inline-error" role="alert">{{ recorderError || recorderStatus.error }}</div>
    </template>
  </section>

  <section class="panel recording-browser">
    <aside class="catalog recording-catalog">
      <div class="recording-catalog-heading">
        <h2>{{ t('recording.raw') }}</h2>
        <button class="icon-button" :disabled="actionBusy" :title="t('recording.refreshCatalog')" :aria-label="t('recording.refreshCatalog')" @click="loadRecordings"><img :src="refreshIcon" alt="" /></button>
      </div>
      <div v-if="!catalog.configured" class="recording-config-empty">
        <strong>{{ t('recording.configTitle') }}</strong>
        <p>{{ t('recording.configIntro') }}</p><code>{{ catalog.envName }}</code>
        <small>{{ t('recording.example') }}</small>
        <code class="recording-config-example"><span>CUA_RECORDINGS_ROOT=</span><span>C:\path\to\recorder-output</span></code>
        <small>{{ t('recording.restart') }}</small><small>{{ t('recording.reviewUnaffected') }}</small>
      </div>
      <div v-else-if="!catalog.recordings.length" class="recording-config-empty">
        <strong>{{ t('recording.none') }}</strong><p>{{ t('recording.noneHelp') }}</p>
      </div>
      <div v-else class="recording-list">
        <button v-for="item in catalog.recordings" :key="item.id" class="task-row recording-row"
          :class="{ active: selectedId === item.id }" :disabled="actionBusy" @click="selectedId = item.id">
          <strong :title="item.id">{{ item.id }}</strong>
          <span class="recording-row-meta"><small>{{ formatTime(item.startedAt) }}</small>
            <span class="recording-status" :class="item.ready ? 'recording-ready' : 'recording-invalid'">{{ item.ready ? t('recording.ready') : t('recording.needsCheck') }}</span>
          </span>
        </button>
      </div>
    </aside>

    <section class="recording-detail">
      <header class="recording-heading">
        <div class="recording-title">
          <h2>{{ selected?.id ?? t('recording.raw') }}</h2>
          <button v-if="recorderStatus.outputRoot && selected" class="recording-path" :title="recorderStatus.outputRoot" :disabled="opening || busy" @click="openFolder">{{ recorderStatus.outputRoot }}</button>
        </div>
        <div v-if="selected" class="recording-heading-actions">
          <div class="recording-meta"><span>{{ formatTime(selected.startedAt) }}</span><span v-if="selected.screen">{{ selected.screen.width }} × {{ selected.screen.height }}</span></div>
          <button class="destructive" type="button" :disabled="!canDeleteRecording" @click="requestRecordingDeletion">{{ t('recording.delete') }}</button>
        </div>
      </header>
      <div class="recording-columns">
        <div class="recording-create-column">
          <div v-if="!selected" class="recording-detail-empty">
            <h3>{{ catalog.configured ? t('recording.select') : t('recording.configure', { name: catalog.envName }) }}</h3>
            <p>{{ catalog.configured ? t('recording.selectHelp') : t('recording.configureHelp') }}</p>
          </div>
          <template v-else>
            <div class="asset-grid">
              <button class="asset-card" :disabled="busy || opening" :title="t('recording.openFolder')" @click="openFolder">
                <img class="asset-icon" :src="videoIcon" alt="" />
                <span class="asset-copy"><span class="asset-label">{{ t('recording.video') }}<small>{{ formatSize(selected.video?.size) }}</small></span>
                  <strong :title="selected.video?.name">{{ selected.video?.name ?? t('recording.videoMissing') }}</strong></span>
              </button>
              <button class="asset-card" :disabled="busy || opening" :title="t('recording.openFolder')" @click="openFolder">
                <img class="asset-icon" :src="logIcon" alt="" />
                <span class="asset-copy"><span class="asset-label">{{ t('recording.eventLog') }}<small>{{ formatSize(selected.eventLog?.size) }}</small></span>
                  <strong :title="selected.eventLog?.name">{{ selected.eventLog?.name ?? t('recording.logMissing') }}</strong></span>
              </button>
            </div>
            <div v-if="selected.errors.length" class="recording-errors"><strong>{{ t('recording.invalid') }}</strong><span v-for="item in selected.errors" :key="item">{{ item }}</span></div>
            <form class="recording-form" @submit.prevent="createTask">
              <h3>{{ t('recording.create') }}</h3>
              <label>{{ t('review.task') }}<input v-model="taskId" :disabled="busy" autocomplete="off" :placeholder="t('recording.taskPlaceholder')" /></label>
          <div class="recording-field">
            <label for="recording-scene-input">{{ t('review.scene') }}</label>
            <div class="scene-combobox" @focusout="closeSceneMenu">
              <input
                id="recording-scene-input"
                v-model="sceneId"
                :disabled="busy"
                autocomplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="recording-scene-options"
                :aria-expanded="sceneMenuOpen"
                :placeholder="t('recording.scenePlaceholder')"
                @focus="sceneMenuOpen = true"
                @input="sceneMenuOpen = true"
                @keydown.esc="sceneMenuOpen = false"
              />
              <button
                type="button"
                class="scene-combobox-toggle"
                :class="{ open: sceneMenuOpen }"
                :disabled="busy"
                :aria-expanded="sceneMenuOpen"
                :aria-label="t('recording.expandScenes')"
                @click="sceneMenuOpen = !sceneMenuOpen"
              ></button>
              <div
                v-if="sceneMenuOpen"
                id="recording-scene-options"
                class="scene-options"
                role="listbox"
              >
                <button
                  v-for="item in sceneOptions"
                  :key="item.id"
                  type="button"
                  role="option"
                  :aria-selected="sceneId === item.id"
                  @click="selectScene(item.id)"
                >
                  <strong>{{ item.id }}</strong>
                  <span v-if="item.title && item.title !== item.id">{{ item.title }}</span>
                </button>
                <div v-if="!sceneOptions.length" class="scene-option-empty">
                  {{ t('recording.createScene') }}
                </div>
              </div>
            </div>
          </div>

              <label>{{ t('recording.goal') }}<textarea v-model="goal" :disabled="busy" rows="4" :placeholder="t('recording.goalPlaceholder')"></textarea></label>
              <div v-if="error" class="inline-error" role="alert">{{ error }}</div>
              <div class="recording-form-actions"><button class="primary" type="submit" :disabled="!canCreate">{{ busy ? t('recording.generating') : t('recording.generate') }}</button></div>
            </form>
          </template>
        </div>

        <aside class="recording-progress" aria-live="polite">
          <h3>{{ t('recording.progress') }}</h3>
          <div v-if="generation.phase === 'running'" class="generation-state phase-running" role="status">
            <div class="indeterminate-progress"><span></span></div>
            <strong>{{ t('recording.generating') }}</strong>
            <small>{{ generation.recording }} · {{ generation.request?.scene }}/{{ generation.request?.task }}</small>
            <p>{{ t('recording.generatingHelp') }}</p>
          </div>
          <div v-else-if="generation.phase === 'succeeded' && generation.result" class="generation-state phase-succeeded" role="status">
            <strong>{{ t('recording.generationSucceeded') }}</strong><p>{{ t('recording.created', { scene: generation.result.scene, task: generation.result.task }) }}</p>
            <button type="button" class="text-link" @click="emit('created', generation.result)">{{ t('recording.openCreated') }}</button>
          </div>
          <div v-else-if="generation.phase === 'failed'" class="generation-state phase-failed" role="alert">
            <strong>{{ t('recording.createFailed') }}</strong><pre>{{ generation.error }}</pre>
          </div>
          <div v-else class="generation-empty">{{ t('recording.progressEmpty') }}</div>
          <p class="recording-message">{{ message() }}</p>
        </aside>
      </div>
    </section>
  </section>

  <ConfirmDialog
    :open="recordingDeleteOpen"
    :title="t('recording.deleteTitle')"
    :message="t('recording.deleteMessage')"
    :target="selected?.id ?? ''"
    :confirm-label="t('recording.delete')"
    :cancel-label="t('common.cancel')"
    :busy="busy"
    @confirm="confirmRecordingDeletion"
    @cancel="recordingDeleteOpen = false"
  />

</template>
